"""What the AI may extract per document type, and where a confirmed value is
saved (port of AssetWise src/lib/extraction/fields.ts)."""
from dataclasses import dataclass

DOC_TYPES = {
    "invoice": "Asset purchase invoice",
    "repair": "Repair invoice",
    "warranty": "Warranty certificate",
    "contract": "Employee contract",
    "license": "Software license",
    "maintenance": "Maintenance record",
    "log-sheet": "Log sheet (CSV)",
}
MAX_LOG_ROWS = 100
MAX_TEXT_CHARS = 40_000
MAX_FILE_BYTES = 4 * 1024 * 1024
SUPPORTED_MIME = {"application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif", "text/plain", "text/csv"}


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    kind: str = "text"  # text | date | currency | number | enum
    hint: str | None = None
    enum: tuple[str, ...] = ()
    save: str | None = None  # "<entity>.<column>"; None = informational only


BODY = ("Good", "Fair", "Needs Repair", "Repaired", "Not Applicable")
FIELDS: dict[str, list[Field]] = {
    "invoice": [
        Field("vendor", "Vendor", save="asset.supplier"), Field("invoiceNumber", "Invoice No."),
        Field("purchaseDate", "Purchase Date", "date", save="asset.purchase_date"),
        Field("brand", "Brand", save="asset.brand"), Field("model", "Product / Model", save="asset.model"),
        Field("serialNumber", "Serial Number", save="asset.serial_number"),
        Field("purchasePrice", "Purchase Price", "currency", save="asset.purchase_cost"),
        Field("currency", "Currency", hint="e.g. MMK, USD", save="asset.currency"),
        Field("warrantyEndDate", "Warranty End", "date", save="asset.warranty_end_date"),
    ],
    "repair": [
        Field("vendor", "Repair Shop", save="repair.vendor"), Field("invoiceNumber", "Invoice No."),
        Field("repairDate", "Repair Date", "date", save="repair.repair_date"),
        Field("issue", "Problem / Work Done", save="repair.issue"),
        Field("repairCost", "Repair Cost", "currency", save="repair.cost"),
        Field("currency", "Currency", hint="e.g. MMK, USD", save="repair.currency"),
        Field("repairWarranty", "Repair Warranty", hint="e.g. 30 days on the repair work", save="repair.warranty"),
        Field("repairNotes", "Notes", save="repair.notes"),
    ],
    "warranty": [
        Field("vendor", "Vendor", save="asset.supplier"), Field("brand", "Brand", save="asset.brand"),
        Field("model", "Product", save="asset.model"), Field("serialNumber", "Serial Number", save="asset.serial_number"),
        Field("warrantyStartDate", "Warranty Start", "date"),
        Field("warrantyEndDate", "Warranty End", "date", save="asset.warranty_end_date"),
        Field("coverage", "Coverage Summary", hint="What the warranty covers"),
    ],
    "contract": [
        Field("employeeName", "Full Name", save="employee.name"), Field("position", "Position", save="employee.title"),
        Field("department", "Department", save="employee.business_units"),
        Field("joinDate", "Join Date", "date", save="employee.join_date"),
        Field("email", "Email", hint="Confirm carefully", save="employee.email"),
        Field("contractType", "Contract Type", hint="e.g. Full-time, Probation"),
        Field("startDate", "Contract Start", "date"), Field("endDate", "Contract End", "date"),
    ],
    "license": [
        Field("productName", "Product Name"), Field("vendor", "Vendor"), Field("licenseKey", "License Key"),
        Field("licenseeName", "Licensee Name"), Field("seats", "Seats / Users", "number"),
        Field("cost", "Cost", "currency"), Field("currency", "Currency"),
        Field("purchaseDate", "Purchase Date", "date"), Field("expiryDate", "Expiry Date", "date", save="document.expiry_date"),
    ],
    "maintenance": [
        Field("vendor", "Vendor", hint="Recorded in the notes"),
        Field("maintenanceDate", "Maintenance Date", "date", save="maintenance.maintenance_date"),
        Field("workDescription", "Work Description", save="maintenance.notes"),
        Field("operatingSystem", "Operating System", save="maintenance.operating_system"),
        Field("assetStatus", "Asset Status After", "enum", enum=("Operational", "In Repair", "Written-Off"), save="maintenance.asset_status"),
        Field("bodyCondition", "Body Condition", "enum", enum=BODY, save="maintenance.body_condition"),
    ],
    "log-sheet": [
        Field("logType", "Log Type", "enum", hint="repair, maintenance or borrow", enum=("repair", "maintenance", "borrow")),
        Field("serialNumber", "Asset Serial", hint="Matched to an asset"),
        Field("date", "Date", "date", hint="Repair, maintenance or borrow date"),
        Field("itemName", "Item Name", hint="For borrow rows"),
        Field("borrowerName", "Borrower", hint="Matched to an employee by name"),
        Field("expectedReturnDate", "Expected Return", "date"), Field("returnedDate", "Actual Return", "date"),
        Field("issue", "Issue"), Field("vendor", "Vendor"), Field("cost", "Cost", "currency"),
        Field("warranty", "Warranty"), Field("bodyCondition", "Body Condition", "enum", enum=BODY), Field("notes", "Notes"),
    ],
}


def describe(doc_type: str) -> list[dict]:
    return [{"key": f.key, "label": f.label, "kind": f.kind, "hint": f.hint, "enum": list(f.enum), "save": f.save}
            for f in FIELDS[doc_type]]
