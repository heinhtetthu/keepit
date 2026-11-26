# Security, delivery, and scaling changes

## Sessions and permissions

Access tokens last 15 minutes. Sessions have an absolute seven-day lifetime;
refreshing does not extend that lifetime. Refresh tokens rotate on use and
only their SHA-256 hashes are stored in the database. Reusing an old refresh
token outside a five-second recovery window revokes its session. Within that
fixed window, the previous token recovers the same current credential so a
concurrent tab or interrupted response does not force a false logout. Refreshing
does not extend the recovery window. Logout revokes the current session. Password,
username, and administrative account changes invalidate existing sessions
through a dedicated user session version.

The browser keeps refresh credentials in a SameSite Strict, HttpOnly cookie;
Secure is enabled when FRONTEND_URL uses HTTPS. Access tokens remain in
localStorage. Refresh requests are coordinated across tabs using Web Locks
where available. JSON refresh tokens remain supported for non-browser API
clients; those clients must serialize refresh requests and replace their token
after every successful refresh. Use HTTPS outside local development.

Deployment invalidates tokens issued before revision 0018. Users must sign in
again. Only superusers manage roles, assign roles, or grant record-type access.
Only superusers reset another account's password; self-service password changes
still require the current password. Delegated user managers cannot modify or
delete accounts with greater permissions than their own.
All other users need explicit record-type grants, including users who manage
record-type definitions or ordinary user accounts. Allocation reports enforce
the same type boundary as other reports. Record writes and imports validate
field ownership, activity, required values, numeric/date types, and options.

## Reminder delivery

The scheduling transaction creates a reminder log and one durable delivery
per active bot. It does not contact Telegram. An advisory transaction lock
serializes schedulers; automatic renewals and interactive mutations also lock
the affected records. A separate delivery loop polls every five seconds, using
SKIP LOCKED parent-log claims so multiple workers cannot simultaneously deliver
the same job. Each completed attempt commits independently. Successful bots
are not retried when another bot fails.

Failed deliveries use exponential backoff from WORKER_RETRY_DELAY_SECONDS,
with WORKER_MAX_RETRIES additional attempts. WORKER_BATCH_SIZE bounds each
delivery batch. Eligibility is checked again before sending, including current
user activation, type access, recipient/bot configuration, and record deletion
or archival. Legacy pending/failed logs without delivery jobs are recovered by
the scheduler.

Delivery is at least once: a crash after Telegram accepts a message but before
the database commits can cause a duplicate. Telegram does not provide an
idempotency key for sendMessage. Durable jobs prevent later scheduling failures
from rolling back previously committed delivery attempts.

## Concurrency and dates

Record edits accept expected_updated_at and return 409 for a stale version.
The UI includes this version when editing a record. Renewal dates must advance
the existing expiry, preventing repeated submission from creating identical
renewals. Ownership and renewal history edits lock the parent record.

Dashboard, reminders, retries, and renewals use the persisted application
timezone with TIMEZONE as fallback. Invalid timezone updates are rejected.

## Queries and bulk operations

Dashboard expiry counts run in PostgreSQL rather than loading every record.
Search ranks results across permitted types in one record query. Reminders and
automatic renewals query relevant date windows and stream records in batches.
Malformed legacy dates are ignored safely using PostgreSQL 16 validation.
Allocation reports batch-fetch histories, calculate money using Decimal, omit
soft-deleted records, and synthesize missing initial ownership for reporting
without writing during a report request.

Imports are limited to 5 MB, 10,000 data rows, 200 columns, and 25 MB of expanded
workbook content. They validate before insertion, batch inserts, and serialize
imports into the same record type. CPU-heavy parsing and export generation
run outside the async event loop. Bulk record operations accept at most 1,000
IDs and use SQL updates. Exports over 10,000 rows explicitly fail instead of
silently truncating; narrow the supplied filters. Larger asynchronous export
jobs remain future work. Excel exports store user text as text rather than
spreadsheet formulas.

Revision 0021 adds refresh recovery metadata. Revision 0020 adds indexes for active type/name lists, assignment history,
renewal lookup, and dynamic field text. No production load benchmark has been
performed; these changes do not establish a supported maximum record count.

## Verification and deployment

GitHub Actions provisions PostgreSQL, checks a fresh migration to head, rolls
back the new revisions to 0017 and re-applies them, then runs the database test
suite. CI refuses to silently skip tests when RECORDS_TEST_DB is missing.
Frontend CI and Docker builds use the checked-in npm lockfile.

Historical full rollback below 0017 has an existing failure: revision 0007
expects an index that the downgrade of 0008 does not restore. Historical
migrations remain untouched; full rollback to base is not supported by this
change. Readiness returns HTTP 503 without database exception text on failure.
