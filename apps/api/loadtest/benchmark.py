"""Synthetic HTTP load tests. Refuses to seed any database except renewly_load.

Run against an isolated API/DB pair; no scheduler or external integrations.
"""
import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
from math import ceil
from time import perf_counter
from urllib.parse import urlparse

import httpx
from sqlalchemy import func, select, text

from app.core.config import get_settings
from app.core.security import hash_password
from app.db.session import AsyncSessionLocal, engine
from app.models import User, Role, Permission, RecordType, RecordField, Record


async def seed(target):
    if get_settings().DATABASE_URL.rsplit("/", 1)[-1] != "renewly_load":
        raise RuntimeError("Synthetic seeding is restricted to the disposable renewly_load database")
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User.id))).first()
        if not user:
            role = Role(name="Load administrator", permissions=[Permission(name=p) for p in (
                "record.view", "report.view", "report.export",
            )])
            db.add(User(email="load@example.test", username="load", name="Synthetic load user",
                        hashed_password=hash_password("synthetic-load-only"), is_superuser=True,
                        roles=[role]))
            for index, name in enumerate(("Licenses", "Domains", "Services"), 1):
                rt = RecordType(id=index, name=f"Load {name}", slug=f"load-{name.lower()}", track_ownership=True)
                db.add(rt)
                await db.flush()
                for order, (name, kind) in enumerate((
                    ("Expiry", "date"), ("Cost", "currency"), ("Currency", "text"),
                    ("Business Unit", "business_unit"), ("Billing Cycle", "text"),
                    ("Auto Renewal", "boolean"), ("Vendor", "text"), ("Product Name", "text"),
                )):
                    field = RecordField(record_type_id=rt.id, name=name, slug=name.lower().replace(" ", "_"),
                                        field_type=kind, display_order=order)
                    db.add(field)
                    await db.flush()
                    if name == "Expiry":
                        rt.reminder_field_id = field.id
            await db.commit()
        current = (await db.execute(select(func.count(Record.id)))).scalar()
        if current >= target:
            return
        await db.execute(text("""
            INSERT INTO records (id, record_type_id, name, status, archived, deleted_at)
            SELECT g, 1 + (g % 3), 'Load ' || lpad(g::text, 7, '0'), 'active',
                   g % 20 = 0, CASE WHEN g % 100 = 0 THEN now() ELSE NULL END
            FROM generate_series(CAST(:first AS integer), CAST(:last AS integer)) g
        """), {"first": current + 1, "last": target})
        await db.execute(text("""
            INSERT INTO record_values (record_id, field_id, value)
            SELECT r.id, f.id, jsonb_build_object('value', CASE f.slug
                WHEN 'expiry' THEN to_jsonb((current_date + ((r.id % 730) - 90))::text)
                WHEN 'cost' THEN to_jsonb((10 + r.id % 500)::numeric)
                WHEN 'currency' THEN to_jsonb((ARRAY['USD', 'MMK', 'SGD'])[1 + r.id % 3])
                WHEN 'business_unit' THEN to_jsonb('Unit ' || (r.id % 10)::text)
                WHEN 'billing_cycle' THEN to_jsonb((ARRAY['Monthly', 'Quarterly', 'Yearly'])[1 + r.id % 3])
                WHEN 'auto_renewal' THEN to_jsonb(r.id % 2 = 0)
                WHEN 'vendor' THEN to_jsonb('Vendor ' || (r.id % 20)::text)
                ELSE to_jsonb('Plan ' || (r.id % 5)::text) END)
            FROM records r JOIN record_fields f ON f.record_type_id = r.record_type_id
            WHERE r.id BETWEEN :first AND :last
        """), {"first": current + 1, "last": target})
        await db.execute(text("""
            INSERT INTO record_assignments (record_id, employee_name, business_unit, effective_date, cost, currency)
            SELECT r.id, 'Synthetic holder', 'Unit ' || (r.id % 10)::text,
                   current_date - 365 + h * 180, 10 + r.id % 500,
                   (ARRAY['USD', 'MMK', 'SGD'])[1 + r.id % 3]
            FROM records r CROSS JOIN generate_series(0, 1) h
            WHERE r.id BETWEEN :first AND :last
        """), {"first": current + 1, "last": target})
        await db.execute(text("SELECT setval(pg_get_serial_sequence('records', 'id'), :last)"), {"last": target})
        await db.commit()
    async with engine.connect() as connection:
        await connection.execution_options(isolation_level="AUTOCOMMIT")
        await connection.execute(text("ANALYZE"))


def percentile(values, fraction):
    ordered = sorted(values)
    return round(ordered[max(0, ceil(len(ordered) * fraction) - 1)], 1)


async def scenario(client, name, paths, concurrency, requests):
    durations = []
    by_path = {}
    statuses = Counter()
    errors = []
    semaphore = asyncio.Semaphore(concurrency)

    async def request(index):
        async with semaphore:
            started = perf_counter()
            path, params = paths[index % len(paths)]
            try:
                response = await client.get(path, params=params)
                statuses[str(response.status_code)] += 1
                if response.status_code != 200:
                    errors.append({"path": path, "status": response.status_code})
            except httpx.HTTPError as exc:
                statuses[type(exc).__name__] += 1
                errors.append({"path": path, "error": type(exc).__name__})
            duration = (perf_counter() - started) * 1000
            durations.append(duration)
            label = path + ("?search" if params.get("search") else "")
            by_path.setdefault(label, []).append(duration)

    # Warm each path once. Measurements below exclude connection/cache warm-up.
    for path, params in paths:
        response = await client.get(path, params=params)
        response.raise_for_status()
    started = perf_counter()
    await asyncio.gather(*(request(i) for i in range(requests)))
    elapsed = perf_counter() - started
    return {"scenario": name, "concurrency": concurrency, "requests": requests,
            "seconds": round(elapsed, 2), "requests_per_second": round(requests / elapsed, 2),
            "p50_ms": percentile(durations, .5), "p95_ms": percentile(durations, .95),
            "p99_ms": percentile(durations, .99), "statuses": dict(statuses), "errors": errors[:10],
            "by_path": {p: {"requests": len(v), "p50_ms": percentile(v, .5), "p95_ms": percentile(v, .95)} for p, v in by_path.items()}}


async def main(args):
    if get_settings().DATABASE_URL.rsplit("/", 1)[-1] != "renewly_load" or urlparse(args.url).hostname != "renewly-load-api":
        raise RuntimeError("Benchmarks are restricted to the disposable renewly_load database and renewly-load-api host")
    if args.seed:
        await seed(args.records)
    async with AsyncSessionLocal() as db:
        actual = (await db.execute(select(func.count(Record.id)))).scalar()
    if actual != args.records:
        raise RuntimeError(f"Expected {args.records} synthetic records, found {actual}")
    result = {"timestamp_utc": datetime.now(timezone.utc).isoformat(), "records": args.records,
              "description": "Synthetic data, direct HTTP API, warm cache; excludes browser/proxy and provider sends",
              "percentile_method": "nearest rank", "results": []}
    async with httpx.AsyncClient(base_url=args.url, timeout=120,
                                 limits=httpx.Limits(max_connections=30, max_keepalive_connections=30)) as client:
        login = await client.post("/api/v1/auth/login", json={"identifier": "load", "password": "synthetic-load-only"})
        login.raise_for_status()
        client.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
        paths = [
            ("/api/v1/records/by-type/1", {"page_size": 25}),
            ("/api/v1/search", {"q": "Load 0042"}),
            ("/api/v1/dashboard", {}),
            ("/api/v1/records/by-type/2", {"page_size": 25, "search": "Load 000"}),
        ]
        if args.forecast:
            paths.append(("/api/v1/reports/forecast", {"months": 12}))
        for concurrency in args.concurrency:
            row = await scenario(client, "interactive-mix", paths, concurrency, args.requests)
            result["results"].append(row)
            print(json.dumps(row), flush=True)
            Path(args.output).write_text(json.dumps(result, indent=2))
        today = datetime.now(timezone.utc).date()
        started = perf_counter()
        queued = await client.post('/api/v1/reports/jobs', json={'kind': 'allocation', 'record_type_id': 1,
            'start': today.replace(month=1, day=1).isoformat(), 'end': today.isoformat()})
        queued.raise_for_status()
        queue_ms = (perf_counter() - started) * 1000
        jid = queued.json()['id']
        for _ in range(300):
            state = await client.get(f'/api/v1/reports/jobs/{jid}')
            state.raise_for_status()
            if state.json()['status'] in ('ready', 'failed'): break
            await asyncio.sleep(1)
        if state.json()['status'] != 'ready': raise RuntimeError('Background allocation report did not complete')
        page_started = perf_counter()
        page = await client.get(f'/api/v1/reports/jobs/{jid}/data')
        page.raise_for_status()
        report = {'scenario': 'background-allocation', 'queue_ms': round(queue_ms, 1),
            'completion_seconds': round(perf_counter() - started, 2), 'first_page_ms': round((perf_counter() - page_started) * 1000, 1),
            'total_records': page.json()['total'], 'returned_records': len(page.json()['records'])}
        result["results"].append(report)
        print(json.dumps(report), flush=True)
    Path(args.output).write_text(json.dumps(result, indent=2))
    await engine.dispose()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://renewly-load-api:8000")
    parser.add_argument("--records", type=int, default=10000)
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--forecast", action="store_true")
    parser.add_argument("--requests", type=int, default=120)
    parser.add_argument("--concurrency", nargs="+", type=int, default=[1, 10, 25])
    parser.add_argument("--output", required=True)
    asyncio.run(main(parser.parse_args()))
