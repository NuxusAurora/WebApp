from fastapi import HTTPException


class AppError(HTTPException):
    def __init__(self, code: str, message: str, status: int = 400):
        self.code = code
        self.message = message
        super().__init__(status_code=status, detail=message)


def ok(data=None):
    return {"success": True, "data": data, "error": None}
