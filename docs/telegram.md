# Telegram Integration

## Setup

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Set `TELEGRAM_BOT_TOKEN` in `.env`
3. Add recipients via the Notifications page

## Architecture

```
Reminder Engine → Notification Service → Telegram Provider
```

Telegram is only a notification channel. All record management happens through the web application.

## Recipients

Recipients must be registered in the system. The worker only sends to registered chat IDs.

## Message Format

```
🔔 {record_type} Renewal Reminder

{record_name}

Renewal Date:
{renewal_date}

⏳ {days_remaining} days remaining

View Record:
{record_url}
```
