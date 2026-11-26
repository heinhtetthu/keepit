# Changelog

## Unreleased

### Added
- Reports hub with asset reports (inventory, repairs & costs, maintenance, borrows, warranty expiry, who holds what), summary tiles, sorting and CSV export (`/api/v1/reports/assets`).
- Full asset filter panel (type, brand, model, supplier, assignment, condition, location, business unit, holder, purchase date/cost, warranty, open repair) with removable chips; filters live in the URL.
- Employee phone (migration `0004_employee_phone`), joined date, Active/Resigned status and resignation date in one add/edit form; business units are a multi-select.

### Changed
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
