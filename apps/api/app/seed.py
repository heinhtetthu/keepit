import asyncio
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.security import hash_password
from app.db.session import AsyncSessionLocal
from app.models.user import User, Role, Permission
from app.models.record_type import RecordType, RecordField, RecordFieldOption
from app.services.access_levels import system_roles

logger = logging.getLogger("seed")

RETIRED_PERMISSIONS = ["extraction.run"]

PERMISSIONS = [
    "record.view", "record.create", "record.edit", "record.delete",
    "record_type.view", "record_type.create", "record_type.edit", "record_type.delete",
    "field.view", "field.create", "field.edit", "field.delete",
    "report.view", "report.export",
    "user.view", "user.create", "user.edit", "user.delete",
    "reminder.view", "reminder.create", "reminder.edit", "reminder.delete",
    "notification.view", "audit.view", "settings.view", "settings.edit",
    "employee.manage",
    # Asset management (from AssetWise)
    "employee.view",
    "asset.view", "asset.create", "asset.edit", "asset.delete",
    "itlog.view", "itlog.manage",
    "document.view", "document.upload", "document.edit", "document.delete",
    "assistant.use", "reference.manage",
]

# Structured access roles (Assets/Records levels, Workspace admin, AI assistant).
# Descriptions and permission sets live in services/access_levels.py.
ROLES = {name: {"is_system": True, **data} for name, data in system_roles().items()}

REFERENCE_DEFAULTS = {
    "asset_type": ["Laptop", "Desktop", "Monitor", "Phone", "Tablet", "Printer", "Server", "Network", "UPS", "Other"],
    "brand": ["Apple", "Dell", "HP", "Lenovo", "Samsung", "Asus", "Acer", "Microsoft"],
    "location": ["Head Office", "Warehouse"],
}

ASSET_TYPE_TEMPLATES = {
    "Laptop": ["cpu", "gpu", "ram", "storage", "screenSize"],
    "Desktop": ["cpu", "gpu", "ram", "storage"],
    "Monitor": ["screenSize"],
    "Phone": ["storage", "screenSize"],
}


async def sync_permissions_and_roles(db: AsyncSession) -> None:
    """Idempotent: add new permissions, keep system roles current, retire old ones."""
    existing = {p.name: p for p in (await db.execute(select(Permission))).scalars().all()}
    for name in PERMISSIONS:
        if name not in existing:
            p = Permission(name=name, description=f"Permission to {name.replace('.', ' ')}")
            db.add(p)
            existing[name] = p
    # Permissions for removed features (AI document extraction, 2026-11).
    for name in RETIRED_PERMISSIONS:
        if name in existing:
            await db.delete(existing.pop(name))
    await db.flush()
    roles = {r.name: r for r in (await db.execute(select(Role).options(selectinload(Role.permissions)))).scalars().all()}
    for role_name, data in ROLES.items():
        perms = [existing[p] for p in dict.fromkeys(data["permissions"]) if p in existing]
        role = roles.get(role_name)
        if role is None:
            role = Role(name=role_name, description=data["description"], is_system=True, scope=data["scope"], level=data["level"])
            role.permissions = perms
            db.add(role)
        elif role.is_system:
            role.description, role.scope, role.level = data["description"], data["scope"], data["level"]
            role.permissions = perms
    # Retire system roles from the old single-role model (Super Admin, Admin, Editor, IT Staff, Viewer).
    for name, role in roles.items():
        if role.is_system and name not in ROLES:
            await db.delete(role)
    await db.flush()


async def seed_reference_data(db: AsyncSession) -> None:
    from app.models.reference import ReferenceItem
    from app.models.asset import AssetTypeTemplate
    if (await db.execute(select(ReferenceItem).limit(1))).scalar_one_or_none():
        return
    for kind, names in REFERENCE_DEFAULTS.items():
        for i, name in enumerate(names):
            db.add(ReferenceItem(kind=kind, name=name, sort_order=i))
    for asset_type, attrs in ASSET_TYPE_TEMPLATES.items():
        db.add(AssetTypeTemplate(asset_type=asset_type, attributes=attrs))
    await db.flush()


RECORD_TYPES = [
    {
        "name": "Subscription", "icon": "refresh-cw",
        "fields": [
            ("Provider", "text", True), ("Account / Username", "text", False), ("Category", "select", False),
            ("Cost", "currency", False), ("Currency", "select", False), ("Billing Cycle", "select", False),
            ("Start Date", "date", False), ("Renewal Date", "date", True), ("Auto Renewal", "boolean", False),
            ("Status", "select", False), ("Payment Method", "text", False), ("URL", "url", False), ("Notes", "long_text", False),
        ],
        "options": {
            "Category": ["Software", "Cloud", "Media", "Other"],
            "Currency": ["USD", "EUR", "GBP", "MMK"],
            "Billing Cycle": ["Monthly", "Quarterly", "Yearly", "One-time"],
            "Status": ["Active", "Expired", "Cancelled", "Pending"],
        },
    },
    {
        "name": "Domain", "icon": "globe",
        "fields": [
            ("Domain Name", "text", True), ("Registrar", "text", False), ("Registrant / Owner", "text", False),
            ("Registration Date", "date", False), ("Expiry Date", "date", True), ("Auto Renewal", "boolean", False),
            ("Cost", "currency", False), ("Currency", "select", False), ("DNS Provider", "text", False),
            ("Account", "text", False), ("Status", "select", False), ("URL", "url", False), ("Notes", "long_text", False),
        ],
        "options": {"Currency": ["USD", "EUR", "GBP", "MMK"], "Status": ["Active", "Expired", "Pending", "Suspended"]},
    },
    {
        "name": "License", "icon": "key",
        "fields": [
            ("Product Name", "text", True), ("Vendor", "text", False), ("License Type", "select", False),
            ("License Key", "text", False), ("Assigned To", "text", False), ("Number of Seats", "integer", False),
            ("Purchase Date", "date", False), ("Expiry Date", "date", True), ("Auto Renewal", "boolean", False),
            ("Cost", "currency", False), ("Currency", "select", False), ("Status", "select", False),
            ("Vendor URL", "url", False), ("Notes", "long_text", False),
        ],
        "options": {
            "License Type": ["Perpetual", "Subscription", "Volume", "OEM"],
            "Currency": ["USD", "EUR", "GBP", "MMK"],
            "Status": ["Active", "Expired", "Revoked", "Pending"],
        },
    },
]


async def seed(db: AsyncSession):
    await sync_permissions_and_roles(db)
    await seed_reference_data(db)
    if (await db.execute(select(User).limit(1))).scalar_one_or_none():
        await db.commit()
        logger.info("Users exist; synced permissions/roles only")
        return

    logger.info("Seeding admin user...")
    from app.core.config import get_settings
    settings = get_settings()
    bootstrap = settings.BOOTSTRAP_ADMIN_PASSWORD
    if settings.APP_ENV == 'production' and (not bootstrap or len(bootstrap) < 14 or bootstrap == 'admin12345'):
        raise ValueError('Production bootstrap requires BOOTSTRAP_ADMIN_PASSWORD (at least 14 characters)')
    admin = User(email="admin@example.com", username="admin", name="Admin", hashed_password=hash_password(bootstrap or "admin12345"),
                 is_active=True, is_superuser=True, must_change_password=settings.APP_ENV == "production")
    db.add(admin)

    logger.info("Seeding record types...")
    for rt_data in RECORD_TYPES:
        rt = RecordType(name=rt_data["name"], slug=rt_data["name"].lower(), description=f"{rt_data['name']} records", icon=rt_data["icon"])
        db.add(rt)
        await db.flush()
        for order, (field_name, field_type, required) in enumerate(rt_data["fields"]):
            field = RecordField(record_type_id=rt.id, name=field_name, slug=field_name.lower().replace(" / ", "_").replace(" ", "_").replace("/", "_"),
                field_type=field_type, required=required, display_order=order)
            db.add(field)
            await db.flush()
            options = rt_data.get("options", {}).get(field_name, [])
            for opt_order, opt_val in enumerate(options):
                db.add(RecordFieldOption(field_id=field.id, value=opt_val, label=opt_val, display_order=opt_order))

    await db.commit()
    logger.info("Seeding completed")


async def run_seed():
    async with AsyncSessionLocal() as db:
        await seed(db)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(run_seed())
