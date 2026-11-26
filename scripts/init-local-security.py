"""Run in the backend image with /workspace mounted. Never prints secret values."""
from pathlib import Path
import os
import secrets
from cryptography.fernet import Fernet

path = Path('/workspace/.env')
lines = path.read_text(encoding='utf-8').splitlines() if path.exists() else []
values = dict(line.split('=', 1) for line in lines if '=' in line and not line.lstrip().startswith('#'))
updates = {}
for name in ('DATA_ENCRYPTION_KEYS', 'BACKUP_ENCRYPTION_KEY'):
    if not values.get(name):
        updates[name] = Fernet.generate_key().decode()
if not values.get('SECRET_KEY') or values.get('SECRET_KEY') == 'change-me-in-production':
    updates['SECRET_KEY'] = secrets.token_urlsafe(48)
# Database passwords: owner (migrations/backups) and the limited keepit_app role.
if not values.get('APP_DB_PASSWORD'):
    updates['APP_DB_PASSWORD'] = secrets.token_urlsafe(32)
if values.get('POSTGRES_PASSWORD', 'postgres') in ('', 'postgres'):
    updates['POSTGRES_PASSWORD'] = secrets.token_urlsafe(32)
for name, value in updates.items():
    lines = [line for line in lines if not line.startswith(name + '=')]
    lines.append(name + '=' + value)
temporary = path.with_suffix('.env.tmp')
temporary.write_text('\n'.join(lines) + '\n', encoding='utf-8')
os.chmod(temporary, 0o600)
os.replace(temporary, path)
backups = path.parent / 'backups'
backups.mkdir(exist_ok=True)
if hasattr(os, 'chown'):
    os.chown(backups, 999, 999)
os.chmod(backups, 0o700)
print('Local encryption keys, database passwords and signing key initialised; no secrets displayed.')
