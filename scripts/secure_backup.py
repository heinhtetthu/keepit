"""Encrypted, authenticated chunked backups. No plaintext dump is written during backup."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import struct
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from cryptography.fernet import Fernet

ROOT = Path(os.getenv('BACKUP_DIR', '/backups'))
MAGIC = b'RENEWLY-BACKUP-1\n'


def run(*args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def cipher():
    key = os.environ.get('BACKUP_ENCRYPTION_KEY', '')
    if not key:
        raise ValueError('BACKUP_ENCRYPTION_KEY is required')
    return Fernet(key.encode())


def state(**values):
    ROOT.mkdir(parents=True, exist_ok=True)
    path = ROOT / 'status.json'
    before = json.loads(path.read_text()) if path.exists() else {}
    path.with_suffix('.tmp').write_text(json.dumps({**before, **values}))
    os.replace(path.with_suffix('.tmp'), path)


def backup():
    ROOT.mkdir(parents=True, exist_ok=True)
    os.umask(0o077)
    crypt = cipher()
    name = 'backup_' + datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S') + '_' + secrets.token_hex(3) + '.enc'
    target = ROOT / name
    partial = target.with_suffix('.partial')
    digest = hashlib.sha256()
    process = subprocess.Popen(['pg_dump', '--format=custom', '--no-owner', '--no-privileges'], stdout=subprocess.PIPE)
    try:
        with partial.open('wb') as stream:
            stream.write(MAGIC)
            index = 0
            while True:
                chunk = process.stdout.read(64 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
                token = crypt.encrypt(b'D' + struct.pack('>Q', index) + chunk)
                stream.write(struct.pack('>I', len(token)) + token)
                index += 1
            if process.wait() != 0:
                raise RuntimeError('pg_dump failed')
            final = crypt.encrypt(b'F' + struct.pack('>Q', index) + digest.digest())
            stream.write(struct.pack('>I', len(final)) + final)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(partial, target)
        state(last_success=datetime.now(timezone.utc).isoformat(), latest=name, error=None)
        # Retention touches only verified backup filenames inside the configured directory.
        cutoff = time.time() - int(os.getenv('BACKUP_RETENTION_DAYS', '30')) * 86400
        for old in ROOT.glob('backup_*.enc'):
            if old != target and old.is_file() and old.stat().st_mtime < cutoff:
                old.unlink()
        print('Encrypted backup completed:', name, flush=True)
        return target
    finally:
        if process.poll() is None:
            process.kill(); process.wait()
        partial.unlink(missing_ok=True)


def decrypt_to(source, output):
    crypt = cipher()
    digest = hashlib.sha256(); index = 0
    with source.open('rb') as stream:
        if stream.read(len(MAGIC)) != MAGIC:
            raise ValueError('Unknown backup format')
        while True:
            size = stream.read(4)
            if len(size) != 4:
                raise ValueError('Backup is truncated')
            length = struct.unpack('>I', size)[0]
            if length > 128 * 1024:
                raise ValueError('Invalid backup frame length')
            payload = crypt.decrypt(stream.read(length))
            if len(payload) < 9 or struct.unpack('>Q', payload[1:9])[0] != index:
                raise ValueError('Backup frame order is invalid')
            if payload[:1] == b'F':
                if payload[9:] != digest.digest() or stream.read(1):
                    raise ValueError('Backup integrity check failed')
                break
            if payload[:1] != b'D':
                raise ValueError('Invalid backup frame')
            output.write(payload[9:]); digest.update(payload[9:]); index += 1


def restore(source, database):
    if not re.fullmatch(r'[a-z][a-z0-9_]{1,50}', database):
        raise ValueError('Invalid database name')
    # Plaintext exists only in an isolated, private temporary file in this container.
    with tempfile.TemporaryFile() as plain:
        decrypt_to(source, plain)
        plain.seek(0)
        run('pg_restore', '--exit-on-error', '--single-transaction', '--clean', '--if-exists',
            '--no-owner', '--no-privileges', '--dbname', database, stdin=plain)


def verify(source):
    database = 'renewly_restore_' + secrets.token_hex(8)
    run('psql', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', f'CREATE DATABASE {database}')
    try:
        restore(source, database)
        run('psql', '-d', database, '-v', 'ON_ERROR_STOP=1', '-c', 'SELECT count(*) AS restored_records FROM records; SELECT version_num FROM alembic_version;')
        state(last_restore_verified=datetime.now(timezone.utc).isoformat())
    finally:
        run('psql', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-c', f'DROP DATABASE IF EXISTS {database} WITH (FORCE)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--loop', action='store_true')
    parser.add_argument('--verify', action='store_true')
    parser.add_argument('--restore', type=Path)
    parser.add_argument('--database')
    parser.add_argument('--confirm-database')
    args = parser.parse_args()
    if args.restore:
        if not args.database or args.confirm_database != args.database:
            raise ValueError('Restore requires matching --database and --confirm-database values')
        restore(args.restore, args.database)
        print('Restore completed with integrity and SQL error checks.')
        return
    while True:
        try:
            result = backup()
            if args.verify or args.loop:
                verify(result)
        except Exception as exc:
            # Avoid provider/environment messages containing credentials.
            state(error=type(exc).__name__, last_failure=datetime.now(timezone.utc).isoformat())
            if not args.loop:
                raise RuntimeError('Backup/restore verification failed; inspect local service logs') from None
            print('Backup/restore verification failed:', type(exc).__name__, flush=True)
        if not args.loop:
            break
        time.sleep(int(os.getenv('BACKUP_INTERVAL_SECONDS', '86400')))


if __name__ == '__main__':
    main()
