"""Small, explicit answer intents. These are application answers, not an LLM."""
import re
from datetime import timedelta

from sqlalchemy import select, func, and_

from app.models.record import Record, RecordValue
from app.models.record_type import RecordType, RecordField
from app.services.access import allowed_type_ids
from app.services.clock import app_today
from app.services.date_query import field_date
from app.services.guide import visible_sections


_DASHES = '\u2014\u2013\u2012\u2015'
_RANGE = re.compile(r'(?<=\d)\s*[\u2013\u2014\u2012]\s*(?=\d)')
_SPACED = re.compile(r'\s+[\u2014\u2013\u2012\u2015]+\s+')
_LINE_START = re.compile(r'(?m)^(\s*)[\u2014\u2013\u2012\u2015]+\s*')
_TRAILING_LABEL = re.compile(r'(?m)^([^\n]{1,60}?)[\u2014\u2013\u2012\u2015]+\s*$')


def strip_dashes(text):
    """Replace em and en dashes so assistant answers never contain them.

    Number ranges become a hyphen (1-3), a dash used as a pause between words
    becomes a comma, a dash ending a short label becomes a colon, a dash at the start of a line becomes a list hyphen and any
    other dash becomes a plain hyphen."""
    if not isinstance(text, str) or not any(d in text for d in _DASHES):
        return text
    text = _RANGE.sub('-', text)
    text = _LINE_START.sub(lambda m: m.group(1) + '- ', text)
    text = _TRAILING_LABEL.sub(lambda m: m.group(1).rstrip() + ':', text)
    text = _SPACED.sub(', ', text)
    text = re.sub(r'(?<=\w)[\u2014\u2015]+(?=\w)', ', ', text)  # unspaced em dash: a pause
    text = re.sub('[' + _DASHES + ']', '-', text)  # en dash in a compound, or a stray dash
    return text.replace(',,', ',')


def sanitize_reply(value):
    """Apply strip_dashes to every string in an answer payload (answer, notice, table)."""
    if isinstance(value, str):
        return strip_dashes(value)
    if isinstance(value, dict):
        return {k: sanitize_reply(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_reply(v) for v in value]
    return value


def reply(answer, source='builtin', **extra):
    return {'answer': answer, 'source': source, **extra}


def built_in_help(user=None):
    has = (lambda p: True) if user is None or user.is_superuser else (lambda p: p in user.permissions)
    tips = []
    if has('asset.view'):
        tips += ['• How many assets do we have?', '• Which warranties expire soon?']
    if has('itlog.view'):
        tips += ['• Which borrowed items are overdue?']
    if has('record.view'):
        tips += ['• Which records expire in the next 30 days?', '• Show overdue records']
    tips += ['• How do I log a repair / lend an item / offboard someone?', '• How do I add a passkey?']
    return reply("I can answer questions about your assets, people and renewals without any AI credits. Try:\n\n"
                 + "\n".join(tips) + "\n\n"
                 "For renewals, pick a record type above to narrow the answer; otherwise I check every type you can access. "
                 "Open-ended questions need the optional AI connection. My built-in answers have a smaller vocabulary, but excellent attendance.")


def guide_answer(question, user):
    q = question.lower().strip()
    topics = [
        ('passkeys', r'passkey|forgot.*password|reset.*password|api token|\bmcp\b'),
        ('itlogs', r'\b(borrow\w*|lend\w*|repair\w*|maintenance|it logs?)\b'),
        ('documents', r'document|upload|invoice'),
        ('assign', r'offboard\w*|quick assign|assign\w* (an |the )?(asset|laptop|device)|new hire'),
        ('people', r'employee 360|employee profile|employee directory'),
        ('assets', r'\b(assets?|laptops?|devices?|qr|serial|spec template|auto number)\b'),
        ('security', r'authenticator|\bmfa\b|two.factor|protected (text|field)|encrypted|encryption|backup'),
        ('recovery', r'\btrash\b|recover.*record|restore.*record|permanent.*delet'),
        ('background-reports', r'background report|download.*report|starting view'),
        ('settings', r'time\s*zone|system settings|application name'),
        ('renewals', r'telegram.*message|message.*template|reminder|renewals'),
        ('notifications', r'\b(telegram|notifications?|bots?|recipients?)\b'),
        ('create', r'import|duplicate|create.*record|add.*record'),
        ('renew-record', r'reassign|ownership|renew a record|auto.?renew|renewal history'),
        ('reports', r'\b(forecast\w*|reports?|allocation)\b'),
        ('types', r'\brecord types?\b|\bfields?\b|\bschema\b'),
        ('audit', r'\baudit\b'), ('users', r'\b(users|roles|permissions)\b'),
        ('account', r'password|avatar|profile|sign.?out|my account'),
        ('records', r'record|filters?|sorting|columns?|saved views?|expir'),
        ('dashboard', r'dashboard'), ('start', r'navigat|recently viewed|search|sidebar|get around|create menu|dark mode|theme'),
        ('assistant', r'assistant|chat'),
    ]
    if not re.search(r'\b(how (do|can|to)|where|explain|help|what is|what are|guide)\b', q):
        return None
    if re.search(r'expir|overdue|due today|due tomorrow', q) and not re.search(r'how (do|can|to)|where|guide|help', q):
        return None
    topic = next((key for key, pattern in topics if re.search(pattern, q)), None)
    if not topic:
        return None
    section = next((s for s in visible_sections(user) if s['id'] == topic), None)
    if section is None:
        return reply('That topic is outside your current permissions. Ask your administrator if you need access. You can open /system-guide for the topics available to you.', 'guide')
    return reply(section['title'] + '\n\n' + '\n\n'.join(f'• {step}' for step in section['steps']) + '\n\nOpen: ' + section['path'], 'guide')


def casual_answer(question, user=None):
    q = question.lower().strip(' .!?\n')
    if q in {'hi', 'hello', 'hey', 'good morning', 'good evening'}:
        return reply('Hello! Ask me what needs attention: overdue borrows, warranties ending, renewals expiring soon, or how to do something. Paperwork rarely says hello back, so this is already an improvement.')
    if q in {'thanks', 'thank you', 'thankyou'}:
        return reply('You’re welcome! May your laptops come back on time and your renewals stay pleasantly boring.')
    if q in {'help', 'what can you do', 'system guide', 'what can i ask', 'guide'}:
        return built_in_help(user)
    if re.fullmatch(r'(please )?(tell me |give me )?(a )?joke( please)?', q):
        return reply('Why did the laptop sign up for a warranty? It wanted a little extra coverage before its next renewal.\n\nThat one comes from the built-in joke shelf, no AI credits were harmed.')
    if q in {'why do mondays exist', 'why monday', 'why mondays'}:
        return reply('Monday gives the weekend a dramatic ending. For calendar history you’ll need the optional AI connection; for overdue borrows and upcoming renewals, I’m already on duty.')
    return None


async def record_answer(db, user, question, type_id):
    q = question.lower()
    expiry = bool(re.search(r'\b(expir\w*|overdue|upcoming|due)\b|next renewal|needs? (my )?attention', q))
    total = bool(re.search(r'\b(how many|count|total|number of)\b', q) and re.search(r'record|subscription|licen[cs]e|domain', q))
    if not expiry and not total:
        return None
    if re.search(r'cost|currency|price|days (until|left)|archived|deleted|between', q):
        return reply('That record question needs more detail than built-in chat supports. Open Records or Reports for costs, exact date ranges and archived history. I can count records or list upcoming/overdue renewal dates.', 'records')
    if not user.is_superuser and 'record.view' not in user.permissions:
        return reply('You need record-view permission to ask about record data. I can still help with the guide topics available to your account.', 'records')
    allowed = await allowed_type_ids(db, user)
    query = select(RecordType.id, RecordType.name).where(RecordType.active == True)
    if allowed is not None:
        query = query.where(RecordType.id.in_(allowed))
    if type_id is not None:
        query = query.where(RecordType.id == type_id)
    types = (await db.execute(query.order_by(RecordType.name))).all()
    if not types:
        return reply('There are no active record types available in your current access scope.', 'records')
    # A uniquely named accessible type can narrow an unselected request.
    named = [t for t in types if t.name.lower() in q]
    if type_id is None and len(named) == 1:
        types = named
    elif type_id is None and len(named) > 1:
        return reply('Please choose one record type in the context dropdown, or ask about all permitted types.', 'records')
    scope = types[0].name if len(types) == 1 else f'all {len(types)} accessible active record types'
    conditions = [Record.archived == False, Record.deleted_at.is_(None), Record.record_type_id.in_([t.id for t in types])]
    active = bool(re.search(r'\bactive\b', q))
    if active:
        conditions.append(Record.status == 'active')
    if not expiry:
        if re.search(r'archived|deleted|inactive|by type|per type', q):
            return reply('Built-in counts cover unarchived, undeleted records, optionally with active status. Use Records or Reports for other breakdowns.', 'records')
        count = (await db.execute(select(func.count(Record.id)).where(*conditions))).scalar() or 0
        return reply(f'{scope}: {count} {"active " if active else ""}records.\n\nArchived and deleted records are excluded. No field contents were read.', 'records')
    today = await app_today(db)
    days_match = re.search(r'next\s+(\d+)\s+days?', q)
    if not days_match and re.search(r'\d+\s*(days?|weeks?|months?)', q):
        return reply('Please phrase the window as “next N days”, with N from 1 to 365. For example: “What expires in the next 7 days?”', 'records')
    if days_match and not 1 <= int(days_match[1]) <= 365:
        return reply('Choose a window from 1 to 365 days, for example: “Which records expire in the next 30 days?”', 'records')
    # Reject unsupported time windows instead of silently answering for a different one.
    if re.search(r'\b(last|between|yesterday|this week|this month|next month|year|quarter)\b|\d{4}-\d{2}-\d{2}', q):
        return reply('For exact dates or calendar-month reports, use Records or Reports. Built-in chat supports today, tomorrow, overdue, next week, or the next 1 to 365 days.', 'records')
    days = int(days_match[1]) if days_match else 7 if 'next week' in q else 30
    start = today + timedelta(days=1) if 'tomorrow' in q else today
    end = start if 'tomorrow' in q or re.search(r'\btoday\b', q) else today + timedelta(days=days)
    overdue = bool(re.search(r'overdue|expired|past due', q))
    if overdue and re.search(r'\b(and|or)\b', q) and re.search(r'expiring|upcoming|next', q):
        return reply('Please ask for overdue records or upcoming renewals separately so each answer has a clear date window.', 'records')
    date_value = field_date()
    dated = select(Record.id, Record.name, RecordType.name.label('type_name'), RecordType.slug,
                   date_value.label('expiry')).join(RecordType, RecordType.id == Record.record_type_id).join(
        RecordField, and_(RecordField.id == RecordType.reminder_field_id, RecordField.active == True,
                         RecordField.record_type_id == RecordType.id)).join(
        RecordValue, and_(RecordValue.record_id == Record.id, RecordValue.field_id == RecordField.id)).where(*conditions).subquery()
    date_filter = dated.c.expiry < today if overdue else and_(dated.c.expiry >= start, dated.c.expiry <= end)
    count = (await db.execute(select(func.count()).select_from(dated).where(date_filter))).scalar() or 0
    rows = (await db.execute(select(dated).where(date_filter).order_by(dated.c.expiry, dated.c.id).limit(10))).all()
    window = f'before {today.isoformat()}' if overdue else f'{start.isoformat()} through {end.isoformat()} (inclusive)'
    answer = f'{scope}: {count} records {"overdue" if overdue else "expiring"}, {window}.\n\n'
    if rows:
        answer += '\n'.join(f'• {r.name} [{r.type_name}]: {r.expiry.isoformat()}\n  /records/{r.slug}/{r.id}' for r in rows)
        if count > len(rows):
            answer += f'\n\nShowing the earliest {len(rows)} of {count} matches. Open Records for the full list.'
    else:
        answer += 'No matching renewal dates in this scope. A quiet calendar is a good calendar.'
    answer += '\n\nUses the application timezone and configured renewal-date fields. Archived/deleted records and missing or invalid dates are excluded.'
    result = reply(answer, 'records')
    if rows:
        result['table'] = {
            'summary': f'{scope}: {count} records {"overdue" if overdue else "expiring"}, {window}.',
            'rows': [{'name': r.name, 'type': r.type_name, 'date': r.expiry.isoformat(),
                      'url': f'/records/{r.slug}/{r.id}'} for r in rows],
            'note': (f'Showing the earliest {len(rows)} of {count} matches. Open Records for the full list.\n\n' if count > len(rows) else '')
                    + 'Uses the application timezone and configured renewal-date fields. Archived/deleted records and missing or invalid dates are excluded.',
        }
    return result


async def asset_answer(db, user, question):
    """Built-in asset answers (no AI credits): counts, overdue borrows, warranties."""
    if not (user.is_superuser or 'asset.view' in user.permissions):
        return None
    q = question.lower()
    if not re.search(r'\b(assets?|laptops?|devices?|borrow\w*|warrant\w*|repairs?)\b', q):
        return None
    from app.services.asset_insights import assistant_snapshot
    snap = await assistant_snapshot(db)
    c = snap['counts']
    if re.search(r'overdue|not returned|late', q):
        rows = snap['overdue_borrows']
        if not rows:
            return reply('No borrowed items are overdue. Everyone is a model citizen today.')
        lines = '\n'.join(f"| {r['item']} | {r['borrower']} | {r['due']} |" for r in rows)
        return reply(f"**{c['overdue_borrows']} overdue borrow(s)**\n\n| Item | Borrower | Due |\n|---|---|---|\n{lines}\n\nOpen **IT Logs → Borrows** to return them.")
    if re.search(r'warrant', q):
        rows = snap['warranties_ending_soon']
        if not rows:
            return reply('No warranties end in the next 60 days.')
        lines = '\n'.join(f"| [{r['asset']}]({r['path']}) | {r['ends']} |" for r in rows)
        return reply(f"**{c['warranty_expiring_60d']} warranty(ies) end within 60 days**\n\n| Asset | Ends |\n|---|---|\n{lines}")
    if re.search(r'how many|count|total|number of', q):
        types = ', '.join(f"{t['name']}: {t['count']}" for t in snap['by_type']) or 'none yet'
        st = c['by_assignment_status']
        return reply(f"You have **{c['total']} assets** ({st.get('Assigned', 0)} assigned, {st.get('Unassigned', 0)} unassigned, "
                     f"{st.get('Borrowed', 0)} borrowed).\n\nBy type: {types}.")
    return None
