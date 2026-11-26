from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    APP_ENV: str = "development"
    APP_NAME: str = "Keepit"  # product name shown in UI, emails and passkey prompts
    SECRET_KEY: str = "change-me-in-production"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/records"
    # Owner connection for migrations. Unset = DATABASE_URL. In Docker the API and
    # worker use the limited keepit_app role (row-level security applies to it).
    MIGRATION_DATABASE_URL: str = ""
    # Password for the keepit_app role; migrations create/refresh the role when set.
    APP_DB_PASSWORD: str = ""

    TIMEZONE: str = "Asia/Yangon"
    FRONTEND_URL: str = "http://localhost"
    API_URL: str = "http://localhost:8000"

    CORS_ALLOWED_ORIGINS: str = "http://localhost,http://localhost:5173"

    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_API_URL: str = "https://api.telegram.org"

    WORKER_INTERVAL_SECONDS: int = 300
    WORKER_BATCH_SIZE: int = 100
    WORKER_MAX_RETRIES: int = 3
    WORKER_RETRY_DELAY_SECONDS: int = 60
    # Send a reminder up to N days after its intended date (catch-up if worker was down)
    WORKER_CATCHUP_DAYS: int = 2
    FORECAST_MAX_CONCURRENT: int = 2
    FORECAST_QUERY_TIMEOUT_SECONDS: int = 15

    LOG_LEVEL: str = "INFO"
    OPENAI_API_KEY: str = ""
    OPENAI_MODEL: str = ""
    DATA_ENCRYPTION_KEYS: str = ""
    TRUST_PROXY_HEADERS: bool = False
    REQUIRE_ADMIN_MFA: bool = False
    BOOTSTRAP_ADMIN_PASSWORD: str = ""
    DELETED_RECORD_RETENTION_DAYS: int = 30
    DELIVERY_CONCURRENCY: int = 4
    ALLOWED_HOSTS: str = '*'

    # Documents: "local" (volume at DOCUMENTS_DIR) or "s3" (any S3-compatible store).
    STORAGE_BACKEND: str = "local"
    DOCUMENTS_DIR: str = "/data/documents"
    S3_BUCKET: str = ""
    S3_ENDPOINT_URL: str = ""
    S3_REGION: str = "us-east-1"
    S3_ACCESS_KEY_ID: str = ""
    S3_SECRET_ACCESS_KEY: str = ""
    MAX_DOCUMENT_BYTES: int = 10 * 1024 * 1024

    # AI assistant: any OpenAI-compatible chat completions endpoint.
    # Admins can override these in Settings (stored in system_settings).
    AI_BASE_URL: str = "https://api.openai.com/v1"
    AI_API_KEY: str = ""
    AI_MODEL: str = ""
    # Allow http:// AI endpoints on localhost / host.docker.internal (e.g. Ollama). Off by default.
    AI_ALLOW_LOCAL_PROVIDER: bool = False

    # Email (password reset). Resend HTTP API; empty key = log the link instead.
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""
    PASSWORD_RESET_TTL_MINUTES: int = 30

    # Passkeys (WebAuthn). RP id must be the site's registrable domain.
    WEBAUTHN_RP_ID: str = "localhost"
    WEBAUTHN_RP_NAME: str = "Keepit"
    WEBAUTHN_ORIGINS: str = "http://localhost,http://localhost:5173"

    def validate_production(self):
        if self.APP_ENV != 'production':
            return
        from urllib.parse import urlparse
        if len(self.SECRET_KEY) < 32 or self.SECRET_KEY == 'change-me-in-production':
            raise ValueError('Production requires a strong SECRET_KEY')
        if urlparse(self.DATABASE_URL).password in {'postgres', '', None}:
            raise ValueError('Production requires a non-default database password')
        if not self.DATA_ENCRYPTION_KEYS:
            raise ValueError('Production requires DATA_ENCRYPTION_KEYS')
        if not self.FRONTEND_URL.startswith('https://'):
            raise ValueError('Production requires an HTTPS FRONTEND_URL; use development for local-only deployment')
        if '*' in self.ALLOWED_HOSTS:
            raise ValueError('Production requires explicit ALLOWED_HOSTS')

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
