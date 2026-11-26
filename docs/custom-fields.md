# Custom Fields

## Adding a Custom Field

1. Go to **Record Types**
2. Select a record type
3. Click **Add Field**
4. Configure name, type, and behavior
5. Save - no code changes needed

## How It Works

Custom fields are stored in the `record_fields` table and their values in `record_values` (JSONB). The frontend dynamically renders forms and tables based on field metadata from the API.

## No Migrations Required

Adding a custom field is a metadata operation - it does NOT require an Alembic migration.
