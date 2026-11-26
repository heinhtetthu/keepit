# Security release benchmark — 50,000 synthetic records

Results: `load-results/security-final-50000.json` (2026-11-05).

Same constrained API and PostgreSQL limits as the earlier saved baseline: one CPU
for each, API 1 GB, PostgreSQL 512 MB. Sixty requests at each concurrency level,
nearest-rank percentiles, warm endpoint/cache setup. The host also ran disposable
regression tests, so these numbers are a local diagnostic, not a capacity promise.
No production data or external provider sends were used.

| Concurrent requests | Mixed p50 | Mixed p95 | Requests/sec | HTTP errors |
| --- | ---: | ---: | ---: | ---: |
| 1 | 33.9 ms | 54.7 ms | 28.32 | 0/60 |
| 10 | 193.9 ms | 1,355.9 ms | 26.45 | 0/60 |
| 25 | 533.3 ms | 1,377.1 ms | 32.21 | 0/60 |

The earlier `forecast-release-50000.json` measured 1,024.2 ms mixed p95 at
concurrency 1 and 15,499.2 ms at concurrency 10 (seven 503 responses there).
The newer results include short-lived permission/revision-scoped dashboard and
forecast caches, so compare as an end-user workload improvement rather than a
claim that every cold SQL query is faster. Global search p95 at concurrency 1
changed from 267.2 ms to 100.0 ms after trigram indexes and per-type limits.

Background allocation queued in 359.1 ms, completed in 10.54 seconds including
polling/worker pickup, and returned its first 50-row page in 917.0 ms for 15,833
records. This includes complete generation; it is not comparable to the old
synchronous response alone. Synchronous report endpoints now reject types over
1,000 records, while the UI uses durable jobs. Large artifacts still require full
JSON decryption/parsing per page, bounded by a 50 MB artifact cap.

Run `scripts/loadtest.ps1 -Forecast` for another isolated run. Tests start only a
report worker; no reminder scheduler or Telegram integrations run. Forecast and
dashboard caches expire after 15 seconds and invalidate on normal app mutations;
cold queries, frequently changing datasets and diverse user scopes will be slower.
Before a larger deployment, measure longer steady-state tests with representative
user scopes and writes, and size the database/worker pool from those results.
