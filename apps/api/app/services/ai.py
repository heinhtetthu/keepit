"""AI client for the assistant chat.

Talks to any OpenAI-compatible /chat/completions endpoint. Config comes from
Settings > AI (system_settings: ai_provider, ai_base_url [custom only],
ai_model, ai_api_key [encrypted]) and falls back to the AI_* environment
variables. Named providers always use the fixed base URL in PROVIDERS, so a
stored provider id can never point requests at another host.
"""
import json
import time
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.exceptions import AppException
from app.models.settings import SystemSetting


CUSTOM = "custom"

# Fixed, OpenAI-compatible endpoints. Static model lists are a fallback for
# when the live /models call is unavailable (no key yet, provider down).
PROVIDERS: dict[str, dict] = {
    "openai": {"label": "OpenAI (ChatGPT)", "base_url": "https://api.openai.com/v1",
               "models": ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini"]},
    "gemini": {"label": "Google Gemini", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
               "models": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]},
    "anthropic": {"label": "Anthropic Claude", "base_url": "https://api.anthropic.com/v1",
                  "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"]},
    "xai": {"label": "xAI Grok", "base_url": "https://api.x.ai/v1",
            "models": ["grok-4", "grok-4-fast", "grok-3", "grok-3-mini"]},
    "mistral": {"label": "Mistral", "base_url": "https://api.mistral.ai/v1",
                "models": ["mistral-large-latest", "mistral-medium-latest", "mistral-small-latest", "codestral-latest"]},
    "deepseek": {"label": "DeepSeek", "base_url": "https://api.deepseek.com/v1",
                 "models": ["deepseek-chat", "deepseek-reasoner"]},
    "groq": {"label": "Groq", "base_url": "https://api.groq.com/openai/v1",
             "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b", "openai/gpt-oss-20b"]},
    "openrouter": {"label": "OpenRouter", "base_url": "https://openrouter.ai/api/v1",
                   "models": ["openai/gpt-5-mini", "openai/gpt-4o-mini", "google/gemini-2.5-flash",
                              "anthropic/claude-sonnet-4.5", "meta-llama/llama-3.3-70b-instruct"]},
}


def provider_catalogue() -> list[dict]:
    items = [{"id": k, "label": v["label"], "base_url": v["base_url"], "models": v["models"]} for k, v in PROVIDERS.items()]
    return items + [{"id": CUSTOM, "label": "Custom (OpenAI-compatible)", "base_url": "", "models": []}]


def provider_for_url(base_url: str) -> str:
    url = (base_url or "").rstrip("/")
    return next((k for k, v in PROVIDERS.items() if v["base_url"] == url), CUSTOM)


@dataclass
class AIConfig:
    base_url: str
    api_key: str
    model: str
    provider: str = CUSTOM

    @property
    def ready(self) -> bool:
        return bool(self.base_url and self.api_key and self.model)


def env_ai_config() -> AIConfig:
    s = get_settings()
    base_url = (s.AI_BASE_URL or "").rstrip("/")
    return AIConfig(base_url=base_url, api_key=s.AI_API_KEY or s.OPENAI_API_KEY,
                    model=s.AI_MODEL or s.OPENAI_MODEL, provider=provider_for_url(base_url))


async def get_ai_config(db: AsyncSession) -> AIConfig:
    s = get_settings()
    rows = dict((await db.execute(select(SystemSetting.key, SystemSetting.value).where(
        SystemSetting.key.in_(["ai_provider", "ai_base_url", "ai_model", "ai_api_key"])))).all())
    api_key = ""
    if rows.get("ai_api_key"):
        from app.services.encryption import decrypt as decrypt_text
        api_key = decrypt_text(rows["ai_api_key"])
    provider = rows.get("ai_provider") or ""
    if provider in PROVIDERS:
        base_url = PROVIDERS[provider]["base_url"]
    else:
        base_url = (rows.get("ai_base_url") or s.AI_BASE_URL or "").rstrip("/")
        provider = provider_for_url(base_url) if not provider else CUSTOM
    return AIConfig(
        base_url=base_url,
        api_key=api_key or s.AI_API_KEY or s.OPENAI_API_KEY,
        model=rows.get("ai_model") or s.AI_MODEL or s.OPENAI_MODEL,
        provider=provider,
    )


def _auth_headers(cfg: AIConfig) -> dict:
    headers = {"Authorization": f"Bearer {cfg.api_key}"}
    if cfg.provider == "anthropic":  # the native /models listing wants these
        headers |= {"x-api-key": cfg.api_key, "anthropic-version": "2023-06-01"}
    return headers


async def list_models(cfg: AIConfig, *, timeout: float = 8) -> dict:
    """Live model ids from the provider's /models endpoint, else the static list.

    Only ever called with a fixed provider URL or a base URL that passed the
    settings validation. Redirects are not followed and provider error bodies
    are never echoed back."""
    static = PROVIDERS.get(cfg.provider, {}).get("models", [])
    if not cfg.base_url or not cfg.api_key:
        return {"models": static, "source": "static", "message": "Add an API key to load the live model list."}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout, connect=5), follow_redirects=False) as client:
            r = await client.get(f"{cfg.base_url}/models", headers=_auth_headers(cfg))
            r.raise_for_status()
            data = r.json()
        items = data.get("data", data.get("models", [])) if isinstance(data, dict) else data
        ids = []
        for item in items if isinstance(items, list) else []:
            mid = item.get("id") or item.get("name") if isinstance(item, dict) else item
            if isinstance(mid, str) and mid.strip():
                mid = mid.strip().removeprefix("models/")
                if len(mid) <= 200 and mid not in ids:
                    ids.append(mid)
        if not ids:
            raise ValueError("empty list")
        return {"models": sorted(ids)[:500], "source": "live", "message": None}
    except httpx.HTTPStatusError as exc:
        message = _map_error(exc).detail["error"]["message"]
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        message = "Could not load the live model list."
    return {"models": static, "source": "static", "message": message + " Showing suggested models."}


async def test_connection(cfg: AIConfig) -> dict:
    started = time.monotonic()
    try:
        await chat_completion(cfg, [{"role": "user", "content": "Reply with the single word OK."}], max_tokens=16, timeout=20)
    except AppException as exc:
        return {"ok": False, "message": exc.detail["error"]["message"]}
    return {"ok": True, "message": f"Connected to {cfg.model}.", "latency_ms": int((time.monotonic() - started) * 1000)}


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
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            r = await client.post(f"{cfg.base_url}/chat/completions", json=body,
                                  headers={"Authorization": f"Bearer {cfg.api_key}"})
            if r.status_code == 400 and any(w in r.text for w in ("max_tokens", "temperature")):
                # Reasoning models (for example gpt-5) want max_completion_tokens and the default temperature.
                body.pop("temperature", None)
                body["max_completion_tokens"] = max(body.pop("max_tokens"), 1024)
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
