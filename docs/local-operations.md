# Local security, recovery and maintenance

This installation remains in development mode on local HTTP. Do not expose it
to the internet. For remote access, configure HTTPS, explicit allowed hosts,
strong database credentials and `DEPLOYMENT_ENV=production`. Production startup
rejects insecure defaults. No approval workflow is enabled.

## Accounts and protected data

Change the seeded administrator password in Settings → My Account. Enroll an
authenticator there and keep its one-time recovery codes offline. MFA is optional
locally; only enforce `REQUIRE_ADMIN_MFA` after every administrator has enrolled.
Passwords and authenticator codes are required for protected-value reveals and
permanent record deletion. Reveals hide after 30 seconds and are audited.

Use the Protected text field type for credentials and other private strings.
Protected fields are encrypted, masked, excluded from search, exports and Telegram
templates, and can only be revealed by administrators. Converting an existing
text field also encrypts its stored values and redacts historical record audit
payloads. This classification cannot be reversed in the UI. Names, ordinary
fields and database indexes are not encrypted: host/disk encryption and filesystem
access controls remain necessary. Keep secrets out of ordinary fields and AI chat.

Browser refresh credentials use HttpOnly cookies; access tokens remain in browser
storage for compatibility. CSP and short access-token lifetime reduce exposure,
but a compromised browser can still act as its user.

## Backups and restore

`docker compose up -d backups` starts daily authenticated encrypted backups and
verifies each by restoring into a disposable database. Thirty days are retained.
Run `docker compose run --rm backups --verify` for an immediate backup/check.
Settings → System displays backup health. `backups/` is ignored by Git.

Keep `.env` encryption keys in a protected password manager or separate offline
location. The backup key differs from application encryption keys. Losing either
can make data unrecoverable. A backup on the same disk does not survive disk loss;
an off-site copy is deferred while this is local-only.

For an actual restore, stop backend and worker, preserve a fresh encrypted backup,
then run `docker compose run --rm backups --restore /backups/FILE.enc --database
TARGET --confirm-database TARGET`. This replaces TARGET contents. Prefer restoring
to a new database and verifying it before switching the app. Restore checks fail
on authentication, truncation or SQL errors. Restart services only after checking
record counts and the Alembic revision.

## Keys and audit integrity

To rotate application keys: back up first, prepend a new Fernet key to
`DATA_ENCRYPTION_KEYS` while retaining old keys, restart apps/api/worker, and run
`docker compose exec backend python -m app.tools.encrypt_existing`. The tool
rewraps bot tokens, queued messages, MFA secrets, protected fields, export files
and authenticated audit entries without printing their contents. Pause the worker
during rotation. Keep old keys until older backups expire; never delete a key
before a verified restore. Backup-key rotation requires retaining the old key for
old backup files. JWT signing-key changes require signing in again.

New audit payloads have an HMAC. Administrators can inspect the most recent 1,000
entries via `GET /api/v1/security/audit-integrity`. Historical unsigned rows remain
explicitly unsigned. This detects changes to signed payloads, not deletion of whole
rows; independently retained backups are needed for comparison. Database and host
administrators still control local storage. Audit entries are retained indefinitely
and paginated; no automatic audit purge is enabled.

## Recovery and report limits

Delete moves records to Trash. Restore keeps their values and history. Archived
records remain in their type's Include archived view. Administrator permanent
deletion requires a 30-day recovery window and a restore-verified backup within
two days. It removes record values and history, retaining audit entries.

Reports generate durable background jobs with owner/type permission checks at
creation, execution and download. Files are encrypted and expire after 24 hours.
Each user can have three outstanding jobs. Excel/PDF exports are limited to
10,000 rows and 50 MB; allocation results are paginated. Legacy synchronous report
endpoints reject types above 1,000 live records. Choose narrower filters or split
large exports. Forecast cache entries expire after 15 seconds and normal app
mutations invalidate them; external SQL writes may take 15 seconds to appear.

Notification health shows queue age and worker heartbeats. Leases recover work
after worker interruption. Telegram delivery is at least once: a timeout after
provider acceptance can cause a duplicate. Check logs before manually retrying.

## Deployment rollback

Before deploying, retain the current image digests and a restore-verified backup.
Migrations are append-only. Test upgrade/downgrade/upgrade on a disposable DB;
never downgrade the live database to work around an application failure.
For rollback, stop writers, restore the corresponding backup into a new database,
run the matching previous images against it, verify health and sample records,
then switch the local app. Preserve the failed database for investigation. A
database restore loses writes after its backup; reconcile those before resuming.
Do not run destructive pytest schema-reset fixtures against the app database.
