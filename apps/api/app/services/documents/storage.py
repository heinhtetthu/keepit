"""Pluggable blob storage for uploaded documents.

Local volume by default; S3-compatible (AWS, R2, MinIO...) when
STORAGE_BACKEND=s3, so the API stays stateless and can scale horizontally.
Only metadata lives in Postgres (documents.storage_key).
"""
import asyncio
import os
import secrets
from datetime import date
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings


class Storage(Protocol):
    async def put(self, key: str, data: bytes, content_type: str) -> None: ...
    async def get(self, key: str) -> bytes: ...
    async def delete(self, key: str) -> None: ...


def new_key(ext: str) -> str:
    today = date.today()
    return f"{today.year}/{today.month:02d}/{secrets.token_hex(16)}{'.' + ext if ext else ''}"


class LocalStorage:
    def __init__(self, root: str):
        self.root = Path(root).resolve()

    def _path(self, key: str) -> Path:
        p = (self.root / key).resolve()
        if self.root not in p.parents:
            raise ValueError("Invalid storage key")
        return p

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        p = self._path(key)

        def write():
            p.parent.mkdir(parents=True, exist_ok=True)
            tmp = p.with_suffix(p.suffix + ".tmp")
            tmp.write_bytes(data)
            os.replace(tmp, p)
        await asyncio.to_thread(write)

    async def get(self, key: str) -> bytes:
        return await asyncio.to_thread(self._path(key).read_bytes)

    async def delete(self, key: str) -> None:
        p = self._path(key)
        await asyncio.to_thread(lambda: p.unlink(missing_ok=True))


class S3Storage:
    """Minimal SigV4 client over httpx (avoids a boto3 dependency)."""

    def __init__(self):
        s = get_settings()
        self.bucket, self.region = s.S3_BUCKET, s.S3_REGION
        self.endpoint = (s.S3_ENDPOINT_URL or f"https://s3.{s.S3_REGION}.amazonaws.com").rstrip("/")
        self.key_id, self.secret = s.S3_ACCESS_KEY_ID, s.S3_SECRET_ACCESS_KEY

    def _signed(self, method: str, key: str, body: bytes = b"", content_type: str | None = None):
        import hashlib
        import hmac
        from datetime import datetime, timezone
        from urllib.parse import quote, urlparse
        url = f"{self.endpoint}/{self.bucket}/{quote(key)}"
        host = urlparse(url).netloc
        now = datetime.now(timezone.utc)
        amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
        payload_hash = hashlib.sha256(body).hexdigest()
        headers = {"host": host, "x-amz-content-sha256": payload_hash, "x-amz-date": amz_date}
        if content_type:
            headers["content-type"] = content_type
        signed_headers = ";".join(sorted(headers))
        canonical = "\n".join([method, urlparse(url).path, "",
                               "".join(f"{k}:{headers[k]}\n" for k in sorted(headers)), signed_headers, payload_hash])
        scope = f"{day}/{self.region}/s3/aws4_request"
        to_sign = "\n".join(["AWS4-HMAC-SHA256", amz_date, scope, hashlib.sha256(canonical.encode()).hexdigest()])

        def h(k, m):
            return hmac.new(k, m.encode(), hashlib.sha256).digest()
        k = h(h(h(h(("AWS4" + self.secret).encode(), day), self.region), "s3"), "aws4_request")
        sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
        headers["authorization"] = (f"AWS4-HMAC-SHA256 Credential={self.key_id}/{scope}, "
                                    f"SignedHeaders={signed_headers}, Signature={sig}")
        headers.pop("host")
        return url, headers

    async def _call(self, method: str, key: str, body: bytes = b"", content_type: str | None = None) -> bytes:
        import httpx
        url, headers = self._signed(method, key, body, content_type)
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.request(method, url, content=body or None, headers=headers)
        if r.status_code == 404 and method == "DELETE":
            return b""
        r.raise_for_status()
        return r.content

    async def put(self, key: str, data: bytes, content_type: str) -> None:
        await self._call("PUT", key, data, content_type)

    async def get(self, key: str) -> bytes:
        return await self._call("GET", key)

    async def delete(self, key: str) -> None:
        await self._call("DELETE", key)


_storage: Storage | None = None


def get_storage() -> Storage:
    global _storage
    if _storage is None:
        s = get_settings()
        _storage = S3Storage() if s.STORAGE_BACKEND == "s3" else LocalStorage(s.DOCUMENTS_DIR)
    return _storage


def set_storage(storage: Storage | None) -> None:
    """Tests swap in a temporary directory."""
    global _storage
    _storage = storage
