# Backups

## Backup

```bash
./scripts/backup.sh
```

Creates a PostgreSQL dump in `./backups/`.

## Restore

```bash
./scripts/restore.sh ./backups/backup_20261001_120000.sql
```

## Data Persistence

PostgreSQL data is stored in the `postgres_data` Docker volume, which persists across container restarts.

## Recommended Schedule

- Daily automated backups
- 30-day retention
- Test restores monthly
