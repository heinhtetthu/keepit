# Access control

Keepit decides what a signed-in person may do in three layers. Each layer can only narrow what the one above allows.

1. **Access levels (roles):** each user gets an **Assets** level and a **Records** level, set independently, plus optional switches.
2. **Record-type grants:** each record type is **Hidden**, **View** or **Edit** for that user.
3. **Row-level security in PostgreSQL:** the database enforces the record-type grants itself (see [row-level-security.md](row-level-security.md)).

The API checks permissions on every endpoint, and the UI hides what you can't do; the UI checks are only for convenience. Only **system administrators** can change anyone's access.

## Assets level

Applies to every asset; there is no per-asset limit.

| Level | Can | Cannot |
|---|---|---|
| No access | Nothing on the asset side | See any asset |
| Viewer | Browse assets and their history, IT logs, documents, the employee directory | Add, edit, assign, lend, upload or delete |
| Editor | Viewer, plus add/edit/import assets, assign/reassign/retire, log repairs/maintenance/borrows, upload/edit documents | Delete or restore, manage employees, change asset configuration |
| Manager | Editor, plus delete/restore assets and documents, manage employees and offboarding, edit asset lists/templates/auto numbers | Manage users or workspace settings |

## Records level + record-type grants

The level sets the **most** a person may do. Each record type is then Hidden, View or Edit for them.

| Level | In **Edit** types | In **View** types |
|---|---|---|
| No access | Nothing; grants are ignored | Nothing |
| Viewer | Read only | Read only |
| Editor | Create, edit, renew, duplicate, import, reassign seats, export reports | Read only |
| Manager | Editor, plus archive/delete, reminder rules, record-type fields | Read only |

*Example:* a Records Editor with Licenses = Edit and Domains = View can renew licenses but can only look at domains.

## Switches

| Switch | Grants |
|---|---|
| Workspace admin | Users, workspace settings, currency, notifications, system health. It doesn't open assets or records by itself. |
| AI assistant | May send open-ended questions to the configured AI provider. Built-in answers work for everyone. |
| System administrator | Everything, including every record type, audit logs, purging and history corrections. |

## Where it lives

* Level definitions and their plain-language explanations: `apps/api/app/services/access_levels.py` (also served at `GET /api/v1/users/access-catalog`).
* Reading and changing a user's access: `GET` / `PUT /api/v1/users/{id}/access` (`apps/api/app/api/v1/user_access.py`).
* Per-type checks: `apps/api/app/services/access.py` (`ensure_type_access(..., write=True)` for writes).
* UI: Settings → Users & roles → **Access**. The "What each access level allows" table sits underneath the user list.
* Custom roles (Settings → Users & roles → Custom roles) still work for special cases and add to the levels.

## Permission strings

`record.*`, `record_type.*`, `field.*`, `report.view|export`, `reminder.*`, `notification.view`, `user.*`, `settings.view|edit`, `employee.view|manage`, `asset.view|create|edit|delete`, `itlog.view|manage`, `document.view|upload|edit|delete`, `reference.manage`, `assistant.use`. Audit logs are restricted to system administrators.
