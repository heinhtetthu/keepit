"""Plain-language labels for audit log entries.

Every action string passed to ``log_audit`` maps to a short sentence such as
"Updated asset" and a category used by the audit list tabs. Unknown actions
fall back to a title-cased version of the raw string, so nothing technical
like ``asset.update`` reaches the screen.
"""
from __future__ import annotations

import re
from typing import Any

# Categories: change (create/update), signin (auth and account security),
# deletion (delete/trash/purge), other (exports, views, reveals...).
CHANGE, SIGNIN, DELETION, OTHER = "change", "signin", "deletion", "other"

ACTIONS: dict[str, tuple[str, str]] = {
    # Records
    "create": ("Created record", CHANGE),
    "update": ("Updated record", CHANGE),
    "delete": ("Deleted record", DELETION),
    "archive": ("Archived record", CHANGE),
    "restore": ("Restored record", CHANGE),
    "renew": ("Renewed record", CHANGE),
    "import": ("Imported records", CHANGE),
    "record.duplicate": ("Duplicated record", CHANGE),
    "record.trash": ("Moved record to trash", DELETION),
    "record.purge": ("Permanently deleted record", DELETION),
    "record.bulk_archive": ("Archived several records", CHANGE),
    "record.bulk_status": ("Changed status of several records", CHANGE),
    "record.bulk_trash": ("Moved several records to trash", DELETION),
    "renewal.update": ("Updated renewal", CHANGE),
    "renewal.delete": ("Deleted renewal", DELETION),
    "field.reveal": ("Revealed a hidden field", OTHER),
    # Record types and fields
    "record_type.update": ("Updated record type", CHANGE),
    "field.create": ("Added field", CHANGE),
    "field.update": ("Updated field", CHANGE),
    "field.delete": ("Deleted field", DELETION),
    "field.reorder": ("Reordered fields", CHANGE),
    "field.option_create": ("Added field option", CHANGE),
    "field.option_delete": ("Removed field option", DELETION),
    "reminder.message_update": ("Updated reminder message", CHANGE),
    # Assignments
    "assignment.create": ("Assigned record", CHANGE),
    "assignment.update": ("Updated assignment", CHANGE),
    "assignment.delete": ("Removed assignment", DELETION),
    "assignment.bulk": ("Assigned several records", CHANGE),
    "assignment.swap": ("Swapped assignment", CHANGE),
    # Assets
    "asset.create": ("Added asset", CHANGE),
    "asset.update": ("Updated asset", CHANGE),
    "asset.revert": ("Restored a previous version of an asset", CHANGE),
    "record.revert": ("Restored a previous version of a record", CHANGE),
    "employee.revert": ("Restored a previous version of an employee", CHANGE),
    "asset.delete": ("Moved asset to trash", DELETION),
    "asset.restore": ("Restored asset", CHANGE),
    "asset.import": ("Imported assets", CHANGE),
    "asset.assign": ("Assigned asset", CHANGE),
    "asset.unassign": ("Unassigned asset", CHANGE),
    "asset.bulk_assign": ("Assigned several assets", CHANGE),
    "asset_assignment.delete": ("Deleted assignment history entry", DELETION),
    "asset_assignment.import": ("Imported assignment history", CHANGE),
    "asset_maintenance.create": ("Logged maintenance", CHANGE),
    "asset_maintenance.update": ("Updated maintenance", CHANGE),
    "asset_maintenance.delete": ("Deleted maintenance entry", DELETION),
    "asset_repair.create": ("Logged repair", CHANGE),
    "asset_repair.update": ("Updated repair", CHANGE),
    "asset_repair.delete": ("Deleted repair", DELETION),
    "asset_repair.import": ("Imported repairs", CHANGE),
    "asset_serial.update": ("Updated asset numbering", CHANGE),
    "asset_template.update": ("Updated asset template", CHANGE),
    "asset_template.delete": ("Deleted asset template", DELETION),
    # Borrowing
    "borrow.create": ("Lent out asset", CHANGE),
    "borrow.update": ("Updated loan", CHANGE),
    "borrow.return": ("Returned borrowed asset", CHANGE),
    "borrow.delete": ("Deleted loan", DELETION),
    "borrow.restore": ("Restored loan", CHANGE),
    # Documents
    "document.upload": ("Uploaded document", CHANGE),
    "document.update": ("Updated document", CHANGE),
    "document.link": ("Linked document", CHANGE),
    "document.unlink": ("Unlinked document", CHANGE),
    "document.delete": ("Deleted document", DELETION),
    "document.restore": ("Restored document", CHANGE),
    # Employees and business units
    "employee.create": ("Added employee", CHANGE),
    "employee.update": ("Updated employee", CHANGE),
    "employee.delete": ("Deleted employee", DELETION),
    "employee.bulk_update": ("Updated several employees", CHANGE),
    "employee.bulk_delete": ("Deleted several employees", DELETION),
    "employee.import": ("Imported employees", CHANGE),
    "employee.import_file": ("Imported employees from a file", CHANGE),
    "employee.offboard": ("Offboarded employee", CHANGE),
    "employee.release": ("Released employee's items", CHANGE),
    "business_unit.create": ("Added business unit", CHANGE),
    "business_unit.update": ("Updated business unit", CHANGE),
    "business_unit.delete": ("Deleted business unit", DELETION),
    "department.create": ("Added department", CHANGE),
    "department.update": ("Updated department", CHANGE),
    "department.delete": ("Deleted department", DELETION),
    "reference.create": ("Added list value", CHANGE),
    "reference.update": ("Updated list value", CHANGE),
    "reference.delete": ("Deleted list value", DELETION),
    # Reports
    "report.export": ("Exported a report", OTHER),
    "report.download": ("Downloaded a report", OTHER),
    "report.queue": ("Queued a report", OTHER),
    # Users, roles and access
    "user.create": ("Added user", CHANGE),
    "user.update": ("Updated user", CHANGE),
    "user.delete": ("Deleted user", DELETION),
    "user.access_update": ("Changed user access", CHANGE),
    "user.profile_update": ("Updated profile", CHANGE),
    "role.create": ("Added role", CHANGE),
    "role.update": ("Updated role", CHANGE),
    "role.delete": ("Deleted role", DELETION),
    # Sign-in and account security
    "login": ("Signed in", SIGNIN),
    "logout": ("Signed out", SIGNIN),
    "login_failed": ("Failed sign-in", SIGNIN),
    "mfa.setup": ("Started two-factor setup", SIGNIN),
    "mfa.enable": ("Turned on two-factor sign-in", SIGNIN),
    "mfa.disable": ("Turned off two-factor sign-in", SIGNIN),
    "passkey.create": ("Added passkey", SIGNIN),
    "passkey.delete": ("Removed passkey", SIGNIN),
    "password_reset.request": ("Requested password reset", SIGNIN),
    "password_reset.confirm": ("Reset password", SIGNIN),
    "api_token.create": ("Created API token", SIGNIN),
    "api_token.revoke": ("Revoked API token", SIGNIN),
    # Settings
    "settings.update": ("Updated settings", CHANGE),
    "settings.ai": ("Updated AI settings", CHANGE),
    "settings.asset_alerts": ("Updated asset alert settings", CHANGE),
    "settings.branding": ("Updated branding", CHANGE),
    "settings.branding_logo": ("Uploaded logo", CHANGE),
    "settings.branding_favicon": ("Uploaded browser icon", CHANGE),
    "settings.branding_logo_removed": ("Removed logo", CHANGE),
    "settings.branding_favicon_removed": ("Removed browser icon", CHANGE),
    "settings.currency": ("Updated currency settings", CHANGE),
}

# Same raw action, different entity: record-type level create/delete/import.
ENTITY_ACTIONS: dict[tuple[str, str], tuple[str, str]] = {
    ("create", "record_type"): ("Created record type", CHANGE),
    ("delete", "record_type"): ("Deleted record type", DELETION),
    ("import", "record_type"): ("Imported records", CHANGE),
}

ENTITY_TYPES: dict[str, str] = {
    "asset": "Asset",
    "auth": "Sign-in",
    "borrow": "Loan",
    "department": "Department",
    "document": "Document",
    "employee": "Employee",
    "record": "Record",
    "record_batch": "Records (bulk)",
    "record_type": "Record type",
    "report": "Report",
    "role": "Role",
    "settings": "Settings",
    "user": "User",
}

CATEGORIES = {CHANGE: "Changes", SIGNIN: "Sign-ins", DELETION: "Deletions", OTHER: "Other"}


def humanize(raw: str) -> str:
    """'asset_repair.update' -> 'Asset repair update'."""
    words = re.sub(r"[._\-]+", " ", raw or "").strip()
    return words[:1].upper() + words[1:].lower() if words else "Activity"


def _guess_category(action: str) -> str:
    last = action.rsplit(".", 1)[-1]
    if any(w in last for w in ("delete", "purge", "trash", "remove")):
        return DELETION
    if any(w in action for w in ("login", "logout", "mfa", "passkey", "password", "token")):
        return SIGNIN
    return CHANGE if any(w in last for w in ("create", "update", "add", "import", "restore")) else OTHER


def label_for(action: str, entity_type: str | None = None) -> tuple[str, str]:
    """(label, category) for an action."""
    hit = ENTITY_ACTIONS.get((action, entity_type or "")) or ACTIONS.get(action)
    return hit if hit else (humanize(action), _guess_category(action))


def entity_label(entity_type: str | None) -> str:
    return ENTITY_TYPES.get(entity_type or "", humanize(entity_type or ""))


def actions_in(category: str) -> list[str]:
    """Known action strings in a category (for the list filter)."""
    return sorted({a for a, (_, c) in ACTIONS.items() if c == category}
                  | {a for (a, _), (_, c) in ENTITY_ACTIONS.items() if c == category})


def summary_for(action: str, entity_type: str | None, entity_name: str | None, details: str | None = None) -> str:
    label, _ = label_for(action, entity_type)
    if action in ("login", "logout", "login_failed") and entity_name:
        return f"{label} as {entity_name}"
    if entity_name:
        return f"{label}: {entity_name}"
    return label


def _plain(value: Any) -> Any:
    """Unwrap JSONB {"value": x} record values."""
    if isinstance(value, dict) and set(value) == {"value"}:
        return value["value"]
    return value


def _field_name(key: str) -> str:
    return key if not re.fullmatch(r"[a-z0-9_]+", key) else humanize(key)


def changes_for(old_values: dict | None, new_values: dict | None) -> list[dict[str, Any]]:
    """Field-level changes as [{field, old, new}].

    Handles both shapes written by ``log_audit`` callers: separate old and new
    snapshots, or new_values holding {field: {"old": a, "new": b}}.
    """
    old, new = old_values or {}, new_values or {}
    if not isinstance(old, dict) or not isinstance(new, dict):
        return []
    out: list[dict[str, Any]] = []
    if not old and new and all(isinstance(v, dict) and set(v) <= {"old", "new"} and v for v in new.values()):
        for key, v in new.items():
            out.append({"field": _field_name(key), "old": _plain(v.get("old")), "new": _plain(v.get("new"))})
        return out
    for key in list(dict.fromkeys([*old.keys(), *new.keys()])):
        a, b = _plain(old.get(key)), _plain(new.get(key))
        if key in old and key in new and a == b:
            continue
        out.append({"field": _field_name(key), "old": a, "new": b})
    return out
