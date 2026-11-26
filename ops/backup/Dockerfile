FROM postgres:16-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-cryptography && rm -rf /var/lib/apt/lists/*
COPY scripts/secure_backup.py /ops/secure_backup.py
RUN mkdir -p /backups && chown postgres:postgres /backups
USER postgres
ENTRYPOINT ["python3", "/ops/secure_backup.py"]
