from fastapi import HTTPException, status


class AppException(HTTPException):
    def __init__(self, code: str, message: str, status_code: int = 400, details: dict | None = None):
        super().__init__(status_code=status_code, detail={"error": {"code": code, "message": message, "details": details}})


class NotFoundException(AppException):
    def __init__(self, message: str = "Resource not found"):
        super().__init__("NOT_FOUND", message, status.HTTP_404_NOT_FOUND)


class ForbiddenException(AppException):
    def __init__(self, message: str = "Insufficient permissions"):
        super().__init__("FORBIDDEN", message, status.HTTP_403_FORBIDDEN)


class UnauthorizedException(AppException):
    def __init__(self, message: str = "Authentication required"):
        super().__init__("UNAUTHORIZED", message, status.HTTP_401_UNAUTHORIZED)


class ConflictException(AppException):
    def __init__(self, message: str = "Resource conflict"):
        super().__init__("CONFLICT", message, status.HTTP_409_CONFLICT)

class ValidationException(AppException):
    def __init__(self, message: str = "Validation failed"):
        super().__init__("VALIDATION_ERROR", message, status.HTTP_400_BAD_REQUEST)
