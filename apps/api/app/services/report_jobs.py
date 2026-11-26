import asyncio
import json
import os
from pathlib import Path
from datetime import date, datetime, timedelta, timezone
from secrets import token_urlsafe
from sqlalchemy import select, and_, or_, func, text
from starlette.concurrency import run_in_threadpool
from app.db.session import AsyncSessionLocal
from app.models.report_job import ReportJob
from app.services.user import get_user
from app.services.access import ensure_type_access
from app.services.encryption import cipher
from app.core.exceptions import ForbiddenException, ValidationException

ROOT = Path('/exports')


def artifact_path(job_id):
    # IDs originate from token_urlsafe; disallow path separators defensively.
    if not job_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in job_id):
        raise ValidationException('Invalid report job id')
    return ROOT / (job_id + '.enc')


async def authorize(db, user, job):
    if job.user_id != user.id:
        raise ForbiddenException('This report belongs to another account')
    permission = 'report.view' if job.kind == 'allocation' else 'report.export'
    if not user.is_superuser and permission not in user.permissions:
        raise ForbiddenException('Required report permission is missing')
    await ensure_type_access(db, user, job.record_type_id)


async def create_job(db, user, kind, type_id, parameters):
    from app.services.throttle import limit
    await limit(db, f'exports:{user.id}', maximum=10)
    await db.execute(text('SELECT pg_advisory_xact_lock(:key)'), {'key': 9100000000 + user.id})
    await ensure_type_access(db, user, type_id)
    outstanding = (await db.execute(select(func.count()).select_from(ReportJob).where(
        ReportJob.user_id == user.id, ReportJob.status.in_(['pending', 'processing'])))).scalar()
    if outstanding >= 3: raise ValidationException('You already have three queued reports. Wait for them to finish.')
    job = ReportJob(id=token_urlsafe(24), user_id=user.id, record_type_id=type_id, kind=kind, parameters=parameters,
                    status='pending', expires_at=datetime.now(timezone.utc) + timedelta(hours=24))
    db.add(job); await db.flush()
    return job


async def process_report_job():
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db, db.begin():
        job = (await db.execute(select(ReportJob).where(ReportJob.expires_at > now,
            or_(ReportJob.status == 'pending', and_(ReportJob.status == 'processing', ReportJob.leased_until < now)))
            .order_by(ReportJob.created_at).with_for_update(skip_locked=True).limit(1))).scalar_one_or_none()
        if not job: return
        job.status = 'processing'; job.claim_token = token_urlsafe(24); job.leased_until = now + timedelta(minutes=10)
        job_id, claim = job.id, job.claim_token
    error = None; content = None; temp = None
    try:
        async with AsyncSessionLocal() as db:
            job = await db.get(ReportJob, job_id)
            user = await get_user(db, job.user_id)
            if not user.is_active: raise ForbiddenException('Account is inactive')
            await authorize(db, user, job)
            from app.models.record_type import RecordField
            await db.execute(select(RecordField.id).where(RecordField.record_type_id == job.record_type_id).with_for_update(read=True))
            from app.services import record, export, assignment
            if job.kind == 'allocation':
                from fastapi.encoders import jsonable_encoder
                data = await assignment.allocation_report(db, job.record_type_id, date.fromisoformat(job.parameters['start']), date.fromisoformat(job.parameters['end']), job.parameters.get('product'))
                content = await run_in_threadpool(lambda: json.dumps(jsonable_encoder(data)).encode())
            else:
                rows, total, rt = await record.get_records(db, job.record_type_id, page_size=10001, search=job.parameters.get('search'), status=job.parameters.get('status'))
                if total > 10000: raise ValidationException('Export exceeds 10,000 rows. Use a narrower record type or request a filtered export.')
                # Release the read transaction before rendering CPU-heavy files.
                await db.commit()
                content = await run_in_threadpool(export.export_to_excel if job.kind == 'excel' else export.export_to_pdf, rt.fields, rows, rt.name)
        if len(content) > 50 * 1024 * 1024: raise ValidationException('Report exceeds the 50 MB artifact limit')
        ROOT.mkdir(parents=True, exist_ok=True)
        encrypted = await run_in_threadpool(cipher().encrypt, content)
        temp = ROOT / (job_id + '.' + claim + '.tmp')
        await run_in_threadpool(temp.write_bytes, encrypted)
        os.chmod(temp, 0o600)
    except Exception:
        error = 'Report could not be generated. Check permissions, date range and the 10,000-row export / 50 MB artifact limits.'
    async with AsyncSessionLocal() as db, db.begin():
        job = (await db.execute(select(ReportJob).where(ReportJob.id == job_id).with_for_update())).scalar_one_or_none()
        if job and job.claim_token == claim:
            if not error and temp is not None:
                os.replace(temp, artifact_path(job_id))
            job.status = 'failed' if error else 'ready'; job.error = error
            job.size_bytes = len(content) if content is not None else None
            job.leased_until = None; job.claim_token = None
    if temp is not None: temp.unlink(missing_ok=True)


async def report_loop():
    from app.services.operations import heartbeat
    while True:
        try:
            await heartbeat('reports')
            await cleanup_artifacts()
            await asyncio.wait_for(process_report_job(), timeout=540)
            await heartbeat('reports', success=True)
        except Exception:
            await heartbeat('reports', failure=True)
        await asyncio.sleep(5)


async def cleanup_artifacts():
    now = datetime.now(timezone.utc)
    async with AsyncSessionLocal() as db, db.begin():
        jobs = (await db.execute(select(ReportJob).where(ReportJob.expires_at < now).limit(100).with_for_update(skip_locked=True))).scalars().all()
        for job in jobs:
            artifact_path(job.id).unlink(missing_ok=True)
            await db.delete(job)
    for path in ROOT.glob('*.tmp'):
        if path.stat().st_mtime < now.timestamp() - 3600:
            path.unlink(missing_ok=True)
    # Cascading deletion of a user/type removes metadata; remove orphan files
    # once their 24-hour lifetime has elapsed as well.
    for path in ROOT.glob('*.enc'):
        if path.stat().st_mtime < now.timestamp() - 86400:
            path.unlink(missing_ok=True)
