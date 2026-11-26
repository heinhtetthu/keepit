from typing import Generic, TypeVar
from pydantic import BaseModel

T = TypeVar("T")


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    page: int
    page_size: int
    total: int
    total_pages: int


class ErrorResponse(BaseModel):
    code: str
    message: str
    details: dict | None = None


class MessageResponse(BaseModel):
    message: str
