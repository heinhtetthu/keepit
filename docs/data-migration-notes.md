# Data migration notes (starting point)

The unified app starts with an empty database. These notes describe how the old Renewly and AssetWise data should map, to help plan the one-off ETL import.

## Ground rules built into the schema

* Imported tables have nullable `legacy_source` (`'renewly'` | `'assetwise'`) and `legacy_id` (text) columns, unique together: `users`, `employees`, `records`, `assets`, `asset_assignments`, `asset_repairs`, `asset_maintenance`, `asset_borrows`, `documents`, `reference_items`. Upsert on `(legacy_source, legacy_id)` so the import can be rerun safely.
* AssetWise ids are strings, which is why `legacy_id` is text. Renewly ids are integers and are stored as text.
* Dates: AssetWise stored most dates as `varchar`. Parse them to `date`, and log rows that fail to parse instead of guessing.
* Use the ORM services (or replicate their invariants) so assets get the right `assignment_status` / `condition_status`, and write one `audit_logs` row per import batch.

## Renewly → unified

Same tables and columns (the baseline is Renewly's migration 0029 squashed). Copy table by table in FK order and keep ids where possible: `roles`, `permissions`, `users`, `record_types`, `record_fields`, `record_field_options`, `records`, `record_values`, `record_renewals`, `employees`, `business_units`, `record_assignments`, reminders, telegram bots and recipients, `saved_views`, `system_settings`, `audit_logs`. Then reset the sequences.

* Run `python -m app.seed` afterwards: it adds the new permissions and refreshes the system roles without touching users.
* The encrypted columns (`telegram_bots.bot_token`, delivery messages) need the same `DATA_ENCRYPTION_KEYS`.

## AssetWise → unified

| AssetWise | Unified | Notes |
|---|---|---|
| `users(id, email, password_hash, role, totp_*)` | `users` | Role map: System Admin → *Super Admin* (`is_superuser`), IT Staff → *IT Staff*, Viewer → *Viewer*. Password hashes use a different scheme: set `must_change_password=true` and send reset links. TOTP secrets are not portable; users re-enrol MFA |
| `employees(id, name, username, email, avatar_url, department, role, join_date, status, resignation_date, regions, gender)` | `employees` | `department` → `business_units=[department]` (also insert into `business_units`), `role` → `title`, `status='Active'` → `active=true`. **Merge with Renewly employees by lower(email), then by exact name** |
| `assets(id, type, other_type_name, brand, model, serial_number, location, specs, purchase_date, supplier, warranty_end_date, employee_id, assignment_status, condition_status, created_at)` | `assets` | `type` → `asset_type`, `specs.purchasePrice` → `purchase_cost` |
| `assets.assignment_history[]` `{employeeId, assignedFrom, assignedTo, remark}` | `asset_assignments` | `employee_name` = name snapshot. Open entry has `assigned_to=null` |
| `assets.repair_history[]` | `asset_repairs` | Same fields, snake_case |
| `assets.maintenance_log[]` | `asset_maintenance` | `components` JSON is identical |
| `assets.borrow_history[]` + `it_log_borrows` | `asset_borrows` | Deduplicate: a borrow can be in both places when `it_log_borrows.asset_id` is set |
| `asset_type_templates`, `asset_serial_settings` | same names | Copy as-is |
| `reference_brands/asset_types/locations/regions/vendors` | `reference_items(kind, name, meta)` | Vendor contact fields → `meta` |
| `reference_departments` | `business_units` | |
| `documents` + `document_links` | `documents` + `document_links` | `stored_name` → `storage_key`; copy files from the old `DOCUMENTS_DIR` unchanged. Map `entity_id` strings to new integer ids. `it_log` links → `borrow` |
| `extraction_runs` | - | Not migrated (AI extraction was removed) |
| `exchange_rates`, `app_settings.default_currency` | `system_settings` keys `exchange_rates` (JSON), `default_currency` | |
| `audit_logs` | `audit_logs` | Optional. Store the old actor/target JSON in `details`. The integrity chain restarts at import |
| `webauthn_credentials` | `webauthn_credentials` | Only valid if the RP ID (domain) stays the same. Otherwise users re-register passkeys |

## Suggested order

1. Freeze both apps (read-only), and back up both databases and the documents volume.
2. Import Renewly fully (ids preserved).
3. Import AssetWise reference data → employees (merge) → users → assets → history tables → borrows → documents and files.
4. Reconcile: compare counts per table, and check that every asset holder exists and every document file opens.
5. Run `python -m app.seed`, send password reset links to AssetWise users, and switch DNS.
