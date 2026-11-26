from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator
from app.services.encryption import encrypt, decrypt


class EncryptedText(TypeDecorator):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value, dialect):
        return encrypt(value) if value else value

    def process_result_value(self, value, dialect):
        return decrypt(value) if value else value
