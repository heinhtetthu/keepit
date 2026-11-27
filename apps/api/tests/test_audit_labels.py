"""Audit labels: no database needed."""
import pathlib
import re

from app.services.audit_labels import ACTIONS, ENTITY_ACTIONS, changes_for, humanize, label_for, summary_for

APP = pathlib.Path(__file__).resolve().parent.parent / "app"


def _used_actions():
    found = set()
    for path in APP.rglob("*.py"):
        for m in re.finditer(r"log_audit\(\s*\w+\s*,\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]", path.read_text()):
            found.add((m.group(1), m.group(2)))
    return found


def test_every_logged_action_has_a_plain_label():
    used = _used_actions()
    assert len(used) > 50
    missing = sorted(a for a, e in used if (a, e) not in ENTITY_ACTIONS and a not in ACTIONS)
    assert not missing, f"add these to app/services/audit_labels.py: {missing}"
    # Dynamic actions built at runtime.
    for extra in ("asset.assign", "asset.unassign", "settings.branding_logo", "settings.branding_favicon_removed"):
        assert extra in ACTIONS


def test_labels_are_human_readable():
    assert label_for("asset.update") == ("Updated asset", "change")
    assert label_for("report.export")[0] == "Exported a report"
    assert label_for("login_failed") == ("Failed sign-in", "signin")
    assert label_for("create", "record_type")[0] == "Created record type"
    assert label_for("create", "record")[0] == "Created record"
    assert label_for("record.purge")[1] == "deletion"
    for label, _ in ACTIONS.values():
        assert "." not in label and "_" not in label
    # Unknown actions fall back to readable words.
    assert humanize("asset_widget.frobnicate") == "Asset widget frobnicate"
    assert label_for("gadget.delete") == ("Gadget delete", "deletion")


def test_summary_and_changes():
    assert summary_for("asset.update", "asset", "Dell Latitude") == "Updated asset: Dell Latitude"
    assert summary_for("login", "auth", "a@b.c") == "Signed in as a@b.c"
    assert summary_for("settings.ai", "settings", None) == "Updated AI settings"
    # Separate old/new snapshots: unchanged keys are dropped.
    diff = changes_for({"location": "HQ", "brand": "Dell"}, {"location": "Branch", "brand": "Dell"})
    assert diff == [{"field": "Location", "old": "HQ", "new": "Branch"}]
    # {field: {old, new}} shape written by record updates, with JSONB {"value": x}.
    diff = changes_for(None, {"Expiry date": {"old": {"value": "2025-01-01"}, "new": "2026-01-01"}, "status": {"old": "active", "new": "archived"}})
    assert diff == [{"field": "Expiry date", "old": "2025-01-01", "new": "2026-01-01"},
                    {"field": "Status", "old": "active", "new": "archived"}]
    assert changes_for(None, None) == []
