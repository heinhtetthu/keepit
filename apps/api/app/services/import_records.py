import csv
import io

from zipfile import ZipFile, BadZipFile
from typing import Any

from fastapi import UploadFile
from openpyxl import load_workbook
from openpyxl.styles import Font
from sqlalchemy import select
from sqlalchemy import insert
from sqlalchemy.orm import selectinload
from starlette.concurrency import run_in_threadpool
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ValidationException
from app.models.record import Record, RecordValue
from app.models.record_type import RecordField, RecordType
from app.services.audit import log_audit
from app.services.validation import validate_value
from app.services.sensitive import pack

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_IMPORT_ROWS = 10000
MAX_IMPORT_COLUMNS = 200


def _bounded_rows(rows):
    result = []
    for row in rows:
        if len(result) >= MAX_IMPORT_ROWS + 1:
            raise ValidationException(f"Import is limited to {MAX_IMPORT_ROWS} data rows")
        if len(row) > MAX_IMPORT_COLUMNS:
            raise ValidationException(f"Import is limited to {MAX_IMPORT_COLUMNS} columns")
        result.append(list(row))
    return result

IMPORT_NAME = "__name__"
IGNORE_COLUMN = "__ignore__"


def _column_letter(idx: int) -> str:
    # 0-based index to spreadsheet-style label (A, B, ..., AA, ...)
    label = ""
    while True:
        label = chr(ord("A") + idx % 26) + label
        idx = idx // 26 - 1
        if idx < 0:
            return label


def read_tabular(file: UploadFile) -> tuple[list[str], list[list[Any]]]:
    """Parse an uploaded xlsx/csv into headers + raw rows (dict of first row used as header)."""
    filename = (file.filename or "").lower()
    contents = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise ValidationException("Import file must be 5 MB or smaller")
    if filename.endswith((".xlsx", ".xlsm")):
        try:
            with ZipFile(io.BytesIO(contents)) as archive:
                if len(archive.infolist()) > 1000 or sum(i.file_size for i in archive.infolist()) > 25 * 1024 * 1024:
                    raise ValidationException("Workbook decompressed size is too large")
        except BadZipFile:
            if not _looks_like_html(contents):
                raise ValidationException("Invalid Excel workbook")
        try:
            wb = load_workbook(io.BytesIO(contents), read_only=True, data_only=True)
        except Exception:
            # Some systems export ".xlsx" files that are actually HTML tables.
            if _looks_like_html(contents):
                headers, rows = _parse_html_table(contents)
                if headers:
                    return headers, rows
            raise ValidationException(
                "This file could not be read as an Excel workbook. If it was exported from another system, "
                "re-save it as a proper .xlsx or CSV and try again."
            )
        sheet = wb.active
        try:
            if sheet.max_column and sheet.max_column > MAX_IMPORT_COLUMNS:
                raise ValidationException("Workbook has too many columns")
            raw = _bounded_rows(sheet.iter_rows(values_only=True))
        finally:
            wb.close()
        if not raw:
            wb.close()
            raise ValidationException("File is empty")
        headers = [str(c).strip() if c is not None else "" for c in raw[0]]
        rows = []
        for r in raw[1:]:
            if all(c is None or str(c).strip() == "" for c in r):
                continue
            rows.append(list(r))
        wb.close()
        return headers, rows
    if filename.endswith(".csv") or filename.endswith(".txt"):
        try:
            text = contents.decode("utf-8-sig")
        except UnicodeDecodeError:
            try:
                text = contents.decode("utf-16")
            except UnicodeDecodeError:
                text = contents.decode("latin-1")
        reader = csv.reader(io.StringIO(text))
        raw = _bounded_rows(reader)
        raw = [r for r in raw if any(c.strip() for c in r)]
        if not raw:
            raise ValidationException("File is empty")
        headers = [c.strip() for c in raw[0]]
        return headers, raw[1:]
    if filename.endswith(".xls") and not filename.endswith((".xlsx", ".xlsm")):
        # Many tools export ".xls" files that are actually HTML tables - try those first.
        if _looks_like_html(contents):
            headers, rows = _parse_html_table(contents)
            if headers:
                return headers, rows
        raise ValidationException(
            "Legacy Excel (.xls) files are not supported - please re-save the file as .xlsx or export it as CSV."
        )
    raise ValidationException("Unsupported file type. Upload .xlsx, .xlsm or .csv")


def _looks_like_html(content: bytes) -> bool:
    head = content[:4096].lstrip().lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html") or b"<table" in head


def _parse_html_table(content: bytes) -> tuple[list[str], list[list[Any]]]:
    """Minimal HTML-table reader for spreadsheets that are HTML in disguise."""
    from html.parser import HTMLParser
    from html import unescape

    class TableParser(HTMLParser):
        def __init__(self):
            super().__init__()
            self.tables: list[list[list[str]]] = []
            self._rows: list[list[str]] | None = None
            self._cells: list[str] | None = None

        def handle_starttag(self, tag, attrs):
            if tag == "table":
                self._rows = []
            elif tag == "tr" and self._rows is not None:
                self._cells = []
            elif self._cells is not None and tag in ("td", "th"):
                self._cells.append("")  # placeholder; filled on data

        def handle_endtag(self, tag):
            if tag == "tr" and self._cells is not None:
                if len(self._rows) >= MAX_IMPORT_ROWS + 1 or len(self._cells) > MAX_IMPORT_COLUMNS:
                    raise ValidationException("HTML spreadsheet exceeds import limits")
                self._rows.append(self._cells)
                self._cells = None
            elif tag == "table" and self._rows is not None:
                self.tables.append(self._rows)
                self._rows = None

        def handle_data(self, data):
            if self._cells is not None:
                if self._cells:
                    self._cells[-1] += unescape(data)
                else:
                    self._cells.append(unescape(data))

    parser = TableParser()
    parser.feed(content.decode("utf-8", errors="replace"))
    if not parser.tables:
        return [], []
    table = max(parser.tables, key=len)
    non_empty = [r for r in table if any((c or "").strip() for c in r)]
    if len(non_empty) < 2:
        return [], []
    return non_empty[0], non_empty[1:]


def _autodetect_mapping(headers: list[str], fields: list[RecordField]) -> dict[int, str]:
    """Header cell -> field slug (or __name__/__ignore__). Exact then case/space-insensitive then normalized."""
    def norm(s: str) -> str:
        return "".join(ch for ch in s.lower() if ch.isalnum())

    mapping: dict[int, str] = {}
    used: set[str] = set()
    # pass 1: exact matches against slugs and names
    for i, h in enumerate(headers):
        hl = h.strip().lower()
        match = None
        for f in fields:
            if f.slug == hl:
                match = f.slug
                break
        if not match and hl in ("name", "record name", "title", "record"):
            match = IMPORT_NAME
        if match and match not in used:
            mapping[i] = match
            used.add(match)
    # pass 2: normalized fuzzy match
    for i, h in enumerate(headers):
        if i in mapping or not h.strip():
            continue
        hn = norm(h)
        if not hn:
            continue
        match = None
        for f in fields:
            if f.slug not in used and (norm(f.slug) == hn or norm(f.name) == hn):
                match = f.slug
                break
        if not match and hn in ("name", "recordname", "titlename", "titlerecord", "titlrecord", "titlerecordname", "titlename"):
            match = IMPORT_NAME
        if not match and hn == "name":
            match = IMPORT_NAME
        if match and match not in used:
            mapping[i] = match
            used.add(match)
    return mapping


def _coerce(field: RecordField | None, raw: Any) -> tuple[Any, list[str]]:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, []
    if field is None:
        return str(raw).strip(), []
    try:
        return validate_value(field, raw), []
    except ValidationException as exc:
        return None, [exc.detail["error"]["message"]]

def _normalize_mapping_row(headers: list[str], mapping: dict[int, str]) -> dict[str, str]:
    return {headers[i] or _column_letter(i): m for i, m in mapping.items()}


async def preview_import(
    db: AsyncSession,
    record_type: RecordType,
    file: UploadFile,
    mapping: dict[str, str] | dict[int, str] | None = None,
    limit: int = 200,
) -> dict[str, Any]:
    headers, rows = await run_in_threadpool(read_tabular, file)
    fields = [f for f in record_type.fields if f.active]
    fields_by_slug = {f.slug: f for f in fields}

    # accept mapping keyed by header text or index
    parsed: dict[int, str] = {}
    if mapping:
        for k, v in mapping.items():
            if v == IGNORE_COLUMN:
                continue
            try:
                key = int(k)
            except (TypeError, ValueError):
                if k in headers:
                    key = headers.index(k)
                else:
                    continue
            if isinstance(v, str):
                parsed[key] = v
    else:
        parsed = _autodetect_mapping(headers, fields)

    name_col = next((i for i, m in parsed.items() if m == IMPORT_NAME), None)

    field_list = [
        {"slug": f.slug, "name": f.name, "field_type": f.field_type, "required": f.required,
         "options": [o.value for o in f.options]}
        for f in fields
    ]

    # existing names for duplicate detection (cap at authoritative query)
    existing_names = set((await db.execute(
        select(Record.name).where(Record.record_type_id == record_type.id, Record.deleted_at == None)
    )).scalars().all())

    existing_lower = {n.lower() for n in existing_names}
    row_results = []
    file_names: dict[str, int] = {}
    created_ok = 0
    with_errors = 0
    with_warnings = 0

    for idx, row in enumerate(rows[:limit], start=2):
        name = ""
        if name_col is not None and name_col < len(row):
            rv, errs = _coerce(None, row[name_col])
            name = rv or ""
        values: dict[str, Any] = {}
        errors: list[str] = []
        warnings: list[str] = []
        unmapped_extra: dict[str, Any] = {}
        for i, raw in enumerate(row):
            target = parsed.get(i, IGNORE_COLUMN)
            if target == IGNORE_COLUMN or (isinstance(target, str) and target not in fields_by_slug and target != IMPORT_NAME):
                if raw is not None and str(raw).strip() != "":
                    unmapped_extra[headers[i] or _column_letter(i)] = str(raw)
                continue
            if target == IMPORT_NAME:
                rv, errs = _coerce(None, raw)
                if errs:
                    errors.extend(errs)
                name = rv or ""
                continue
            field = fields_by_slug[target]
            rv, errs = _coerce(field, raw)
            if errs:
                errors.extend([f"{field.name}: {e}" for e in errs])
            if rv is not None:
                values[target] = rv

        if name_col is None and not name:
            for f in fields:
                if f.required and f.field_type in ("text", "email"):
                    name = str(values.get(f.slug) or "")
                    break

        # required check
        for f in fields:
            if f.required and f.slug not in values:
                errors.append(f"missing required: {f.name}")

        status = "ok"
        if not name:
            status = "error"
            errors.append("missing record name")
        elif len(name) > 500:
            status = "error"
            errors.append("record name exceeds 500 characters")
        elif name.lower() in existing_lower:
            status = "warning"
            warnings.append("name already exists (will be skipped or renamed)")
        elif name.lower() in file_names:
            status = "warning"
            warnings.append("duplicate name in file")
        if errors:
            status = "error"
            with_errors += 1
        elif warnings:
            with_warnings += 1
        else:
            created_ok += 1
        file_names[name.lower()] = idx
        row_results.append({
            "row": idx,
            "name": name,
            "status": status,
            "errors": errors,
            "warnings": warnings,
            "values": values,
            "unmapped": unmapped_extra,
        })

    mapping_display = _normalize_mapping_row(headers, parsed)
    unmapped_headers = [h or _column_letter(i) for i, h in enumerate(headers) if i not in parsed]

    return {
        "headers": headers,
        "field_list": field_list,
        "mapping": mapping_display,
        "unmapped_headers": unmapped_headers,
        "type_has_name_conflict": name_col is None,
        "total_rows": len(rows),
        "preview_rows": row_results,
        "summary": {"ok": created_ok, "warnings": with_warnings, "errors": with_errors},
    }


async def commit_import(
    db: AsyncSession,
    record_type: RecordType,
    file: UploadFile,
    mapping: dict[str, str] | dict[int, str] | None,
    user_id: int,
    on_name_conflict: str = "skip",  # skip | rename
    default_status: str = "active",
) -> dict[str, Any]:
    if on_name_conflict not in ("skip", "rename"):
        raise ValidationException("on_name_conflict must be 'skip' or 'rename'")
    await db.execute(select(RecordType.id).where(RecordType.id == record_type.id).with_for_update())
    await db.execute(select(RecordField).where(RecordField.record_type_id == record_type.id).with_for_update(read=True)
                     .options(selectinload(RecordField.options)).execution_options(populate_existing=True))
    preview = await preview_import(db, record_type, file, mapping, limit=MAX_IMPORT_ROWS)
    fields = {f.slug: f for f in record_type.fields if f.active}

    existing_names = set((await db.execute(
        select(Record.name).where(Record.record_type_id == record_type.id)
    )).scalars().all())
    existing_lower = {n.lower() for n in existing_names}
    seen: set[str] = set()
    pending = []

    created = skipped = 0
    for row in preview["preview_rows"]:
        if row["status"] == "error":
            skipped += 1
            continue
        name = row["name"].strip()
        if not name:
            skipped += 1
            continue
        if name.lower() in existing_lower or name.lower() in seen:
            if on_name_conflict == "skip":
                skipped += 1
                continue
            base = name
            n = 2
            while name.lower() in existing_lower or name.lower() in seen:
                suffix = f" ({n})"
                name = f"{base[:500 - len(suffix)]}{suffix}"
                n += 1
        seen.add(name.lower())

        pending.append((name, row["values"]))
    for offset in range(0, len(pending), 500):
        batch = pending[offset:offset + 500]
        ids = (await db.execute(insert(Record).returning(Record.id, sort_by_parameter_order=True), [
            {"record_type_id": record_type.id, "name": name, "status": default_status, "created_by": user_id}
            for name, _ in batch
        ])).scalars().all()
        values = [{"record_id": record_id, "field_id": fields[slug].id, "value": pack(fields[slug], value)}
                  for record_id, (_, data) in zip(ids, batch) for slug, value in data.items() if slug in fields]
        for start in range(0, len(values), 1000):
            await db.execute(insert(RecordValue), values[start:start + 1000])
        created += len(ids)
    await db.flush()
    await log_audit(db, "import", "record_type", record_type.id, record_type.name, user_id=user_id,
                    details=f"Imported records into {record_type.name}: created {created}, skipped {skipped}")
    return {"created": created, "skipped": skipped, "total_in_file": preview["total_rows"]}


async def import_template(db: AsyncSession, record_type: RecordType) -> bytes:
    from openpyxl import Workbook
    wb = Workbook()
    ws = wb.active
    ws.title = record_type.name[:31] or "Records"
    headers = ["Name"] + [f.name for f in record_type.fields if f.active]
    ws.append(headers)
    for cell in ws[1]:
        cell.font = cell.font.copy(bold=True)
    example = ["Example record name"]
    for f in record_type.fields:
        if f.field_type in ("text", "email", "url"):
            example.append(f"example {f.name.lower()}")
        elif f.field_type == "date":
            example.append("2026-12-31")
        elif f.field_type in ("integer", "decimal", "currency", "percentage"):
            example.append(100)
        elif f.field_type == "boolean":
            example.append("yes")
        elif f.field_type == "select" and f.options:
            example.append(f.options[0].value)
        elif f.field_type == "multi_select" and f.options:
            example.append(f.options[0].value)
        else:
            example.append("")
    ws.append(example)
    for f in (f for f in record_type.fields if f.active and f.required):
        col = headers.index(f.name) + 1
        ws.cell(row=1, column=col).font = Font(bold=True, color="FFCC0000")
    ws.column_dimensions["A"].width = 30
    from openpyxl.utils import get_column_letter
    for col in range(2, len(headers) + 1):
        ws.column_dimensions[get_column_letter(col)].width = 22
    import io as _io
    out = _io.BytesIO()
    wb.save(out)
    return out.getvalue()
