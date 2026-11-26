from datetime import datetime, timezone
from io import BytesIO
from typing import Any
from html import escape
import re

from openpyxl import Workbook
from openpyxl.styles import Font, Alignment, PatternFill
from openpyxl.utils import get_column_letter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

from app.models.record_type import RecordField
from app.services.record import _format_value


def export_to_excel(fields: list[RecordField], records: list[dict[str, Any]], record_type_name: str) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = re.sub(r'[\\/*?:\[\]]', '_', record_type_name)[:31] or 'Records'

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")

    report_fields = [f for f in fields if f.show_in_reports and f.field_type != 'secret']
    headers = ['Record name', 'Business status'] + [f.name for f in report_fields]
    for col_idx, header in enumerate(headers, 1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.data_type = 's'
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")

    field_map = {f.slug: f for f in report_fields}
    for row_idx, record in enumerate(records, 2):
        for col_idx, value in enumerate((record['name'], record['status']), 1):
            ws.cell(row=row_idx, column=col_idx, value=value).data_type = 's'
        for col_idx, slug in enumerate(field_map.keys(), 3):
            field = field_map[slug]
            raw = record.get("values", {}).get(slug)
            if raw is not None:
                cell = ws.cell(row=row_idx, column=col_idx, value=_format_value(field, raw))
                # Record text must remain text, including strings starting '='.
                cell.data_type = "s"

    for col_idx, header in enumerate(headers, 1):
        ws.column_dimensions[get_column_letter(col_idx)].width = min(max(len(header), 12) + 4, 40)

    ws.freeze_panes = "A2"

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def export_to_pdf(fields: list[RecordField], records: list[dict[str, Any]], record_type_name: str,
                  summary: dict | None = None, filters: dict | None = None) -> bytes:
    buf = BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=landscape(A4), rightMargin=30, leftMargin=30, topMargin=30, bottomMargin=30)
    styles = getSampleStyleSheet()
    elements = []

    elements.append(Paragraph(f"{escape(record_type_name)} Report", styles["Title"]))
    elements.append(Spacer(1, 0.2 * inch))
    elements.append(Paragraph(f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", styles["Normal"]))

    if summary:
        elements.append(Spacer(1, 0.1 * inch))
        for key, val in summary.items():
            elements.append(Paragraph(f"<b>{escape(str(key))}:</b> {escape(str(val))}", styles["Normal"]))

    if filters:
        elements.append(Spacer(1, 0.1 * inch))
        filter_text = ", ".join(f"{k}={v}" for k, v in filters.items() if v)
        if filter_text:
            elements.append(Paragraph(f"<b>Filters:</b> {escape(filter_text)}", styles["Normal"]))

    elements.append(Spacer(1, 0.3 * inch))

    report_fields = [f for f in fields if f.show_in_reports and f.field_type != 'secret']
    headers = ['Record name', 'Business status'] + [f.name for f in report_fields]
    data = [headers]
    for record in records:
        row = [record['name'], record['status']]
        for field in report_fields:
            raw = record.get("values", {}).get(field.slug)
            row.append(_format_value(field, raw) if raw is not None else "")
        data.append(row)

    table = Table(data, repeatRows=1)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#366092")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (-1, -1), "LEFT"),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F2F2F2")]),
    ]))
    elements.append(table)

    doc.build(elements)
    return buf.getvalue()
