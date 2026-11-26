# Renewal forecasting

Open **Reports → Renewal forecast**. Choose 3, 6, 12, or 24 calendar months,
an optional future start date, record type, business unit, currency, or vendor.
The default starts today in the application's configured timezone and ends on
the last day of the twelfth calendar month, so the first month may be partial.

The report shows known amounts separately for each currency, monthly totals,
business-unit totals, and paginated renewal details. It never combines different
currencies or uses exchange rates. Export forecast CSV downloads the complete
monthly and business-unit summaries for the current filters, not just the
visible detail page. Viewing requires `report.view`; exporting requires
`report.export`. Both respect explicit record-type access grants.

## Forecast assumptions

- Only active records in active types are included; archived and deleted records
  are excluded. The record type must have a configured active expiry/reminder
  field to schedule an event.
- The expiry date is the estimated renewal date. This is a planning estimate,
  not a cash-payment schedule or evidence that a provider will renew an item.
- The current Cost field is the price **per renewal**. Seat Cost, Renewal Cost,
  and the existing legacy Seat Cost (Monthly) name are recognized. Prices and
  seat counts are not automatically increased or annualized. A stored monthly
  price must not be mistaken for the price of an annual renewal.
- Business units and vendor/provider/registrar names come from current record
  values. Future transfers or vendor changes are not predicted. Dedicated
  business-unit fields take precedence over legacy field names.
- With repeats enabled, Monthly, Quarterly, Semi-annual, Yearly/Annual, and
  Biennial cycles repeat at unchanged cost, even if auto-renew is off. Projected
  dates use the original expiry's day, clamped to the destination month; for
  example, January 31 → February 29 → March 31 in a leap year.
- Without a known cycle, only the next configured expiry is included. No yearly
  cycle is guessed for domains. One-time, perpetual, and lifetime purchases are
  excluded. Overdue dates are flagged and excluded rather than silently rolled
  forward as if they had already been renewed.
- A renewal already recorded early, with an old date matching the current
  expiry, moves the estimate to its new expiry. The old obligation is not
  counted a second time.
- Cost is read from the record, not inferred from unrelated payment-history
  entries. Missing, negative, non-finite, or malformed prices and missing
  currencies are flagged as unpriced. They are not treated as free. Zero cost
  is valid. All calculations use PostgreSQL numeric values; amounts travel to
  the UI as decimal strings to preserve cents.

Coverage warnings identify overdue dates, missing configured dates, one-time
purchases, and unknown cycles. These categories can overlap. Fix the source
record or its field configuration to improve coverage. This feature does not
introduce approvals, escalation, attachments, or automatic payment actions.

## API and resource controls

- `GET /api/v1/reports/forecast`: `months` (1–24), `start` (today through the next
  24 months), `repeat_cycles`, `record_type_id`, `business_unit`, `currency`,
  `vendor`, `page`, and `page_size` (1–100).
- Empty string filters mean unassigned/unspecified; omitted filters mean all.
- `GET /api/v1/reports/forecast.csv` takes the same filters and exports summaries.
- Detail rows are paginated, while all totals cover the complete filtered
  forecast. All processing is read-only; no schema migration is needed.
- Forecast queries are limited to two simultaneous requests per API process by
  default (`FORECAST_MAX_CONCURRENT`). Waiting more than ten seconds returns a
  clear HTTP 503 busy response. SQL execution has a fifteen-second deadline by
  default (`FORECAST_QUERY_TIMEOUT_SECONDS`, clamped to 1–60 seconds). These
  limits protect other requests under report-heavy load. Budget the total
  concurrency across all API replicas when changing them.

The SQL narrows each dynamic-value join to the configured field IDs, supplies
the field-map cardinality to PostgreSQL, and aggregates without instantiating
every record as Python ORM objects. There is no cross-user response cache.
Browser report queries are also keyed by user ID. A browser regression check
switches accounts within the same SPA and holds the second account's response
to verify the first account's financial data is not reused while loading.
