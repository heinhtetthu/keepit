# Reminders

## How Reminders Work

1. Each record type designates a date field as its reminder date
2. Reminder rules define intervals (e.g., 7 days before)
3. The worker scans for due reminders
4. Notifications are sent via Telegram
5. Duplicate prevention via `reminder_logs` uniqueness constraint

## Configuring Reminders

1. Go to **Settings** → **Reminder Rules**
2. Select a record type
3. Set the interval (days before)
4. Optionally customize the message template

## Template Variables

- `{record_name}` - Record name
- `{record_type}` - Record type name
- `{renewal_date}` - Reminder date
- `{days_remaining}` - Days until renewal
- `{record_url}` - Link to record
