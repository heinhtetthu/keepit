# Load test findings - November 4, 2026

Tests used synthetic data in separate Docker containers and a separate network.
The production database was never seeded, reset, or benchmarked. No notification
worker or external notification provider ran in the load environment.

## Environment and method

- Shared Docker host: 4 CPUs, approximately 8 GiB RAM. Other applications were
  running; these are constrained diagnostics, not dedicated-hardware SLO tests.
- Test API: one CPU, 1 GiB RAM, one Uvicorn process. PostgreSQL 16: one CPU,
  512 MiB RAM. Client: one CPU, 512 MiB RAM.
- 10,000 and 50,000 synthetic records, three record types, eight dynamic fields
  per record, two ownership-history entries per record, and three currencies.
  The 50,000-record case contains 400,000 dynamic values and 100,000 ownership
  entries. Dates span both overdue and future renewals.
- HTTP requests went directly to the API, including authentication and database
  access. Browser rendering, Nginx, TLS, write traffic, imports/exports, worker
  delivery, and provider latency are outside the measured workload.
- Warm-up requests were excluded. Concurrency means simultaneous requests,
  not employees. The initial read mix evenly rotates list, global search,
  dashboard, and filtered list. Forecast runs add forecast as a fifth equal
  share: an intentionally **report-heavy** workload, not a measured production
  traffic distribution. The harness calls it `interactive-mix` in raw JSON.
- The final release comparison used 60 requests per concurrency level and
  nearest-rank percentiles. Earlier 50,000-record diagnostics used just 12
  mixed requests, three per endpoint; compare their **medians**, not tail SLOs.
  Older raw diagnostic percentiles used floor interpolation and should not be
  treated as reliable endpoint p95 estimates with such small samples.

## Findings and changes

1. The original dashboard plan applied date validation to unrelated numeric and
   text values before narrowing to the configured expiry fields. The query now
   explicitly limits the dynamic-value scan to those expiry-field IDs.
2. Record-list search joined every matching field into the outer record query.
   A record matching several fields inflated counts and consumed multiple page
   slots. It now uses a set-membership subquery. Global search also uses a
   shared field-match subquery, preserving type ownership and searchable flags.
3. The first forecast stress implementation scanned too many dynamic values.
   At concurrency 10 it produced three client timeouts; at concurrency 25 the
   512 MiB test database suffered one OOM kill and recovery. This failed run
   was not deployed. It terminated before its final JSON file was written;
   the failure was observed in the benchmark console and cgroup memory events.
4. Forecast joins now explicitly restrict each value alias to the configured
   field IDs and expose the field-map row count to the planner. Forecasting
   aggregates in PostgreSQL and paginates details. Admission is limited to two
   forecast queries per API process, with a ten-second queue wait and a
   fifteen-second SQL deadline. Overload produces an explicit HTTP 503 rather
   than allowing unbounded report work or leaking database errors.

### Diagnostic comparison, 50,000 records

Same constrained resources, short four-endpoint read mix, concurrency one:

| Endpoint | Before, median | After relevant fix, median |
|---|---:|---:|
| Dashboard | 38,100 ms | 602 ms |
| Filtered record list | 1,119 ms | 114 ms in final five-endpoint mix |
| Global search | 452 ms | 238 ms in final five-endpoint mix |
| Plain record list | 34 ms | 28 ms in final five-endpoint mix |

Only the dashboard comparison uses the same short four-endpoint diagnostic on
both sides. Search/list final measurements come from the later five-endpoint
run and are directional observations, not controlled speedup claims.

### Final release run, 50,000 records

The forecast, corrected searches, and dashboard fix were all enabled. Each
level used 60 requests, including 12 full-scope twelve-month forecast requests.

| Concurrent requests | Mixed p50 | Mixed p95 | HTTP 200 | HTTP 503 busy |
|---:|---:|---:|---:|---:|
| 1 | 238 ms | 1,024 ms | 60 | 0 |
| 5 | 2,289 ms | 18,924 ms | 59 | 1 |
| 10 | 5,279 ms | 15,499 ms | 53 | 7 |
| 25 | 7,187 ms | 18,702 ms | 50 | 10 |

At concurrency one, forecast median was 883 ms and p95 was 1,422 ms. Plain list
median was 28 ms. The separate full allocation report over approximately
16,000 records remained expensive: median 6,662 ms across three requests.

All final busy responses came from forecast admission/deadline protection.
There were no client timeouts or HTTP 500 responses in this final run. The
database's OOM-kill counter stayed at the one failure from the initial stress
implementation; no further OOM kills occurred after the controls were added.

## Capacity conclusion

The single-CPU, 512 MiB test database is **not sufficient for sustained
report-heavy concurrency at 50,000 records**. The final result demonstrates
bounded overload handling, not a claim that concurrency 25 meets a latency or
availability target. Even concurrency five generated a busy response in this
deliberately heavy scenario. The small samples and shared host also prevent a
reliable "maximum users" estimate.

Before such sustained load, choose a latency/error target and repeat the test
with production-sized database resources and a realistic traffic mix. The next
scaling work should prioritize asynchronous large allocation reports, financial
preaggregation or incrementally maintained typed expiry/cost data, and query
profiling on the intended database hardware. Response caching would need strict
permission-aware keys and invalidation. Do not raise report concurrency limits
without budgeting memory and CPU across all API replicas.

## Reproducing

Build the backend image, then run from PowerShell at the repository root:

```powershell
docker compose build backend
powershell -ExecutionPolicy Bypass -File scripts/loadtest.ps1 -Forecast
```

The script refuses to reuse an existing load-test container/network, generates
temporary database/signing credentials, seeds only the disposable `renewly_load`
database, writes JSON under the git-ignored `tmp/loadtest/run-*` directory, and
removes its containers/network in `finally`. It never starts a worker. Record
counts grow from 10,000 to 50,000 by default. `apps/api/loadtest/benchmark.py`
also refuses other database names and API hosts, and verifies actual row counts.

Raw synthetic measurements from this session are in [load-results](load-results/).
`baseline-*` files predate the query changes; `forecast-indexed-*` excludes the
final admission guard; `forecast-final-*` includes the guard before the final
search rewrite; `forecast-release-*` is the final tested application code.
