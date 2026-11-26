"""PostgreSQL row-level security for renewal records.

Defence in depth behind the API's own checks: even if a query forgets a
record-type filter, Postgres only returns rows from record types granted to
the signed-in user, and only lets them change rows in types granted with Edit.

How the context gets in:
  * The API connects as the non-owner role ``keepit_app`` (RLS applies to it).
  * Every authenticated request sets ``app.user_id`` / ``app.is_admin`` on the
    session (see ``app.db.session.set_rls_context``); it is re-applied at the
    start of every transaction, so mid-request commits keep the scope.
  * With no user in context (worker, migrations, seed, health checks) the
    policies allow access: those are trusted system jobs.
  * The table owner (used for migrations) bypasses RLS, as do superusers.
"""

import re

APP_ROLE = "keepit_app"

# Tables keyed by record_type_id directly or through records.
TABLES = ("records", "record_values", "record_renewals", "record_assignments")

_UID = "nullif(current_setting('app.user_id', true), '')"
_SYSTEM = f"({_UID} IS NULL OR current_setting('app.is_admin', true) = 'on')"


def _visible(type_expr: str) -> str:
    return (f"({_SYSTEM} OR {type_expr} IN (SELECT a.record_type_id FROM user_record_type_access a "  # nosec B608 (constants only)
            f"WHERE a.user_id = {_UID}::int))")


def _editable(type_expr: str) -> str:
    return (f"({_SYSTEM} OR {type_expr} IN (SELECT a.record_type_id FROM user_record_type_access a "  # nosec B608 (constants only)
            f"WHERE a.user_id = {_UID}::int AND a.can_edit))")


_TYPE_OF = {
    "records": "record_type_id",
    "record_values": "(SELECT r.record_type_id FROM records r WHERE r.id = record_id)",
    "record_renewals": "(SELECT r.record_type_id FROM records r WHERE r.id = record_id)",
    "record_assignments": "(SELECT r.record_type_id FROM records r WHERE r.id = record_id)",
}


def enable_statements() -> list[str]:
    out = []
    for t in TABLES:
        expr = _TYPE_OF[t]
        out += [
            f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY",
            f"DROP POLICY IF EXISTS keepit_select ON {t}",
            f"DROP POLICY IF EXISTS keepit_insert ON {t}",
            f"DROP POLICY IF EXISTS keepit_update ON {t}",
            f"DROP POLICY IF EXISTS keepit_delete ON {t}",
            f"CREATE POLICY keepit_select ON {t} FOR SELECT USING {_visible(expr)}",
            f"CREATE POLICY keepit_insert ON {t} FOR INSERT WITH CHECK {_editable(expr)}",
            f"CREATE POLICY keepit_update ON {t} FOR UPDATE USING {_editable(expr)} WITH CHECK {_editable(expr)}",
            f"CREATE POLICY keepit_delete ON {t} FOR DELETE USING {_editable(expr)}",
        ]
    return out


def disable_statements() -> list[str]:
    out = []
    for t in TABLES:
        out += [f"DROP POLICY IF EXISTS keepit_{c} ON {t}" for c in ("select", "insert", "update", "delete")]
        out.append(f"ALTER TABLE {t} DISABLE ROW LEVEL SECURITY")
    return out


def grant_statements() -> list[str]:
    """Least privilege for the app role: data access only, no DDL, no ownership."""
    return [f"""DO $$ BEGIN  
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
    GRANT USAGE ON SCHEMA public TO {APP_ROLE};
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {APP_ROLE};
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO {APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO {APP_ROLE};
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO {APP_ROLE};
    -- The audit trail is append-only for the app (redaction still updates payloads).
    REVOKE DELETE, TRUNCATE ON audit_logs FROM {APP_ROLE};
  END IF;
END $$"""]  # nosec B608 - fixed identifiers only


def role_statements(password: str) -> list[str]:
    """Create/refresh the least-privileged login role the API and worker use."""
    # Embedded in DDL (roles can't take bind parameters), so allow only a safe alphabet.
    if not re.fullmatch(r"[A-Za-z0-9_.~+=/-]{12,128}", password):
        raise ValueError("APP_DB_PASSWORD must be 12-128 chars of letters, digits or _.~+=/-")
    pw = password
    return [f"""DO $$ BEGIN  
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{APP_ROLE}') THEN
    CREATE ROLE {APP_ROLE} LOGIN PASSWORD '{pw}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE {APP_ROLE} WITH LOGIN PASSWORD '{pw}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END $$"""]  # nosec B608 - password validated above
