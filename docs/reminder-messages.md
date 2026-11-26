# Telegram reminder messages by record type

Open **Renewals & Reminders**, choose a record-type tab, and find **Telegram
message** below its intervals. Each type has a generated default containing
its name, record name, renewal date, days remaining, and record link. Useful
business fields are included when present: provider, registrar, product,
vendor, assignee, business unit, cost, currency, and billing cycle. Defaults
do not automatically include every field, such as license keys.

Edit the message, click variable buttons to insert values at the cursor,
preview it, then choose **Save message**. **Restore default** fills the editor
with the current type's default; save to apply it. Empty messages also use the
default. New types receive defaults automatically; no schema migration is
needed. Settings use the existing `record_types.reminder_config` JSON object
and preserve its other keys.

## Dynamic values

Core variables are `{record_name}`, `{record_type}`, `{record_id}`,
`{record_status}`, `{renewal_date}`, `{days_remaining}`, `{record_url}`,
`{reminder_name}`, `{days_before}`, and `{today}`. Today and remaining days use
the application's configured timezone.

Each active field has a stable token such as `{field_123}` and a readable alias
such as `{field.cost}`. Buttons insert stable IDs, which survive field renames.
Aliases work while the slug remains present. Missing values display an em dash;
select fields use option labels, multiselects join their labels, and booleans
use Yes/No. Values are escaped so text containing `&`, `<`, or `>` cannot change
the message's formatting. Only include fields recipients should receive.

For example, using a type whose slugs include `provider`, `cost`, and `currency`:

```text
<b>{record_name}</b> renews on {renewal_date}.
Provider: {field.provider}
Cost: {field.cost} {field.currency}
Days remaining: {days_remaining}
<a href="{record_url}">Open record</a>
```

Unknown variables, attribute/index traversal, format conversions, malformed
braces, unsupported tags/attributes, and unsafe links are rejected. Use `{{`
and `}}` for literal braces. Basic HTML supports bold, italic, underline,
strikethrough, code/preformatted text, HTTP(S) links, and block quotes. It is a
small supported subset, not arbitrary browser HTML. Text previews show resolved
content; Telegram applies the supported formatting when delivered.

Rendered text is limited to 4,096 UTF-16 units, conservatively accounting for
emoji. This follows Telegram's message-size limit after entities are parsed:
[Telegram Bot API](https://core.telegram.org/bots/api#sendmessage).

## Precedence and delivery

1. A rule-specific message, if configured.
2. The record type's shared custom message.
3. That type's generated default.

Existing rule-specific messages are preserved. The editor shows their count
and offers an explicit checkbox to make those rules inherit the shared message
when saving. Alternatively, clear a single rule's custom message in Edit rule.

Normal reminders, per-record early reminders, and recovered legacy failed logs
use the same renderer. Once a delivery job has been queued, its rendered message
is frozen; changing a template does not rewrite pending jobs or their retries.
If a field is later removed or a real value makes a saved message too long,
the worker logs a warning and sends a safe basic reminder rather than exposing
unresolved variables or rolling back the scheduling cycle. Optional catch-up
notes are omitted when they would exceed the message limit.

## Permissions and preview

Viewing/previewing requires `reminder.view`; saving requires `reminder.edit`.
Every operation checks access to the selected record type. Previewing actual
records additionally requires `record.view`; those records must belong to the
selected type and be neither archived nor deleted. Sample preview works without
record-view permission and does not read real record values. Preview sends no
Telegram message. Outbound recipients must have record-view permission and
current type access, checked during both scheduling and delivery.

API endpoints are `GET`/`PUT /api/v1/reminders/types/{type_id}/message` and
`POST /api/v1/reminders/types/{type_id}/message/preview`. The preview body accepts
`template`, optional `record_id`, and `days_before`. Omitting `template` previews
the saved shared message; explicitly passing blank/null previews the default.
Saving accepts `template` and `replace_rule_overrides` (false by default).
Template-change audit entries record that settings changed, not copies of
message bodies or resolved record values.
