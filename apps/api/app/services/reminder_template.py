"""Per-type Telegram messages with explicit tokens and escaped record values."""
from datetime import date
from html import escape
from html.parser import HTMLParser
import logging
from string import Formatter
from urllib.parse import urlparse

from app.core.config import get_settings
from app.core.exceptions import ValidationException
from app.services.record import _format_value

logger = logging.getLogger(__name__)
MAX_MESSAGE_UNITS = 4096
BASE_TEMPLATE = (
    "🔔 <b>{record_type} renewal reminder</b>\n\n{record_name}\n\n"
    "Renewal date: {renewal_date}\nDays remaining: {days_remaining}\n\nView record: {record_url}"
)
CORE_TOKENS = {
    "record_name": "Record name", "record_type": "Record type", "record_id": "Record ID",
    "record_status": "Record status", "renewal_date": "Renewal / expiry date",
    "days_remaining": "Days remaining", "record_url": "Record link",
    "reminder_name": "Reminder rule name", "days_before": "Rule interval in days",
    "today": "Today (application timezone)",
}
DEFAULT_FIELDS = {"provider", "registrar", "product name", "vendor", "assigned to",
                  "business unit", "cost", "currency", "billing cycle"}


class TelegramHTML(HTMLParser):
    """Normalize a deliberately small Telegram-compatible HTML subset."""
    allowed = {"b", "strong", "i", "em", "u", "ins", "s", "strike", "del", "code", "pre", "a", "blockquote"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.parts = []
        self.plain = []

    def handle_starttag(self, tag, attrs):
        if tag not in self.allowed:
            raise ValidationException(f"Unsupported formatting tag <{tag}>. Use plain text or basic Telegram HTML.")
        if ("code" in self.stack or "pre" in self.stack) and not (tag == "code" and self.stack == ["pre"]):
            raise ValidationException("Code and preformatted blocks cannot contain other formatting")
        if tag in {"code", "pre"} and self.stack and not (tag == "code" and self.stack == ["pre"]):
            raise ValidationException("Place code and preformatted blocks outside other formatting")
        if tag in {"a", "blockquote"} and tag in self.stack:
            raise ValidationException(f"Nested <{tag}> tags are not supported")
        if tag == "a":
            if len(attrs) != 1 or attrs[0][0] != "href" or not attrs[0][1]:
                raise ValidationException('Links need exactly one href attribute')
            href = attrs[0][1]
            parsed = urlparse(href)
            if parsed.scheme not in {"https", "http"} or not parsed.netloc or any(c.isspace() for c in href):
                raise ValidationException("Message links must use a valid http:// or https:// URL")
            self.parts.append(f'<a href="{escape(href, quote=True)}">')
        else:
            if attrs:
                raise ValidationException("Formatting attributes are not supported")
            self.parts.append(f"<{tag}>")
        self.stack.append(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack[-1] != tag:
            raise ValidationException("Formatting tags must be correctly nested and closed")
        self.stack.pop()
        self.parts.append(f"</{tag}>")

    def handle_data(self, data):
        self.parts.append(escape(data, quote=False))
        self.plain.append(data)

    def handle_comment(self, data):
        raise ValidationException("HTML comments are not supported")

    def handle_decl(self, decl):
        raise ValidationException("HTML declarations are not supported")


def normalize_message(message):
    parser = TelegramHTML()
    try:
        parser.feed(message)
        parser.close()
    except (AssertionError, ValueError):
        raise ValidationException("Message contains invalid formatting")
    if parser.stack:
        raise ValidationException("Close every formatting tag")
    plain = "".join(parser.plain)
    if not plain.strip():
        raise ValidationException("Message must contain some text")
    if any(ord(c) < 32 and c not in "\n\r\t" for c in plain):
        raise ValidationException("Message contains unsupported control characters")
    try:
        units = len(plain.encode("utf-16-le")) // 2
    except UnicodeError:
        raise ValidationException("Message contains invalid Unicode text")
    if units > MAX_MESSAGE_UNITS:
        raise ValidationException("Rendered message exceeds Telegram's 4,096-character limit. Shorten the message or field values.")
    return {"html": "".join(parser.parts), "text": plain, "length": units}


def variables(record_type):
    return ([{"key": key, "label": label, "kind": "record"} for key, label in CORE_TOKENS.items()]
            + [{"key": f"field_{f.id}", "alias": f"field.{f.slug}", "label": f.name, "kind": "field"}
               for f in record_type.fields if f.active and f.field_type != 'secret'])


def default_template(record_type):
    # Defaults include useful business fields, never every field (e.g. license keys).
    lines = [f"{f.name}: {{field_{f.id}}}" for f in record_type.fields
             if f.active and f.field_type != 'secret' and f.show_in_details and f.name.lower() in DEFAULT_FIELDS]
    if not lines:
        return BASE_TEMPLATE
    return BASE_TEMPLATE.replace("\n\nView record:", "\n\n" + "\n".join(lines) + "\n\nView record:")


def saved_template(record_type):
    value = (record_type.reminder_config or {}).get("message_template")
    return value if isinstance(value, str) and value.strip() else None


def field_text(field, value):
    if value is None or value == "" or value == []:
        return "—"
    options = {o.value: o.label for o in field.options} if field.field_type in {"select", "multi_select"} else {}
    if field.field_type == "select":
        return options.get(str(value), str(value))
    if field.field_type == "multi_select" and isinstance(value, list):
        return ", ".join(options.get(str(v), str(v)) for v in value)
    return _format_value(field, value)


def context(record_type, record, renewal_date, days_remaining, today, rule=None):
    values = {"record_name": record.name, "record_type": record_type.name, "record_id": record.id,
              "record_status": record.status, "renewal_date": renewal_date,
              "days_remaining": days_remaining, "today": today.isoformat(),
              "record_url": f"{get_settings().FRONTEND_URL.rstrip('/')}/records/{record_type.slug}/{record.id}",
              "reminder_name": rule.name if rule else "Reminder", "days_before": rule.days_before if rule else 7}
    raw = {v.field_id: v.value.get("value") if isinstance(v.value, dict) else None for v in record.values}
    for field in record_type.fields:
        if field.active and field.field_type != 'secret':
            rendered = field_text(field, raw.get(field.id))
            values[f"field_{field.id}"] = rendered
            # The stable ID token remains valid after field renames.
            values.setdefault(f"field.{field.slug}", rendered)
    return values


def render(template, values):
    if len(template) > 4096:
        raise ValidationException("Message template must be 4,096 characters or fewer")
    parts = []
    try:
        for literal, key, spec, conversion in Formatter().parse(template):
            parts.append(literal)
            if key is None:
                continue
            if key not in values:
                raise ValidationException(f"Unknown variable {{{key}}}. Choose a variable from this record type.")
            if spec or conversion:
                raise ValidationException("Variables cannot use format specifications or conversions")
            value = values[key]
            parts.append(escape("—" if value is None else str(value), quote=True))
    except ValueError:
        raise ValidationException("Unmatched braces. Use {variable} for values and {{ or }} for literal braces.")
    return normalize_message("".join(parts))


def sample_context(record_type, today: date, days_before=7):
    from datetime import timedelta
    from types import SimpleNamespace
    expiry = (today + timedelta(days=days_before)).isoformat()
    raw = []
    for field in record_type.fields:
        if not field.active:
            continue
        kind = field.field_type
        value = f"Example {field.name.lower()}"
        if kind in {"currency", "decimal", "integer", "percentage"}:
            value = 125
        elif kind == "boolean":
            value = True
        elif kind in {"date", "datetime"}:
            value = expiry if kind == "date" else expiry + "T09:00:00"
        elif kind == "url":
            value = "https://example.test"
        elif kind == "email":
            value = "owner@example.test"
        elif kind in {"select", "multi_select"}:
            choices = [o.value for o in field.options]
            value = (choices[0] if choices else "Example") if kind == "select" else choices[:2]
        raw.append(SimpleNamespace(field_id=field.id, value={"value": value}))
    record = SimpleNamespace(id=123, name=f"Example {record_type.name}", status="active", values=raw)
    rule = SimpleNamespace(name=f"{days_before} days before", days_before=days_before)
    return context(record_type, record, expiry, days_before, today, rule)


def render_message(record_type, record, renewal_date, days_remaining, today, rule=None):
    values = context(record_type, record, renewal_date, days_remaining, today, rule)
    override = rule.template.strip() if rule and rule.template else None
    template = override or saved_template(record_type) or default_template(record_type)
    try:
        return render(template, values)["html"]
    except ValidationException:
        # A deleted field or a long record value must not roll back the cycle.
        logger.warning("Using safe reminder default for record type %s record %s", record_type.id, record.id)
        return render(BASE_TEMPLATE, values)["html"]


def append_notice(message, notice):
    try:
        return normalize_message(message + notice)["html"]
    except ValidationException:
        return message
