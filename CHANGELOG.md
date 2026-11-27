# Changelog

## Unreleased

### Added
- One shared table kit (`apps/web/src/components/data-table`: DataTable, TableToolbar, TableTabs, useTableState, filter helpers) now used by every list: assets, employees, business units, departments, IT logs, documents, notifications, record types, quick actions, reports, renewals, reminder rules, audit logs, auto-renewals, trash and users. Each has the records-style filter side panel, sort, column picker, saved views (any `scope`), rows per page (default 10) and a footer directly under the last row.
- Renewals & Reminders redesign: summary tiles, timeline or table of upcoming renewals with quick renew, visual reminder rule builder with live Telegram preview (`GET /reminders/upcoming`).
- Per-item history with field-level changes and "Restore this version" on asset, record and employee pages (`/history/{entity}/{id}`).
- Departments master list and employee Department and Country (migration `0007_departments_country`).
- IT logs: edit every borrow, repair and maintenance entry; return with the actual return date; lend from a grouped asset picker with an "Other" option.
- Human-readable audit log with changed fields, filters and categories.
- AI provider picker (OpenAI, Gemini, Claude, Grok, Mistral, DeepSeek, Groq, OpenRouter, custom) with automatic base URL, live model list, key paste and Test connection.
- QR code for authenticator (2FA) setup; searchable list of every ISO currency; redesigned exchange rates.
- Reports hub with asset reports (inventory, repairs & costs, maintenance, borrows, warranty expiry, who holds what), summary tiles, sorting and CSV export (`/api/v1/reports/assets`).
- Asset list now works like a record list: preset tabs with counts (All, In use, Available, Borrowed, In repair, Warranty ending, Written-off), the same right-side filter panel, sort menu, column picker, saved views (`saved_views.scope`, migration `0005_saved_view_scope`), "Open this view by default", and Show written-off / Show trash. New `GET /assets/summary`; asset filters gain `employee_ids`, `hide_written_off` and multi-value `warranty`; more sort keys (holder, model, location, cost…).
- Employee phone (migration `0004_employee_phone`), joined date, Active/Resigned status and resignation date in one add/edit form; business units are a multi-select.

### Removed
- AI document extraction (endpoints, dialog, `extraction.run` permission, `extraction_runs` table via migration `0006_remove_extraction`, `pypdf`). The AI provider setting is now only for the assistant.

### Changed
- Ask Keepit launcher is icon-only; assistant answers never contain em or en dashes, and none remain in the app text.
- Pill tags never wrap; Quick Actions and Notifications use the same page padding as other pages.
- Security workflow: disposable config is generated on the runner (fixes the root-owned `.env`), and tests no longer contain fixed secret-like literals.
- Reports: a compact report picker in the toolbar replaces the side list, so the report uses the full width.
- Dropdowns collapse on any outside click, including inside dialogs (capture-phase listeners), and a surrounding `<label>` no longer re-opens them or removes the first chosen option.
- Rows-per-page picker shows the whole number.
- Every table footer: count on the left, a narrow "Rows per page" and pagination on one line on the right (`TablePager`).
- "Ask Keepit" launcher is translucent until hovered or opened.
- Popovers cap their height to the space on screen (above the phone tab bar); Escape in a nested dropdown no longer closes the whole panel.

## 2.0.0 - Keepit

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
