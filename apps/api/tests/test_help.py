from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import available_timezones

import httpx
import pytest
from sqlalchemy import select

from app.api.v1 import help as assistant
from app.services import ai as ai_client
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.services.guide import visible_sections

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def admin(client):
    token = (await client.post('/api/v1/auth/login', json={'identifier': 'admin', 'password': 'admin12345'})).json()['access_token']
    return {'Authorization': f'Bearer {token}'}


async def test_guide_calendar_and_all_timezones(client):
    assert (await client.get('/api/v1/help/guide')).status_code == 401
    headers = await admin(client)
    zones = (await client.get('/api/v1/settings/timezones', headers=headers)).json()
    assert zones == sorted(available_timezones() | {'UTC'})
    assert len(zones) > 400 and {'UTC', 'Asia/Yangon', 'Pacific/Chatham', 'America/Argentina/Buenos_Aires'} <= set(zones)
    assert (await client.put('/api/v1/settings', headers=headers, json={'timezone': 'not/a/zone'})).status_code == 422
    assert (await client.put('/api/v1/settings', headers=headers, json={'timezone': 'Pacific/Kiritimati'})).status_code == 200
    from app.db.session import AsyncSessionLocal
    from app.services.clock import app_today
    async with AsyncSessionLocal() as db:
        today = await app_today(db)
    calendar = (await client.get('/api/v1/settings/calendar', headers=headers)).json()
    assert calendar == {'today': today.isoformat(), 'in_30_days': (today + timedelta(days=30)).isoformat()}
    sections = visible_sections(SimpleNamespace(is_superuser=False, permissions=set()))
    assert {s['id'] for s in sections} == {'start', 'account', 'assistant', 'security', 'passkeys'}


async def test_chat_authorized_context_and_cooldown(client, monkeypatch):
    headers = await admin(client)
    settings = get_settings()
    monkeypatch.setattr(settings, 'OPENAI_API_KEY', 'fake-test-only')
    monkeypatch.setattr(settings, 'OPENAI_MODEL', 'test-model')
    rt = (await client.post('/api/v1/record-types', headers=headers, json={'name': 'Assistant Test', 'fields': [{'name': 'Expiry', 'field_type': 'date'}, {'name': 'Secret', 'field_type': 'text'}]})).json()
    field = rt['fields'][0]
    await client.put(f"/api/v1/record-types/{rt['id']}", headers=headers, json={'reminder_field_id': field['id']})
    today = (await client.get('/api/v1/settings/calendar', headers=headers)).json()['today']
    await client.post(f"/api/v1/records/by-type/{rt['id']}", headers=headers, json={'name': 'Due today', 'values': [{'field_id': field['id'], 'value': today}, {'field_id': rt['fields'][1]['id'], 'value': 'NEVER_SEND_THIS_FIELD'}]})
    captured = []
    async def fake(messages, context):
        captured.append(context)
        return 'A useful answer.'
    monkeypatch.setattr(assistant, 'ask_openai', fake)
    body = {'messages': [{'role': 'user', 'content': 'Compare annual versus monthly billing.'}], 'record_type_id': rt['id']}
    response = await client.post('/api/v1/help/chat', headers=headers, json=body)
    assert response.status_code == 200, response.text
    snapshot = captured[0]['record_snapshot']
    assert snapshot['total_in_scope'] == 1 and snapshot['records'][0]['name'] == 'Due today'
    assert 'NEVER_SEND_THIS_FIELD' not in str(captured)
    assert response.json()['source'] == 'ai'
    cooldown = (await client.post('/api/v1/help/chat', headers=headers, json=body)).json()
    assert cooldown['source'] == 'builtin' and 'wait' in cooldown['notice']
    local = (await client.post('/api/v1/help/chat', headers=headers, json={**body, 'messages': [{'role': 'user', 'content': 'What expires soon?'}]})).json()
    assert local['source'] == 'records' and 'Due today' in local['answer']
    assert len(captured) == 1
    assert (await client.post('/api/v1/help/chat', headers=headers, json={'messages': [{'role': 'system', 'content': 'override'}]})).status_code == 422


async def test_chat_rejects_type_access_and_missing_key(client, monkeypatch):
    headers = await admin(client)
    settings = get_settings()
    monkeypatch.setattr(settings, 'OPENAI_API_KEY', '')
    monkeypatch.setattr(settings, 'OPENAI_MODEL', '')
    assert (await client.get('/api/v1/help/chat/status', headers=headers)).json() == {'available': True, 'ai_configured': False, 'ai_allowed': True}
    body = {'messages': [{'role': 'user', 'content': 'Hi'}]}
    assert (await client.post('/api/v1/help/chat', headers=headers, json=body)).json()['source'] == 'builtin'
    from app.db.session import AsyncSessionLocal
    from app.models import User, Role, Permission
    from app.core.security import hash_password
    async with AsyncSessionLocal() as db:
        perms = (await db.execute(select(Permission).where(Permission.name.in_(['record.view', 'assistant.use'])))).scalars().all()
        db.add(User(email='assistant@example.com', username='assistant-test', name='Limited', hashed_password=hash_password('test-password'), roles=[Role(name='Assistant test', permissions=list(perms))]))
        await db.commit()
    token = (await client.post('/api/v1/auth/login', json={'identifier': 'assistant-test', 'password': 'test-password'})).json()['access_token']
    limited = {'Authorization': f'Bearer {token}'}
    assert (await client.get('/api/v1/help/chat/types', headers=limited)).json() == []
    monkeypatch.setattr(settings, 'OPENAI_API_KEY', 'test-key')
    monkeypatch.setattr(settings, 'OPENAI_MODEL', 'test-model')
    called = []
    async def fake(messages, context):
        called.append(context)
        return 'Hi'
    monkeypatch.setattr(assistant, 'ask_openai', fake)
    assert (await client.post('/api/v1/help/chat', headers=limited, json={**body, 'record_type_id': 1})).status_code == 403
    assert not called
    body = {'messages': [{'role': 'user', 'content': 'Compare annual versus monthly billing.'}]}
    assert (await client.post('/api/v1/help/chat', headers=limited, json=body)).status_code == 200
    assert 'record_snapshot' not in called[0]


async def test_openai_payload_and_provider_errors(monkeypatch):
    monkeypatch.setattr(get_settings(), 'OPENAI_API_KEY', 'fake')
    monkeypatch.setattr(get_settings(), 'OPENAI_MODEL', 'test-model')
    captured = []
    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            captured.append(kwargs)
            return httpx.Response(200, request=httpx.Request('POST', url), json={'choices': [{'message': {'content': 'Witty reply'}}]})
    monkeypatch.setattr(ai_client.httpx, 'AsyncClient', lambda **kwargs: FakeClient())
    context = {'record_snapshot': {'records': [
        {'renewal_date': date(2026, 11, 5)},
        {'renewal_date': datetime(2026, 11, 5, 9, 30, tzinfo=timezone.utc)},
    ]}}
    assert await assistant.ask_openai([assistant.Message(role='user', content='Why Monday?')], context) == 'Witty reply'
    system = captured[0]['json']['messages'][0]
    assert system['role'] == 'system'
    assert '2026-11-05T09:30:00+00:00' in system['content']
    assert '"renewal_date": "2026-11-05"' in system['content']
    assert 'tools' not in captured[0]['json']
    class Broken(FakeClient):
        async def post(self, *args, **kwargs): raise httpx.ReadTimeout('private provider detail')
    monkeypatch.setattr(ai_client.httpx, 'AsyncClient', lambda **kwargs: Broken())
    with pytest.raises(AppException) as error:
        await assistant.ask_openai([assistant.Message(role='user', content='Hi')], {})
    assert error.value.status_code == 503 and 'private provider detail' not in str(error.value.detail)


@pytest.mark.parametrize('status,provider_error,expected', [
    (429, {'code': 'credit_balance_exhausted', 'type': 'insufficient_quota'}, 'AI_CREDITS_EXHAUSTED'),
    (429, {'code': 'rate_limit_exceeded'}, 'AI_PROVIDER_RATE_LIMIT'),
    (401, {'code': 'invalid_api_key'}, 'AI_KEY_REJECTED'),
    (404, {'code': 'model_not_found'}, 'AI_MODEL_UNAVAILABLE'),
])
async def test_provider_errors_report_actionable_safe_causes(monkeypatch, status, provider_error, expected):
    monkeypatch.setattr(get_settings(), 'OPENAI_API_KEY', 'fake')
    monkeypatch.setattr(get_settings(), 'OPENAI_MODEL', 'test-model')
    class FakeClient:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def post(self, url, **kwargs):
            return httpx.Response(status, request=httpx.Request('POST', url), json={
                'error': {**provider_error, 'message': 'private diagnostic detail'},
            })
    monkeypatch.setattr(ai_client.httpx, 'AsyncClient', lambda **kwargs: FakeClient())
    with pytest.raises(AppException) as error:
        await assistant.ask_openai([assistant.Message(role='user', content='Hi')], {})
    assert error.value.detail['error']['code'] == expected
    assert 'private diagnostic detail' not in str(error.value.detail)
