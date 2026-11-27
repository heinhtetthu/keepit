from datetime import date, datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.asyncio(loop_scope='session')


async def _headers(client):
    token = (await client.post('/api/v1/auth/login', json={'identifier': 'admin', 'password': 'admin12345'})).json()['access_token']
    return {'Authorization': f'Bearer {token}'}


async def _seed_entries():
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models import User
    from app.models.audit import AuditLog
    from app.services.audit import log_audit
    async with AsyncSessionLocal() as db:
        admin = (await db.execute(select(User).where(User.username == 'admin'))).scalar_one()
        await log_audit(db, 'asset.update', 'asset', 7, 'Dell Latitude', old_values={'location': 'HQ', 'brand': 'Dell'},
                        new_values={'location': 'Branch', 'brand': 'Dell'}, user_id=admin.id)
        await log_audit(db, 'report.export', 'report', None, 'Licences', user_id=admin.id)
        await log_audit(db, 'record.trash', 'record', 3, 'Old contract', user_id=admin.id)
        old = await log_audit(db, 'widget.frobnicate', 'gadget', None, 'Thing')  # system job, unknown action
        old.timestamp = datetime.now(timezone.utc) - timedelta(days=40)
        from app.services.audit import seal
        seal(old)
        await db.commit()
        return admin.id, AuditLog


async def test_audit_list_labels_filters_and_sort(client):
    headers = await _headers(client)
    admin_id, _ = await _seed_entries()
    url = '/api/v1/audit-logs'

    body = (await client.get(url, headers=headers, params={'page_size': 100})).json()
    by_action = {i['action']: i for i in body['items']}
    upd = by_action['asset.update']
    assert upd['action_label'] == 'Updated asset' and upd['summary'] == 'Updated asset: Dell Latitude'
    assert upd['entity_label'] == 'Asset' and upd['category'] == 'change'
    assert upd['changes'] == [{'field': 'Location', 'old': 'HQ', 'new': 'Branch'}]
    assert by_action['report.export']['action_label'] == 'Exported a report'
    assert by_action['login']['action_label'] == 'Signed in' and by_action['login']['category'] == 'signin'
    assert by_action['widget.frobnicate']['action_label'] == 'Widget frobnicate'
    assert by_action['widget.frobnicate']['user_name'] is None

    async def ids(**params):
        r = await client.get(url, headers=headers, params={'page_size': 100, **params})
        assert r.status_code == 200, r.text
        return [i['action'] for i in r.json()['items']]

    assert set(await ids(action='asset.update,report.export')) == {'asset.update', 'report.export'}
    assert set(await ids(entity_type='asset')) == {'asset.update'}
    assert 'record.trash' in await ids(category='deletion') and 'asset.update' not in await ids(category='deletion')
    assert set(await ids(category='signin')) == {'login'}
    assert await ids(user_id='0') == ['widget.frobnicate']
    assert 'widget.frobnicate' not in await ids(user_id=str(admin_id))
    assert await ids(q='Dell') == ['asset.update']
    today = date.today()
    assert 'widget.frobnicate' not in await ids(date_from=(today - timedelta(days=2)).isoformat())
    assert await ids(date_to=(today - timedelta(days=30)).isoformat()) == ['widget.frobnicate']
    asc = await ids(sort='action', order='asc')
    assert asc == sorted(asc)
    page = (await client.get(url, headers=headers, params={'page_size': 2, 'page': 1})).json()
    assert len(page['items']) == 2 and page['total'] >= 5 and page['total_pages'] >= 3

    opts = (await client.get(f'{url}/filters', headers=headers)).json()
    labels = {a['value']: a['label'] for a in opts['actions']}
    assert labels['asset.update'] == 'Updated asset' and labels['widget.frobnicate'] == 'Widget frobnicate'
    assert {'value': 'asset', 'label': 'Asset', 'category': None} in opts['entity_types']
    assert {'value': '0', 'label': 'System', 'category': None} in opts['users']
    assert any(u['value'] == str(admin_id) for u in opts['users'])
    assert [c['value'] for c in opts['categories']] == ['change', 'signin', 'deletion', 'other']
