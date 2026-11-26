# Changelog

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
