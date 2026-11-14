from fastapi import HTTPException


class AppError(HTTPException):
    def __init__(self, code: str, message: str, status: int = 400, *, details=None):
        self.code = code
        self.message = message
        self.details = details or {}
        super().__init__(status_code=status, detail=message)


def ok(data=None):
    return {"success": True, "data": data, "error": None}
