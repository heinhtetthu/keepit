from contextlib import asynccontextmanager
import logging
import time
from uuid import uuid4

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from app.api.v1 import api_router
from app.core.config import get_settings

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings.validate_production()
    yield


app = FastAPI(
    title=settings.APP_NAME,
    version="1.0.0",
    description="Generic Record Management & Renewal Platform API",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(TrustedHostMiddleware, allowed_hosts=[h.strip() for h in settings.ALLOWED_HOSTS.split(',')])


@app.middleware('http')
async def request_diagnostics(request, call_next):
    from app.services.actor import current_actor
    request_id = uuid4().hex
    started = time.monotonic()
    actor_token = current_actor.set(None)
    try:
        response = await call_next(request)
    finally:
        current_actor.reset(actor_token)
    response.headers['X-Request-ID'] = request_id
    if request.url.path.startswith('/api/') and not request.url.path.startswith('/api/v1/health'):
        logging.getLogger('requests').info('request=%s method=%s path=%s status=%s duration_ms=%.1f',
            request_id, request.method, request.url.path, response.status_code, (time.monotonic() - started) * 1000)
    return response

app.include_router(api_router)


@app.get("/")
async def root():
    return {"name": settings.APP_NAME, "version": "1.0.0", "docs": "/docs"}
