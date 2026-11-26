#!/bin/bash
set -euo pipefail
if [ "$#" -ne 2 ]; then
    echo 'Usage: scripts/restore.sh /backups/backup_NAME.enc TARGET_DATABASE'
    echo 'Stop backend and worker first. This replaces data in TARGET_DATABASE.'
    exit 1
fi
docker compose run --rm backups --restore "$1" --database "$2" --confirm-database "$2"
