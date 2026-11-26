from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.api.v1 import help as assistant
from app.core.config import get_settings
from app.core.exceptions import AppException
from app.services import assistant_answers as answers

pytestmark = pytest.mark.asyncio(loop_scope='session')


async def login(client, identifier='admin', password='admin12345'):
    response = await client.post('/api/v1/auth/login', json={'identifier': identifier, 'password': password})
    return {'Authorization': f"Bearer {response.json()['access_token']}"}


async def ask(client, headers, question, type_id=None):
    return await client.post('/api/v1/help/chat', headers=headers, json={
        'messages': [{'role': 'user', 'content': question}], 'record_type_id': type_id,
    })


async def test_guide_and_casual_answers_need_no_provider(client, monkeypatch):
    headers = await login(client)
    monkeypatch.setattr(get_settings(), 'OPENAI_API_KEY', '')
    async def forbidden(*args):
        raise AssertionError('Built-in answer called OpenAI')
    monkeypatch.setattr(assistant, 'ask_openai', forbidden)
    for question, source, expected in [
        ('How do I customize Telegram reminder messages?', 'guide', '/renewals'),
        ('How do I change timezone?', 'guide', '/settings'),
        ('Tell me a joke', 'builtin', 'built-in joke'),
        ('Hello', 'builtin', 'Hello'),
        ('What can you do?', 'builtin', 'without any AI credits'),
    ]:
        response = await ask(client, headers, question)
        assert response.status_code == 200, response.text
        assert response.json()['source'] == source and expected in response.json()['answer']
    unknown = (await ask(client, headers, 'Explain quantum physics')).json()
    assert unknown['source'] == 'builtin' and 'not configured' in unknown['notice']
    denied = answers.guide_answer('How do I customize reminders?', SimpleNamespace(is_superuser=False, permissions=set()))
    assert 'outside your current permissions' in denied['answer'] and '/renewals' not in denied['answer']


async def test_record_answers_respect_boundaries_access_and_limits(client, monkeypatch):
    from app.db.session import AsyncSessionLocal
    from app.models import RecordType, RecordField, Record, RecordValue, User, Role, Permission, UserRecordTypeAccess
    from app.core.security import hash_password
    today = date(2030, 1, 1)
    async def fixed_today(db): return today
    monkeypatch.setattr(answers, 'app_today', fixed_today)
    monkeypatch.setattr(get_settings(), 'OPENAI_API_KEY', '')
    async with AsyncSessionLocal() as db:
        rt = RecordType(name='Visible subscriptions', slug='visible-subscriptions')
        private = RecordType(name='Private type', slug='private-type')
        db.add_all([rt, private]); await db.flush()
        field = RecordField(record_type_id=rt.id, name='Expiry', slug='expiry', field_type='date')
        private_field = RecordField(record_type_id=private.id, name='Expiry', slug='expiry', field_type='date')
        db.add_all([field, private_field]); await db.flush()
        rt.reminder_field_id = field.id; private.reminder_field_id = private_field.id
        async def add(name, value, private_record=False, **kwargs):
            r = Record(name=name, record_type_id=private.id if private_record else rt.id, **kwargs)
            db.add(r); await db.flush()
            db.add(RecordValue(record_id=r.id, field_id=private_field.id if private_record else field.id, value={'value': value}))
        for day in range(12):
            await add(f'Upcoming {day}', (today + timedelta(days=day)).isoformat())
        await add('Day 30', (today + timedelta(days=30)).isoformat())
        await add('Day 31', (today + timedelta(days=31)).isoformat())
        await add('Overdue record', (today - timedelta(days=1)).isoformat())
        await add('Archived record', today.isoformat(), archived=True)
        await add('Deleted record', today.isoformat(), deleted_at=datetime.now(timezone.utc))
        await add('Bad legacy date', 'not-a-date')
        await add('PRIVATE NAME NEVER VISIBLE', today.isoformat(), private_record=True)
        perm = (await db.execute(select(Permission).where(Permission.name == 'record.view'))).scalar_one()
        user = User(email='builtin@example.com', username='builtin-test', name='Limited viewer', hashed_password=hash_password('test-password'), roles=[Role(name='Built-in test role', permissions=[perm])])
        db.add(user); await db.flush()
        db.add(UserRecordTypeAccess(user_id=user.id, record_type_id=rt.id))
        tid, hidden_tid, uid = rt.id, private.id, user.id
        await db.commit()
    headers = await login(client, 'builtin-test', 'test-password')
    upcoming = (await ask(client, headers, 'What expires in the next 30 days?')).json()
    assert upcoming['source'] == 'records' and '13 records expiring' in upcoming['answer']
    assert 'earliest 10 of 13' in upcoming['answer'] and 'Upcoming 0' in upcoming['answer']
    assert len(upcoming['table']['rows']) == 10
    assert upcoming['table']['rows'][0]['date'] == today.isoformat()
    assert upcoming['table']['rows'][0]['name'] == 'Upcoming 0'
    assert upcoming['table']['rows'][0]['url'].startswith('/records/visible-subscriptions/')
    assert 'earliest 10 of 13' in upcoming['table']['note']
    assert 'PRIVATE' not in str(upcoming['table'])
    assert 'PRIVATE' not in upcoming['answer'] and 'Archived record' not in upcoming['answer'] and 'Deleted record' not in upcoming['answer']
    tomorrow = (await ask(client, headers, 'What expires tomorrow?', tid)).json()['answer']
    assert '1 records expiring' in tomorrow and 'Upcoming 1' in tomorrow and 'Upcoming 0' not in tomorrow
    overdue = (await ask(client, headers, 'Show overdue records')).json()['answer']
    assert '1 records overdue' in overdue and 'Overdue record' in overdue
    count = (await ask(client, headers, 'How many records do I have?')).json()['answer']
    assert '16 records' in count
    assert (await ask(client, headers, 'What expires today?', hidden_tid)).status_code == 403
    for question in ['What expires in the next 500 days?', 'What expires in 5 days?', 'What expires next month?']:
        response = (await ask(client, headers, question)).json()
        assert response['source'] == 'records' and 'records expiring' not in response['answer']
    # Revocation is checked afresh, even for a locally answered question.
    async with AsyncSessionLocal() as db:
        from sqlalchemy import delete
        await db.execute(delete(UserRecordTypeAccess).where(UserRecordTypeAccess.user_id == uid))
        await db.commit()
    assert (await ask(client, headers, 'Hello', tid)).status_code == 403
    assert 'no active record types available' in (await ask(client, headers, 'What expires soon?')).json()['answer']


async def test_ai_failure_returns_labelled_local_fallback(client, monkeypatch):
    headers = await login(client)
    monkeypatch.setattr(get_settings(), 'OPENAI_API_KEY', 'test-key')
    monkeypatch.setattr(get_settings(), 'OPENAI_MODEL', 'test-model')
    async def unavailable(*args):
        raise AppException('AI_CREDITS_EXHAUSTED', 'OpenAI API credits are exhausted.', 503)
    monkeypatch.setattr(assistant, 'ask_openai', unavailable)
    response = await ask(client, headers, 'Explain quantum physics')
    assert response.status_code == 200
    assert response.json()['source'] == 'builtin' and 'credits are exhausted' in response.json()['notice']
    # The failed AI call/cooldown cannot block subsequent built-in questions.
    assert (await ask(client, headers, 'How do I customize reminder messages?')).json()['source'] == 'guide'
    assert (await ask(client, headers, 'Hello')).json()['source'] == 'builtin'
