"""AI client for the assistant chat.

Talks to any OpenAI-compatible /chat/completions endpoint. Config comes from
Settings > Assistant (system_settings: ai_base_url, ai_model, ai_api_key
[encrypted]) and falls back to environment variables.
"""
import json
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.models.settings import SystemSetting


@dataclass
class AIConfig:
    base_url: str
    api_key: str
    model: str

    @property
    def ready(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


def env_ai_config() -> AIConfig:
    s = get_settings()
    return AIConfig(base_url=(s.AI_BASE_URL or "").rstrip("/"), api_key=s.AI_API_KEY or s.OPENAI_API_KEY,
                    model=s.AI_MODEL or s.OPENAI_MODEL)


async def get_ai_config(db: AsyncSession) -> AIConfig:
    s = get_settings()
    rows = dict((await db.execute(select(SystemSetting.key, SystemSetting.value).where(
        SystemSetting.key.in_(["ai_base_url", "ai_model", "ai_api_key"])))).all())
    api_key = ""
    if rows.get("ai_api_key"):
        from app.services.encryption import decrypt as decrypt_text
        api_key = decrypt_text(rows["ai_api_key"])
    return AIConfig(
        base_url=(rows.get("ai_base_url") or s.AI_BASE_URL or "").rstrip("/"),
        api_key=api_key or s.AI_API_KEY or s.OPENAI_API_KEY,
        model=rows.get("ai_model") or s.AI_MODEL or s.OPENAI_MODEL,
    )


def _map_error(exc: httpx.HTTPStatusError) -> AppException:
    code = exc.response.status_code
    try:
        err = exc.response.json().get("error") or {}
    except (ValueError, AttributeError):
        err = {}
    err = err if isinstance(err, dict) else {}
    if code == 429:
        if err.get("type") == "insufficient_quota" or err.get("code") in {"insufficient_quota", "credit_balance_exhausted"}:
            return AppException("AI_CREDITS_EXHAUSTED", "The AI provider's credits are exhausted. Ask your administrator to check billing.", 503)
        return AppException("AI_PROVIDER_RATE_LIMIT", "The AI provider is rate-limiting requests. Please try again shortly.", 429)
    if code == 401:
        return AppException("AI_KEY_REJECTED", "The AI provider rejected the configured API key.", 503)
    if code in (403, 404):
        return AppException("AI_MODEL_UNAVAILABLE", "The configured AI model is unavailable.", 503)
    return AppException("AI_UNAVAILABLE", "The AI provider could not reply. Please try again shortly.", 503)


async def chat_completion(cfg: AIConfig, messages: list[dict], *, json_mode: bool = False,
                          max_tokens: int = 1500, timeout: float = 60) -> str:
    if not cfg.ready:
        raise AppException("AI_NOT_CONFIGURED", "AI is not configured. A System Admin can set it up in Settings > Assistant.", 503)
    body: dict = {"model": cfg.model, "messages": messages, "max_tokens": max_tokens, "temperature": 0}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(f"{cfg.base_url}/chat/completions", json=body,
                                  headers={"Authorization": f"Bearer {cfg.api_key}"})
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]
    except httpx.HTTPStatusError as exc:
        raise _map_error(exc)
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        # Provider bodies can echo submitted content: never return or log them.
        raise AppException("AI_UNAVAILABLE", "The AI provider could not reply. Please try again shortly.", 503)
    if isinstance(content, list):  # some providers return content parts
        content = "".join(p.get("text", "") for p in content if isinstance(p, dict))
    if not (content or "").strip():
        raise AppException("AI_UNAVAILABLE", "The AI provider returned an empty reply.", 503)
    return content


def parse_json_reply(text: str) -> dict:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object in reply")
    return json.loads(t[start:end + 1])
