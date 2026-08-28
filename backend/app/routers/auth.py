"""
routers/auth.py — ล็อกอินแอดมิน (Scope 6.1, T27)

ออก JWT ตอน login แล้วให้ frontend แนบ `Authorization: Bearer <token>` ต่อ request อื่น
get_current_admin ไว้เป็น dependency ให้ router อื่น (documents/chat จัดการ) มา Depends() คุ้มกันได้ทีหลัง
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.security import create_access_token, decode_access_token, verify_password
from app.database import get_db
from app.models.admin import AdminUser
from app.schemas.auth import AdminOut, LoginRequest, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])
_bearer_scheme = HTTPBearer(auto_error=False)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    admin = db.scalar(select(AdminUser).where(AdminUser.email == payload.email))
    if admin is None or not admin.is_active or not verify_password(payload.password, admin.hashed_password):
        # ข้อความเดียวกันทั้งสองเคส (ไม่มี user / รหัสผิด) กัน enumeration อีเมล
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="อีเมลหรือรหัสผ่านไม่ถูกต้อง")

    admin.last_login_at = datetime.now(timezone.utc)
    db.commit()

    token = create_access_token(subject=str(admin.id))
    return TokenResponse(access_token=token, admin=AdminOut.model_validate(admin))


def get_current_admin(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> AdminUser:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="ต้องล็อกอินก่อน")

    admin_id = decode_access_token(credentials.credentials)
    if admin_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token ไม่ถูกต้องหรือหมดอายุ")

    admin = db.get(AdminUser, int(admin_id))
    if admin is None or not admin.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="ไม่พบผู้ใช้นี้")

    return admin


@router.get("/me", response_model=AdminOut)
def me(admin: AdminUser = Depends(get_current_admin)) -> AdminOut:
    return AdminOut.model_validate(admin)
