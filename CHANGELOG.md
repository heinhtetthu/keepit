# Changelog

## Unreleased

### Added
- Reports hub with asset reports (inventory, repairs & costs, maintenance, borrows, warranty expiry, who holds what), summary tiles, sorting and CSV export (`/api/v1/reports/assets`).
- Asset list now works like a record list: preset tabs with counts (All, In use, Available, Borrowed, In repair, Warranty ending, Written-off), the same right-side filter panel, sort menu, column picker, saved views (`saved_views.scope`, migration `0005_saved_view_scope`), "Open this view by default", and Show written-off / Show trash. New `GET /assets/summary`; asset filters gain `employee_ids`, `hide_written_off` and multi-value `warranty`; more sort keys (holder, model, location, cost…).
- Employee phone (migration `0004_employee_phone`), joined date, Active/Resigned status and resignation date in one add/edit form; business units are a multi-select.

### Removed
- AI document extraction (endpoints, dialog, `extraction.run` permission, `extraction_runs` table via migration `0006_remove_extraction`, `pypdf`). The AI provider setting is now only for the assistant.

### Changed
- Reports: a compact report picker in the toolbar replaces the side list, so the report uses the full width.
- Dropdowns collapse on any outside click, including inside dialogs (capture-phase listeners), and a surrounding `<label>` no longer re-opens them or removes the first chosen option.
- Rows-per-page picker shows the whole number.
- Every table footer: count on the left, a narrow "Rows per page" and pagination on one line on the right (`TablePager`).
- "Ask Keepit" launcher is translucent until hovered or opened.
- Popovers cap their height to the space on screen (above the phone tab bar); Escape in a nested dropdown no longer closes the whole panel.

## 2.0.0 — Keepit

First release of the unified app (Renewly + AssetWise).

### Added
- Asset management: assets, assignment timeline, repairs, maintenance, borrows, QR labels, CSV import, bulk actions, auto product numbers, trash.
- Employees page and Employee 360; one-step offboarding (assets, borrows and seats).
- Documents with links to assets, people and records; AI extraction with human review.
- Structured access: Assets and Records levels, Hidden/View/Edit per record type, Workspace admin, AI assistant, with explanations in the UI.
- PostgreSQL row-level security on records, with a limited `keepit_app` database role.
- Passkeys, email password reset, personal API tokens, a REST-backed MCP server.
- Branding: primary colour, logo and favicon; light/dark themes.
- Global Create menu (`C`), unified ⌘K search, two-pane Guide, grouped Settings hub, phone tab bar.
- "Ask Keepit" assistant with built-in asset and renewal answers; AI optional.
- CI: lint, migrations, tests (also under RLS), type checks, builds, Docker images, dependency/secret/config scanning, Dependabot.

### Changed
- One FastAPI backend and one Vite web app; a single squashed migration baseline.
- Old single roles (Super Admin/Admin/Editor/IT Staff/Viewer) replaced by access levels.

### Security
- Upgraded `pypdf` (7.1.1), `@modelcontextprotocol/sdk` (1.32.2) and `zod` (4.6.7) to clear known advisories.
