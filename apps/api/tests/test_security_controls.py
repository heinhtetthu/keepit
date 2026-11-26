from datetime import datetime, timezone
import pytest
from sqlalchemy import select, text
from app.core.config import get_settings
from app.services.mfa import totp, new_secret
from app.services.encryption import encrypt, decrypt

pytestmark = pytest.mark.asyncio(loop_scope='session')


async def login(client, **extra):
    return await client.post('/api/v1/auth/login', json={'identifier': 'admin', 'password': 'admin12345', **extra})


async def test_totp_reference_and_encryption():
    # RFC 6238 SHA-1 test vector, eight digits.
    assert totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59 // 30, digits=8) == '94287082'
    encoded = encrypt('test protected text')
    assert encoded.startswith('enc:v1:') and decrypt(encoded) == 'test protected text'
    with pytest.raises(ValueError):
        get_settings().model_copy(update={'APP_ENV': 'production', 'SECRET_KEY': 'change-me-in-production'}).validate_production()


async def test_shared_throttle_and_browser_credentials(client):
    response = await client.post('/api/v1/auth/login', headers={'X-Renewly-Client': 'browser'}, json={'identifier': 'admin', 'password': 'admin12345'})
    assert response.status_code == 200 and 'refresh_token' not in response.json()
    assert 'HttpOnly' in response.headers['set-cookie']
    for _ in range(20):
        failed = await client.post('/api/v1/auth/login', json={'identifier': 'missing', 'password': 'incorrect'})
        assert failed.status_code == 401
    assert (await client.post('/api/v1/auth/login', json={'identifier': 'missing', 'password': 'incorrect'})).status_code == 429


async def test_mfa_login_replay_recovery(client):
    from app.db.session import AsyncSessionLocal
    from app.models import User
    from app.services.mfa import recovery_codes
    secret = new_secret()
    recovery, hashes = recovery_codes()
    async with AsyncSessionLocal() as db:
        user = (await db.execute(select(User).where(User.username == 'admin'))).scalar_one()
        user.mfa_secret = encrypt(secret); user.mfa_recovery_hashes = hashes
        await db.commit()
    assert (await login(client)).json()['detail']['error']['code'] == 'MFA_REQUIRED'
    code = totp(secret, int(datetime.now(timezone.utc).timestamp() // 30))
    assert (await login(client, otp=code)).status_code == 200
    assert (await login(client, otp=code)).status_code == 401
    assert (await login(client, otp=recovery[0])).status_code == 200
    assert (await login(client, otp=recovery[0])).status_code == 401


async def test_sensitive_values_masked_encrypted_and_audited(client):
    from app.db.session import AsyncSessionLocal
    token = (await login(client)).json()['access_token']
    headers = {'Authorization': f'Bearer {token}'}
    rt = (await client.post('/api/v1/record-types', headers=headers, json={'name': 'Protected', 'fields': [{'name': 'Private credential', 'field_type': 'secret'}]})).json()
    field = rt['fields'][0]
    assert not field['searchable'] and not field['show_in_reports']
    record = (await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={'name': 'Private record', 'values': [{'field_id': field['id'], 'value': 'PRIVATE_FIXTURE_VALUE'}]})).json()
    assert record['values'][0]['value'] is None and record['values'][0]['display_value'] == '[Protected]'
    async with AsyncSessionLocal() as db:
        raw = (await db.execute(text('SELECT value::text FROM record_values WHERE record_id=:rid'), {'rid': record['id']})).scalar_one()
        assert 'PRIVATE_FIXTURE_VALUE' not in raw and 'enc:v1:' in raw
    response = await client.post(f"/api/v1/records/{record['id']}/fields/{field['id']}/reveal", headers=headers, json={'password': 'admin12345'})
    assert response.json()['value'] == 'PRIVATE_FIXTURE_VALUE' and response.headers['cache-control'] == 'no-store'
    changed = await client.put(f"/api/v1/records/{record['id']}", headers=headers, json={'values': [{'field_id': field['id'], 'value': 'NEW_PRIVATE_FIXTURE_VALUE'}]})
    assert changed.status_code == 200
    audit = (await client.get('/api/v1/audit-logs', headers=headers)).text
    assert 'field.reveal' in audit and 'NEW_PRIVATE_FIXTURE_VALUE' not in audit
    listing = await client.get(f"/api/v1/records/by-type/{rt['id']}?search=NEW_PRIVATE_FIXTURE_VALUE", headers=headers)
    assert listing.json()['total'] == 0


async def test_trash_retention_and_audit_tampering(client):
    from app.db.session import AsyncSessionLocal
    from app.models.audit import AuditLog
    from app.models.record import Record
    token = (await login(client)).json()['access_token']
    headers = {'Authorization': f'Bearer {token}'}
    rt = (await client.post('/api/v1/record-types', headers=headers, json={'name': 'Recovery'})).json()
    created = await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={'name': 'Keep me', 'values': []})
    rid = created.json()['id']
    assert (await client.delete(f'/api/v1/records/{rid}', headers=headers)).status_code == 204
    assert (await client.get(f'/api/v1/records/{rid}', headers=headers)).status_code == 404
    assert (await client.get('/api/v1/records/trash', headers=headers)).json()['total'] == 1
    assert (await client.post(f'/api/v1/records/{rid}/purge', headers=headers, json={'password': 'admin12345'})).status_code == 400
    async with AsyncSessionLocal() as db:
        assert await db.get(Record, rid)
        entry = (await db.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(1))).scalar_one()
        entry.details = 'modified outside audit service'
        await db.commit()
    integrity = (await client.get('/api/v1/security/audit-integrity', headers=headers)).json()
    assert len(integrity['invalid_ids']) == 1
    assert (await client.post(f'/api/v1/records/{rid}/restore', headers=headers)).status_code == 200
    assert (await client.get('/api/v1/records/trash', headers=headers)).json()['total'] == 0


async def test_background_report_access_expiry_and_encryption(client, monkeypatch, tmp_path):
    from app.services import report_jobs
    from app.models.report_job import ReportJob
    from app.db.session import AsyncSessionLocal
    from datetime import timedelta
    monkeypatch.setattr(report_jobs, 'ROOT', tmp_path)
    token = (await login(client)).json()['access_token']
    headers = {'Authorization': f'Bearer {token}'}
    rt = (await client.post('/api/v1/record-types', headers=headers, json={'name': 'Report test', 'fields': [{'name': 'Text', 'field_type': 'text'}]})).json()
    await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={'name': 'Export fixture', 'values': []})
    queued = await client.post('/api/v1/reports/jobs', headers=headers, json={'kind': 'excel', 'record_type_id': rt['id']})
    assert queued.status_code == 202, queued.text
    jid = queued.json()['id']
    await report_jobs.process_report_job()
    result = await client.get(f'/api/v1/reports/jobs/{jid}', headers=headers)
    assert result.json()['status'] == 'ready', result.text
    raw = report_jobs.artifact_path(jid).read_bytes()
    assert not raw.startswith(b'PK') and b'Export fixture' not in raw
    download = await client.get(f'/api/v1/reports/jobs/{jid}/download', headers=headers)
    assert download.status_code == 200 and download.content.startswith(b'PK')
    async with AsyncSessionLocal() as db:
        job = await db.get(ReportJob, jid)
        job.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        await db.commit()
    assert (await client.get(f'/api/v1/reports/jobs/{jid}/download', headers=headers)).status_code == 400
    await report_jobs.cleanup_artifacts()
    assert not report_jobs.artifact_path(jid).exists()


async def test_classification_encrypts_history_and_expires_old_reports(client):
    from app.db.session import AsyncSessionLocal
    from app.models.report_job import ReportJob
    headers = {'Authorization': f"Bearer {(await login(client)).json()['access_token']}"}
    rt = (await client.post('/api/v1/record-types', headers=headers, json={'name': 'Classify existing text', 'fields': [{'name': 'Private data', 'field_type': 'text'}]})).json()
    fid = rt['fields'][0]['id']
    record = (await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={'name': 'Classification fixture', 'values': [{'field_id': fid, 'value': 'BEFORE_CLASSIFICATION'}]})).json()
    await client.put(f"/api/v1/records/{record['id']}", headers=headers, json={'values': [{'field_id': fid, 'value': 'PRIVATE_AFTER_EDIT'}]})
    job = (await client.post('/api/v1/reports/jobs', headers=headers, json={'kind': 'excel', 'record_type_id': rt['id']})).json()
    changed = await client.put(f'/api/v1/record-types/fields/{fid}', headers=headers, json={'field_type': 'secret'})
    assert changed.status_code == 200, changed.text
    async with AsyncSessionLocal() as db:
        raw = (await db.execute(text('SELECT value::text FROM record_values WHERE record_id=:id'), {'id': record['id']})).scalar_one()
        assert 'PRIVATE_AFTER_EDIT' not in raw and 'enc:v1:' in raw
        assert (await db.get(ReportJob, job['id'])).expires_at < datetime.now(timezone.utc)
    audit = (await client.get('/api/v1/audit-logs', headers=headers)).text
    assert 'PRIVATE_AFTER_EDIT' not in audit
    integrity = (await client.get('/api/v1/security/audit-integrity', headers=headers)).json()
    assert integrity['invalid_ids'] == []
    assert (await client.get(f"/api/v1/reports/jobs/{job['id']}", headers=headers)).status_code == 400
