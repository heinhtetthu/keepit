"""Product-number formats for auto-generated asset serials (port of AssetWise
src/lib/serial-format.ts).

Tokens: {SEQ:n} zero-padded sequence (default 4, max 10), {SEQ}, {YY}, {MM}, {DD},
{TYPE} (upper-cased asset type, spaces/hyphens -> underscores). Any other
{GROUP} is literal text with the braces stripped, e.g. {MSE}-{YY}-{SEQ:4}
renders MSE-26-0001.
"""
import re
from datetime import date

BRACE_GROUP_RE = re.compile(r"\{([A-Za-z0-9:_-]*)\}")
MAX_FORMAT_LENGTH = 40
MAX_SEQ_DIGITS = 10


def validate_serial_format(fmt: str) -> str | None:
    """Return an error message, or None when the format is valid."""
    trimmed = (fmt or "").strip()
    if len(trimmed) > MAX_FORMAT_LENGTH:
        return f"Format must be {MAX_FORMAT_LENGTH} characters or fewer."
    if "\n" in trimmed or "\r" in trimmed:
        return "Format must be a single line."
    for m in BRACE_GROUP_RE.finditer(trimmed):
        inner = m.group(1)
        if re.match(r"^SEQ[:?]", inner):
            digits = re.fullmatch(r"SEQ:(\d+)", inner)
            if not digits:
                return "{SEQ:n} takes a digit count, e.g. {SEQ:4}. For a literal prefix, just write it directly (e.g. MSE-)."
            n = int(digits.group(1))
            if n < 1 or n > MAX_SEQ_DIGITS:
                return f"{{SEQ:n}} supports 1–{MAX_SEQ_DIGITS} digits."
    return None


def format_serial_number(fmt: str, seq: int, on: date | None = None, asset_type: str = "") -> str:
    on = on or date.today()
    safe = max(1, int(seq))

    def repl(m: re.Match) -> str:
        inner = m.group(1)
        if re.fullmatch(r"SEQ(?::\d+)?", inner):
            digits = int(inner.split(":", 1)[1] or 4) if ":" in inner else 4
            return str(safe).zfill(min(max(digits or 4, 1), MAX_SEQ_DIGITS))
        if inner == "YY":
            return f"{on.year % 100:02d}"
        if inner == "MM":
            return f"{on.month:02d}"
        if inner == "DD":
            return f"{on.day:02d}"
        if inner == "TYPE":
            return re.sub(r"[\s-]+", "_", asset_type.upper())
        return inner

    return BRACE_GROUP_RE.sub(repl, fmt or "").strip()
