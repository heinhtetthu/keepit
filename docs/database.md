# Database

## Entity Relationship

```
users ←→ roles ←→ permissions
record_types ←→ record_fields ←→ record_field_options
record_types ←→ records ←→ record_values
record_types ←→ reminder_rules ←→ reminder_logs
notification_recipients ←→ reminder_logs
audit_logs
saved_views
system_settings
```

## Key Tables

- **record_types** - Defines record types (Subscription, Domain, License, etc.)
- **record_fields** - Dynamic field definitions per record type
- **records** - Actual records
- **record_values** - JSONB values for dynamic fields
- **reminder_rules** - Configurable reminder intervals
- **reminder_logs** - Notification history with duplicate prevention
- **audit_logs** - Activity tracking

## Migrations

```bash
alembic upgrade head
```

Adding a new record type or custom field does NOT require a migration - it uses the dynamic metadata system.
