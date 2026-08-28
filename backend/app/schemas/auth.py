"""
schemas/auth.py — request/response ของการล็อกอินแอดมิน
"""
from pydantic import BaseModel, ConfigDict

from app.models.enums import AdminRole


class LoginRequest(BaseModel):
    email: str
    password: str


class AdminOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    display_name: str | None
    role: AdminRole


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    admin: AdminOut
