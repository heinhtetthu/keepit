"""Plain-language access levels. One source of truth for the seed, the API
and the "what can this person do?" explanations in the Users screen.

A user's effective permissions are the union of:
  * their Assets level role, Records level role,
  * optional Workspace admin and AI assistant roles,
  * any custom roles an administrator created.
Record permissions apply only inside record types granted to the user;
each grant is View or Edit. System administrators bypass everything.
"""

ASSET_VIEW = ["employee.view", "asset.view", "itlog.view", "document.view"]
ASSET_EDIT = ASSET_VIEW + ["asset.create", "asset.edit", "itlog.manage", "document.upload", "document.edit", "extraction.run"]
ASSET_MANAGE = ASSET_EDIT + ["asset.delete", "document.delete", "employee.manage", "reference.manage"]

RECORD_VIEW = ["record.view", "record_type.view", "field.view", "reminder.view", "notification.view", "report.view", "employee.view"]
RECORD_EDIT = RECORD_VIEW + ["record.create", "record.edit", "report.export"]
RECORD_MANAGE = RECORD_EDIT + ["record.delete", "reminder.create", "reminder.edit", "reminder.delete",
                               "record_type.edit", "field.create", "field.edit", "field.delete"]

WORKSPACE_ADMIN = ["user.view", "user.create", "user.edit", "user.delete", "settings.view", "settings.edit", "notification.view"]
ASSISTANT = ["assistant.use"]

LEVEL_NAMES = {0: "none", 1: "viewer", 2: "editor", 3: "manager"}
LEVEL_IDS = {v: k for k, v in LEVEL_NAMES.items()}

CATALOG = {
    "assets": {
        "title": "Assets",
        "summary": "Devices, IT logs, documents and the employee directory. Applies to every asset; there is no per-asset limit.",
        "levels": [
            {"key": "none", "title": "No access", "description": "Asset pages, IT logs and documents are hidden.", "can": [], "cannot": ["See any asset"]},
            {"key": "viewer", "title": "Viewer", "permissions": ASSET_VIEW,
             "description": "Can look up any asset, who holds it, its repair, maintenance and borrow history, and download documents.",
             "can": ["Browse and search assets", "Open asset history and IT logs", "View and download documents", "See the employee directory"],
             "cannot": ["Add, edit, assign or lend anything", "Upload documents", "Delete anything"]},
            {"key": "editor", "title": "Editor", "permissions": ASSET_EDIT,
             "description": "Day-to-day IT work: add and edit assets, assign and reassign, log repairs, maintenance and borrows, upload documents and run AI extraction.",
             "can": ["Everything a Viewer can", "Add and edit assets, import CSV", "Assign, reassign and retire", "Log repairs, maintenance and borrows", "Upload and edit documents, run AI extraction"],
             "cannot": ["Delete or restore assets and documents", "Add or edit employees", "Change asset lists, templates or auto numbers"]},
            {"key": "manager", "title": "Manager", "permissions": ASSET_MANAGE,
             "description": "Owns the asset side: everything an Editor can, plus deleting and restoring, the employee directory and asset configuration.",
             "can": ["Everything an Editor can", "Delete and restore assets and documents", "Add, edit, offboard and deactivate employees", "Edit asset lists, spec templates and auto numbers"],
             "cannot": ["Manage users or workspace settings (needs Workspace admin)"]},
        ],
    },
    "records": {
        "title": "Records",
        "summary": "Renewals such as subscriptions, licenses and domains. The level sets the most someone may do; each record type granted below is then View or Edit.",
        "levels": [
            {"key": "none", "title": "No access", "description": "Records, reminders and renewal reports are hidden, whatever types are granted.", "can": [], "cannot": ["See any record"]},
            {"key": "viewer", "title": "Viewer", "permissions": RECORD_VIEW,
             "description": "Read-only in the granted record types: records, renewal and ownership history, reminders and reports.",
             "can": ["Browse records in granted types", "See renewal and seat history", "See reminder rules and delivery logs", "Run reports (no export)"],
             "cannot": ["Create, edit, renew or reassign records (even in types granted with Edit)", "Export reports"]},
            {"key": "editor", "title": "Editor", "permissions": RECORD_EDIT,
             "description": "Works on records in types granted with Edit: create, edit, renew, reassign seats, duplicate and import. Types granted with View stay read-only.",
             "can": ["Everything a Viewer can", "Create, edit, renew, duplicate and import records in Edit types", "Reassign or release license seats in Edit types", "Export reports"],
             "cannot": ["Change anything in View-only types", "Archive or delete records", "Change reminder rules or record type fields"]},
            {"key": "manager", "title": "Manager", "permissions": RECORD_MANAGE,
             "description": "Owns renewals in Edit types: everything an Editor can, plus archive and delete, reminder rules and record type fields.",
             "can": ["Everything an Editor can", "Archive, restore and delete records in Edit types", "Create and edit reminder rules", "Configure fields of granted record types"],
             "cannot": ["Create brand-new record types or purge records (system admin)", "Change anything in View-only types"]},
        ],
    },
    "workspace": {"title": "Workspace admin", "permissions": WORKSPACE_ADMIN,
                  "description": "Manage users and their access, workspace settings, currency, notifications and system health. On its own it does not open assets or records."},
    "assistant": {"title": "AI assistant", "permissions": ASSISTANT,
                  "description": "May send questions to the configured AI provider. Built-in assistant answers work for everyone."},
    "superuser": {"title": "System administrator",
                  "description": "Full access to everything, including every record type, audit logs, purging and history corrections. Only another system administrator can grant it."},
    "grants": {"title": "Record type access",
               "description": "Choose which record types this person sees. View = read-only. Edit = their Records level applies (Editor or Manager). Types not listed are hidden."},
}


def system_roles() -> dict[str, dict]:
    """Seeded roles keyed by name: scope, level, description, permissions."""
    out: dict[str, dict] = {}
    for scope in ("assets", "records"):
        for i, lvl in enumerate(CATALOG[scope]["levels"]):
            if lvl["key"] == "none":
                continue
            out[f"{CATALOG[scope]['title']} {lvl['title'].lower()}"] = {
                "scope": scope, "level": i, "description": lvl["description"], "permissions": lvl["permissions"]}
    out["Workspace admin"] = {"scope": "workspace", "level": 1, "description": CATALOG["workspace"]["description"], "permissions": WORKSPACE_ADMIN}
    out["AI assistant"] = {"scope": "assistant", "level": 1, "description": CATALOG["assistant"]["description"], "permissions": ASSISTANT}
    return out
