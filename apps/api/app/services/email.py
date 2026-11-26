"""Transactional email through the Resend HTTP API (port of AssetWise
src/lib/email.ts). With no RESEND_API_KEY the message is logged instead, so
local development still shows reset links."""
import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger("email")


async def send_email(to: str, subject: str, html: str, text: str) -> bool:
    s = get_settings()
    if not s.RESEND_API_KEY or not s.RESEND_FROM_EMAIL:
        logger.warning("Email not configured; would send to=%s subject=%s\n%s", to, subject, text)
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {s.RESEND_API_KEY}"},
                                  json={"from": s.RESEND_FROM_EMAIL, "to": [to], "subject": subject, "html": html, "text": text})
        r.raise_for_status()
        return True
    except httpx.HTTPError:
        logger.exception("Email delivery failed")
        return False
