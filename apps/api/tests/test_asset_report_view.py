"""Asset report search, filters, sort and columns applied for CSV export (no database needed)."""
from app.services.asset_reports import apply_view, column_type, to_csv


def _report():
    cols = [{"key": k, "label": k.title(), "type": column_type(k)} for k in ("date", "asset", "vendor", "status", "cost")]
    rows = [
        {"date": "2026-01-05", "asset": "Dell XPS", "vendor": "Fixit", "status": "Complete", "cost": 40.0},
        {"date": "2026-02-10", "asset": "HP EliteBook", "vendor": "Repairo", "status": "In Progress", "cost": None},
        {"date": "2026-03-15", "asset": "Dell Latitude", "vendor": "Fixit", "status": "In Progress", "cost": 120.5},
    ]
    return {"columns": cols, "rows": rows, "summary": []}


def test_column_types():
    assert column_type("date") == "date" and column_type("cost") == "money" and column_type("vendor") == "choice"
    assert column_type("issue") == "text" and column_type("days_left") == "number"


def test_filters_search_sort_columns():
    r = _report()
    assert [x["asset"] for x in apply_view(r, {"vendor": {"in": ["Fixit"]}})["rows"]] == ["Dell XPS", "Dell Latitude"]
    assert len(apply_view(r, {"status": {"in": []}})["rows"]) == 3
    assert [x["asset"] for x in apply_view(r, {"date": {"gte": "2026-02-01", "lte": "2026-03-31"}})["rows"]] == ["HP EliteBook", "Dell Latitude"]
    assert [x["asset"] for x in apply_view(r, {"date": {"lt": "2026-02-10"}})["rows"]] == ["Dell XPS"]
    assert [x["asset"] for x in apply_view(r, {"cost": {"gte": "50"}})["rows"]] == ["Dell Latitude"]
    assert [x["asset"] for x in apply_view(r, {"asset": "lat"})["rows"]] == ["Dell Latitude"]
    assert [x["asset"] for x in apply_view(r, search="repairo")["rows"]] == ["HP EliteBook"]
    # Empty values sort last in both directions.
    assert [x["cost"] for x in apply_view(r, sort="cost", order="desc")["rows"]] == [120.5, 40.0, None]
    assert [x["cost"] for x in apply_view(r, sort="cost", order="asc")["rows"]] == [40.0, 120.5, None]
    out = apply_view(r, {"unknown": "x"}, columns=["asset", "cost", "nope"])
    assert [c["key"] for c in out["columns"]] == ["asset", "cost"] and len(out["rows"]) == 3
    assert to_csv(out).splitlines()[0] == "Asset,Cost"
