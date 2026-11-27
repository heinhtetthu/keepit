from fastapi import APIRouter
from app.api.v1 import help
from app.api.v1 import history
from app.api.v1 import departments
from app.api.v1 import security
from app.api.v1 import operations
from app.api.v1 import report_jobs

from app.api.v1 import user_access, branding, asset_reports
from app.api.v1 import account, assets, borrows, documents, reference, workspace
from app.api.v1 import auth, users, record_types, records, assignments, employees, business_units, reminders, reports, audit, health, dashboard, settings, views, import_records, search

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(security.router)
api_router.include_router(operations.router)
api_router.include_router(report_jobs.router)
api_router.include_router(help.router)
api_router.include_router(auth.router)
api_router.include_router(branding.router)
api_router.include_router(asset_reports.router)
api_router.include_router(user_access.router)
api_router.include_router(users.router)
api_router.include_router(record_types.router)
api_router.include_router(records.router)
api_router.include_router(assignments.router)
api_router.include_router(employees.router)
api_router.include_router(business_units.router)
api_router.include_router(departments.router)
api_router.include_router(search.router)
api_router.include_router(views.router)
api_router.include_router(import_records.router)
api_router.include_router(reminders.router)
api_router.include_router(reports.router)
api_router.include_router(audit.router)
api_router.include_router(health.router)
api_router.include_router(dashboard.router)
api_router.include_router(settings.router)
api_router.include_router(account.router)
api_router.include_router(assets.router)
api_router.include_router(borrows.router)
api_router.include_router(documents.router)
api_router.include_router(reference.router)
api_router.include_router(workspace.router)
api_router.include_router(history.router)
