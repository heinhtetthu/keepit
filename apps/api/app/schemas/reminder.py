from datetime import datetime
from pydantic import BaseModel, Field


class ReminderRuleCreate(BaseModel):
    record_type_id: int
    name: str = Field(min_length=1, max_length=255)
    days_before: int = Field(ge=0, le=365)
    active: bool = True
    template: str | None = Field(default=None, max_length=4096)


class ReminderRuleUpdate(BaseModel):
    name: str | None = None
    days_before: int | None = Field(default=None, ge=0, le=365)
    active: bool | None = None
    template: str | None = Field(default=None, max_length=4096)


class MessageTemplateUpdate(BaseModel):
    template: str | None = Field(default=None, max_length=4096)
    replace_rule_overrides: bool = False


class MessageTemplatePreview(BaseModel):
    template: str | None = Field(default=None, max_length=4096)
    record_id: int | None = Field(default=None, gt=0)
    days_before: int = Field(default=7, ge=0, le=365)


class ReminderRuleResponse(BaseModel):
    id: int
    record_type_id: int
    name: str
    days_before: int
    active: bool
    template: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ReminderLogResponse(BaseModel):
    id: int
    record_id: int
    record_name: str
    record_type_slug: str | None = None
    record_type_name: str | None = None
    reminder_rule_id: int
    rule_name: str
    days_before: int
    recipient_id: int
    recipient_name: str
    scheduled_date: datetime
    sent_at: datetime | None
    status: str
    error_message: str | None
    retry_count: int

    model_config = {"from_attributes": True}


class NotificationRecipientCreate(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    telegram_chat_id: str = Field(min_length=1, max_length=255)
    telegram_username: str | None = None
    telegram_bot_ids: list[int] = Field(default_factory=list)
    user_id: int
    active: bool = True


class NotificationRecipientUpdate(BaseModel):
    display_name: str | None = None
    telegram_chat_id: str | None = None
    telegram_username: str | None = None
    telegram_bot_ids: list[int] | None = None
    user_id: int | None = None
    active: bool | None = None


class NotificationRecipientResponse(BaseModel):
    id: int
    display_name: str
    telegram_chat_id: str
    telegram_username: str | None
    telegram_bot_ids: list[int] = []
    telegram_bot_names: list[str] = []
    user_id: int | None = None
    user_name: str | None = None
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TelegramBotBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    bot_token: str = Field(min_length=1, max_length=255)
    active: bool = True


class TelegramBotCreate(TelegramBotBase):
    pass


class TelegramBotUpdate(BaseModel):
    name: str | None = None
    bot_token: str | None = Field(default=None, min_length=1, max_length=255)
    active: bool | None = None


class TelegramBotResponse(BaseModel):
    id: int
    name: str
    bot_token: str
    active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
