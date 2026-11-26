"""Upload validation (port of AssetWise src/lib/document-validation.ts)."""
import re

ALLOWED_FILE_EXTENSIONS: dict[str, str] = {
    "pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "gif": "image/gif", "webp": "image/webp", "txt": "text/plain", "csv": "text/csv",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}
INLINE_PREVIEWABLE = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain", "text/csv"}
_ALIASES = {"image/jpg": "image/jpeg", "application/x-pdf": "application/pdf", "application/acrobat": "application/pdf"}
# Binary formats whose signature we can check; text/Office formats are trusted by extension.
_MAGIC_CHECKED = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"}


def extension(file_name: str) -> str:
    base = file_name.replace("\\", "/").split("/")[-1]
    dot = base.rfind(".")
    ext = base[dot + 1:].lower() if dot > 0 else ""
    return ext if re.fullmatch(r"[a-z0-9]{1,10}", ext) else ""


def sniff_mime(data: bytes) -> str | None:
    if len(data) < 12:
        return None
    if data[:4] == b"\x89PNG":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:3] == b"GIF":
        return "image/gif"
    if data[:4] == b"%PDF":
        return "application/pdf"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def validate_upload(file_name: str, declared_mime: str | None, data: bytes, max_bytes: int) -> tuple[str | None, str]:
    """Return (error, canonical_mime)."""
    name = (file_name or "").strip()
    if not name:
        return "A file is required.", ""
    ext = extension(name)
    if not ext:
        return "File type not allowed. The file must have a valid extension.", ""
    mime = ALLOWED_FILE_EXTENSIONS.get(ext)
    if not mime:
        return "File type not allowed. Accepted types: PDF, images (PNG, JPG, GIF, WebP), text, CSV and Office documents.", ""
    declared = (declared_mime or "").lower().split(";")[0].strip()
    declared = _ALIASES.get(declared, declared)
    if declared and declared not in (mime, "application/octet-stream") and not (mime == "text/csv" and declared == "text/plain"):
        return f'The file content type ("{declared}") does not match its extension (.{ext}).', ""
    if not data:
        return "The file is empty.", ""
    if len(data) > max_bytes:
        return f"The file is too large. The maximum size is {max_bytes // (1024 * 1024)} MB.", ""
    if mime in _MAGIC_CHECKED and sniff_mime(data) != mime:
        return f"The file contents do not look like a .{ext} file.", ""
    return None, mime
