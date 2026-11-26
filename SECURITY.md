# Security policy

## Reporting a vulnerability

Please don't open a public issue. Email the maintainer or use GitHub's **Report a vulnerability** (Security → Advisories) on this repository. Include steps to reproduce and the affected version or commit. We aim to reply within 3 working days.

## How Keepit protects data

| Area | Measure |
|---|---|
| Authorization | Permission checks on every endpoint. Separate Assets/Records levels with View/Edit per record type ([docs/permissions.md](docs/permissions.md)). Only system administrators can change access. |
| Database | PostgreSQL **row-level security** on renewal records. The API and worker connect as `keepit_app` (no superuser, no RLS bypass, no DDL, cannot delete audit rows) ([docs/row-level-security.md](docs/row-level-security.md)). |
| Authentication | Argon2 password hashing; short-lived access tokens with rotating, reuse-detecting refresh sessions; TOTP MFA with recovery codes; passkeys (WebAuthn); single-use 30-minute reset links; login and reset rate limits. |
| API tokens | Only their SHA-256 hash is stored. Shown once, revocable, and they act with the owner's permissions. |
| Secrets at rest | Bot tokens, protected fields and the AI key are encrypted with Fernet (`DATA_ENCRYPTION_KEYS`, rotatable). Backups are encrypted. |
| Audit | Every mutation is logged with a tamper-evident integrity chain. The app role can't delete audit rows. |
| Uploads | Allow-list of types, checked by extension and file signature. 10 MB limit (512 KB for branding images). Files are served with `Content-Security-Policy: sandbox` and `nosniff`. SVGs containing script are rejected. |
| Web | Strict CSP (`script-src 'self'`), `X-Frame-Options: DENY`, no inline scripts, `SameSite=Strict` httpOnly refresh cookie, origin checks on auth endpoints. |
| Outbound calls | The AI provider must be https (local http only when `AI_ALLOW_LOCAL_PROVIDER=true`). Provider errors are never echoed back. |
| Production guard-rails | With `DEPLOYMENT_ENV=production` the API refuses weak keys, default database passwords, non-https URLs and wildcard hosts. |

## Automated checks (CI)

`pip-audit`, `bandit`, `pnpm audit`, gitleaks secret scanning and Trivy file-system/config scanning run on every push and every week. API tests run both normally and as the RLS-restricted role. Browser smoke tests check the security headers and session handling.
