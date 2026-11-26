"""Seed sample records using the same generic engine.

Faithfully mirrors the seeded Subscription / Domain / License schemas.
Run: python -m app.seed_records
"""
import asyncio
import logging
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.session import AsyncSessionLocal
from app.models.record import Record, RecordValue
from app.models.record_type import RecordType
from app.models.user import User

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("seed_records")

TODAY = date.today()


def in_days(n: int) -> str:
    return (TODAY + timedelta(days=n)).isoformat()


def ago_days(n: int) -> str:
    return (TODAY - timedelta(days=n)).isoformat()


SEED_DATA: dict[str, list[tuple[str, str, list[tuple[str, object]]]]] = {
    # slug -> [(record_name, status, [(field_slug, value), ...])]
    "subscription": [
        ("Microsoft 365 Business", "active", [
            ("provider", "Microsoft"), ("account_username", "allen@company.com"),
            ("category", "Software"), ("cost", 913), ("currency", "USD"),
            ("billing_cycle", "Yearly"), ("start_date", ago_days(200)), ("renewal_date", in_days(7)),
            ("auto_renewal", True), ("payment_method", "Company Card"), ("url", "https://microsoft365.com"),
        ]),
        ("Adobe Creative Cloud", "active", [
            ("provider", "Adobe"), ("category", "Software"), ("cost", 60), ("currency", "USD"),
            ("billing_cycle", "Monthly"), ("start_date", ago_days(90)), ("renewal_date", in_days(3)),
            ("auto_renewal", False), ("payment_method", "Company Card"),
        ]),
        ("Slack Business+", "active", [
            ("provider", "Salesforce"), ("category", "Cloud"), ("cost", 150), ("currency", "USD"),
            ("billing_cycle", "Yearly"), ("renewal_date", in_days(30)), ("auto_renewal", True),
        ]),
        ("Figma Organization", "active", [
            ("provider", "Figma"), ("category", "Cloud"), ("cost", 330), ("currency", "USD"),
            ("billing_cycle", "Yearly"), ("renewal_date", in_days(55)), ("auto_renewal", False),
        ]),
        ("Netflix Team Plan", "cancelled", [
            ("provider", "Netflix"), ("category", "Media"), ("cost", 20), ("currency", "USD"),
            ("billing_cycle", "Monthly"), ("renewal_date", in_days(10)), ("auto_renewal", False),
        ]),
    ],
    "domain": [
        ("company.com", "active", [
            ("domain_name", "company.com"), ("registrar", "Namecheap"), ("registrant_owner", "IT Dept"),
            ("registration_date", ago_days(700)), ("expiry_date", in_days(5)), ("auto_renewal", True),
            ("cost", 15), ("currency", "USD"), ("dns_provider", "Cloudflare"), ("account", "nc-account-01"),
        ]),
        ("company.org", "active", [
            ("domain_name", "company.org"), ("registrar", "GoDaddy"), ("registrant_owner", "Marketing"),
            ("expiry_date", in_days(60)), ("auto_renewal", False), ("cost", 22), ("currency", "USD"),
            ("dns_provider", "Route53"),
        ]),
        ("legacy-brand.net", "expired", [
            ("domain_name", "legacy-brand.net"), ("registrar", "Namecheap"), ("expiry_date", ago_days(15)),
            ("auto_renewal", False), ("cost", 18), ("currency", "USD"),
        ]),
        ("shop.company.com", "active", [
            ("domain_name", "shop.company.com"), ("registrar", "Cloudflare"), ("expiry_date", in_days(7)),
            ("auto_renewal", True), ("cost", 12), ("currency", "USD"), ("dns_provider", "Cloudflare"),
        ]),
    ],
    "license": [
        ("Windows Server 2022 Std", "active", [
            ("product_name", "Windows Server 2022 Standard"), ("vendor", "Microsoft"),
            ("license_type", "Perpetual"), ("license_key", "XXXXX-XXXXX-XXXXX-XXXXX-0001"),
            ("assigned_to", "srv-prod-01"), ("number_of_seats", 5), ("purchase_date", ago_days(400)),
            ("expiry_date", in_days(30)), ("cost", 980), ("currency", "USD"),
        ]),
        ("JetBrains All Products Pack", "active", [
            ("product_name", "JetBrains All Products"), ("vendor", "JetBrains"),
            ("license_type", "Subscription"), ("license_key", "JB-SEAT-88213"),
            ("assigned_to", "dev-team"), ("number_of_seats", 10), ("purchase_date", ago_days(300)),
            ("expiry_date", in_days(1)), ("auto_renewal", True), ("cost", 779), ("currency", "USD"),
        ]),
        ("Office 2021 Perpetual", "active", [
            ("product_name", "Microsoft Office 2021"), ("vendor", "Microsoft"),
            ("license_type", "Perpetual"), ("assigned_to", "finance-desk"), ("number_of_seats", 2),
            ("purchase_date", ago_days(500)), ("cost", 440), ("currency", "USD"),
        ]),
        ("Old Antivirus Suite", "expired", [
            ("product_name", "Legacy AV Suite"), ("vendor", "Symantec"),
            ("license_type", "Subscription"), ("expiry_date", ago_days(45)),
            ("auto_renewal", False), ("cost", 320), ("currency", "USD"),
        ]),
    ],
}


async def seed_records(db: AsyncSession) -> None:
    admin = (await db.execute(select(User).order_by(User.id))).scalars().first()
    if not admin:
        logger.warning("No users found. Run app.seed first.")
        return

    types = (await db.execute(
        select(RecordType).options(selectinload(RecordType.fields))
    )).scalars().all()

    created = 0
    for type_slug, entries in SEED_DATA.items():
        rt = next((t for t in types if t.slug == type_slug), None)
        if not rt:
            logger.warning("Record type %s not found; skipping", type_slug)
            continue

        # Set the reminder field per record type (Expiry/Renewal date field)
        reminder_field = next((f for f in rt.fields if f.name in ("Renewal Date", "Expiry Date")), None)
        if reminder_field:
            rt.reminder_field_id = reminder_field.id

        fmap = {f.slug: f for f in rt.fields}

        for record_name, status, values in entries:
            fv = [(fmap[s].id, v) for (s, v) in values if s in fmap]
            name = record_name if type_slug != "domain" else next((v for s, v in values if s == "domain_name"), record_name)
            record = (await db.execute(
                select(Record).where(Record.record_type_id == rt.id, Record.name == name)
                .options(selectinload(Record.values))
            )).scalars().first()

            if record is None:
                record = Record(record_type_id=rt.id, name=name, status=status, created_by=admin.id)
                db.add(record)
                await db.flush()

            existing_field_ids = set((await db.execute(
                select(RecordValue.field_id).where(RecordValue.record_id == record.id)
            )).scalars().all())
            for field_id, value in fv:
                if field_id not in existing_field_ids:
                    db.add(RecordValue(record_id=record.id, field_id=field_id, value={"value": value}))
            created += 1

    await db.commit()
    logger.info("Seeded %d sample records (+ values backfilled)", created)


REMINDER_INTERVALS = (60, 30, 14, 7, 3, 1, 0)


async def seed_rules(db: AsyncSession) -> None:
    """Create default reminder rules for every record type that has a reminder field."""
    from app.models.reminder import ReminderRule

    types = (await db.execute(select(RecordType).options(selectinload(RecordType.fields)))).scalars().all()
    existing = (await db.execute(select(ReminderRule))).scalars().all()
    existing_keys = {(r.record_type_id, r.days_before) for r in existing}

    created = 0
    for rt in types:
        if not rt.reminder_field_id:
            continue
        for days in REMINDER_INTERVALS:
            if (rt.id, days) in existing_keys:
                continue
            label = "On the day" if days == 0 else f"{days} days before"
            db.add(ReminderRule(record_type_id=rt.id, name=label, days_before=days, active=True))
            created += 1
    await db.commit()
    logger.info("Seeded %d reminder rules", created)


async def seed_due_now(db: AsyncSession) -> None:
    """Add a subscription renewing TODAY so the 0-day rule can be exercised."""
    from app.models.reminder import ReminderRule  # noqa: F401

    admin = (await db.execute(select(User).order_by(User.id))).scalars().first()
    rt = (await db.execute(select(RecordType).where(RecordType.slug == "subscription").options(selectinload(RecordType.fields)))).scalars().first()
    if not admin or not rt:
        return
    fmap = {f.slug: f for f in rt.fields}
    if "renewal_date" not in fmap:
        return
    existing = await db.execute(select(Record).where(Record.record_type_id == rt.id, Record.name == "Zoom Pro"))
    if existing.scalar_one_or_none():
        return
    record = Record(record_type_id=rt.id, name="Zoom Pro", status="active", created_by=admin.id)
    db.add(record)
    await db.flush()
    values = [("provider", "Zoom"), ("category", "Cloud"), ("cost", 200), ("currency", "USD"),
              ("billing_cycle", "Yearly"), ("renewal_date", TODAY.isoformat()), ("auto_renewal", True)]
    for slug, value in values:
        if slug in fmap:
            db.add(RecordValue(record_id=record.id, field_id=fmap[slug].id, value={"value": value}))
    await db.commit()
    logger.info("Seeded due-today test record: Zoom Pro")


async def run_seed_records():
    async with AsyncSessionLocal() as db:
        await seed_records(db)
        await seed_rules(db)
        await seed_due_now(db)


if __name__ == "__main__":
    asyncio.run(run_seed_records())
