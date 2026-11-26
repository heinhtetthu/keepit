from datetime import date, datetime, timezone
import json
import csv
from io import StringIO
from cryptography.fernet import InvalidToken
from typing import Literal
from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
from app.api.deps import require_permission, get_current_user
from app.db.session import get_db
from app.models.report_job import ReportJob
from app.services import report_jobs as service
from app.services.encryption import cipher
from app.services.audit import log_audit
from app.core.exceptions import NotFoundException, ValidationException

router = APIRouter(prefix='/reports/jobs', tags=['report-jobs'])


class JobCreate(BaseModel):
    kind: Literal['excel', 'pdf', 'allocation']
    record_type_id: int = Field(gt=0)
    start: date | None = None
    end: date | None = None
    product: str | None = Field(default=None, max_length=500)
    search: str | None = Field(default=None, max_length=200)
    status: str | None = Field(default=None, max_length=50)


def status(job):
    return {'id': job.id, 'kind': job.kind, 'status': job.status, 'error': job.error, 'created_at': job.created_at,
            'expires_at': job.expires_at, 'size_bytes': job.size_bytes, 'record_type_id': job.record_type_id}


async def get_job(db, user, job_id):
    job = await db.get(ReportJob, job_id)
    if not job: raise NotFoundException('Report job not found')
    await service.authorize(db, user, job)
    if job.expires_at <= datetime.now(timezone.utc): raise ValidationException('Report artifact expired. Generate a new report.')
    return job


@router.post('', status_code=202)
async def create(data: JobCreate, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    from app.core.exceptions import ForbiddenException
    permission = 'report.view' if data.kind == 'allocation' else 'report.export'
    if not user.is_superuser and permission not in user.permissions: raise ForbiddenException('Required report permission is missing')
    if data.kind == 'allocation' and (not data.start or not data.end or data.end < data.start or (data.end - data.start).days > 3660):
        raise ValidationException('Allocation requires a valid date window of at most ten years')
    params = {'start': data.start.isoformat() if data.start else None, 'end': data.end.isoformat() if data.end else None, 'product': data.product, 'search': data.search, 'status': data.status}
    job = await service.create_job(db, user, data.kind, data.record_type_id, params)
    await log_audit(db, 'report.queue', 'record_type', data.record_type_id, user_id=user.id, details=f'Queued {data.kind} report')
    return status(job)


@router.get('')
async def list_jobs(db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    jobs = (await db.execute(select(ReportJob).where(ReportJob.user_id == user.id, ReportJob.expires_at > datetime.now(timezone.utc)).order_by(ReportJob.created_at.desc()).limit(20))).scalars().all()
    visible = []
    from app.services.access import allowed_type_ids
    allowed = await allowed_type_ids(db, user)
    for job in jobs:
        permitted = user.is_superuser or ('report.view' if job.kind == 'allocation' else 'report.export') in user.permissions
        if permitted and (allowed is None or job.record_type_id in allowed): visible.append(status(job))
    return visible


@router.get('/{job_id}')
async def get_status(job_id: str, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(get_current_user)):
    return status(await get_job(db, user, job_id))


async def read_content(db, user, job_id):
    job = await get_job(db, user, job_id)
    if job.status != 'ready': raise ValidationException('Report is not ready')
    try:
        encrypted = await run_in_threadpool(service.artifact_path(job.id).read_bytes)
        content = await run_in_threadpool(cipher().decrypt, encrypted)
    except (OSError, ValueError, InvalidToken):
        raise NotFoundException('Report artifact unavailable. Generate a new report.')
    return job, content


@router.get('/{job_id}/download')
async def download(job_id: str, db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission('report.export'))):
    job, content = await read_content(db, user, job_id)
    kinds = {'excel': ('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'pdf': ('pdf', 'application/pdf'), 'allocation': ('csv', 'text/csv; charset=utf-8')}
    if job.kind == 'allocation':
        content = await run_in_threadpool(allocation_csv, content)
    extension, mime = kinds[job.kind]
    await log_audit(db, 'report.download', 'record_type', job.record_type_id, user_id=user.id)
    return Response(content, media_type=mime, headers={'Content-Disposition': f'attachment; filename="report_{job.id}.{extension}"', 'Cache-Control': 'no-store'})


def allocation_csv(content):
    data = json.loads(content)
    output = StringIO()
    writer = csv.writer(output)
    writer.writerow(['Record', 'Product', 'Holder', 'Business unit', 'From', 'To', 'Days', 'Cost', 'Currency', 'Allocated'])
    def safe(value):
        return "'" + value if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')) else value
    for row in data['records']:
        for span in row['spans']:
            writer.writerow([safe(v) for v in [row['name'], row.get('product'), span['employee_name'], span['business_unit'], span['from'], span['to'], span['days'], span['cost'], span['currency'], span['allocated']]])
    return ('\ufeff' + output.getvalue()).encode()


@router.get('/{job_id}/data')
async def allocation_data(job_id: str, page: int = Query(1, ge=1), page_size: int = Query(50, ge=1, le=100),
                          db: AsyncSession = Depends(get_db, scope="function"), user=Depends(require_permission('report.view'))):
    job, content = await read_content(db, user, job_id)
    if job.kind != 'allocation': raise ValidationException('This report does not contain allocation data')
    data = await run_in_threadpool(json.loads, content)
    total = len(data['records'])
    data['records'] = data['records'][(page - 1) * page_size:page * page_size]
    return {**data, 'total': total, 'page': page, 'page_size': page_size}
