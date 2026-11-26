import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger("notifications")
logging.getLogger('httpx').setLevel(logging.WARNING)
logging.getLogger('httpcore').setLevel(logging.WARNING)


class NotificationError(Exception):
    pass


class NotificationProvider:
    async def send(self, chat_id: str, message: str) -> tuple[bool, str | None]:
        """Attempt delivery. Returns (success, error_description)."""
        raise NotImplementedError


class TelegramNotificationProvider(NotificationProvider):
    def __init__(self, token: str = ""):
        settings = get_settings()
        self.token = token or settings.TELEGRAM_BOT_TOKEN
        self.api_url = settings.TELEGRAM_API_URL

    async def send(self, chat_id: str, message: str) -> tuple[bool, str | None]:
        if not self.token:
            return False, "Telegram bot token is not configured for this bot"
        url = f"{self.api_url}/bot{self.token}/sendMessage"
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    url,
                    json={"chat_id": chat_id, "text": message, "parse_mode": "HTML"},
                )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("ok"):
                    return True, None
                return False, data.get("description") or "Telegram returned ok=false"
            try:
                desc = resp.json().get("description")
            except Exception:
                desc = None
            return False, desc or f"Telegram HTTP {resp.status_code}"
        except httpx.TimeoutException:
            return False, "Telegram request timed out"
        except httpx.HTTPError as exc:
            logger.warning("Telegram delivery error (%s)", exc.__class__.__name__)
            return False, f"Connection error: {exc.__class__.__name__}"


class NotificationService:
    def __init__(self):
        self._telegram = None

    def _get_provider(self, provider: str, bot_token: str | None = None) -> NotificationProvider | None:
        if provider == "telegram":
            return TelegramNotificationProvider(bot_token or "")
        return None

    async def send(self, provider: str, chat_id: str, message: str, bot_token: str | None = None) -> tuple[bool, str | None]:
        p = self._get_provider(provider, bot_token)
        if p is None:
            return False, f"Unknown notification provider: {provider}"
        return await p.send(chat_id, message)


notification_service = NotificationService()
