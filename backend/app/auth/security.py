"""
auth/security.py — hash รหัสผ่าน + สร้าง/ตรวจ JWT สำหรับล็อกอินแอดมิน (Scope 6.1, T27)
"""
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.config import settings

# ใช้ bcrypt ตรง ๆ แทน passlib.CryptContext — passlib 1.7.4 เช็ก backend ด้วยการ
# hash ทดสอบตอน import ครั้งแรก (detect_wrap_bug) ซึ่งพังกับ bcrypt>=4.1 (ValueError
# "password cannot be longer than 72 bytes" ทั้งที่รหัสผ่านสั้น) เป็นบั๊ก compat ที่รู้จักแล้ว


def hash_password(plain_password: str) -> str:
    return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def create_access_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> str | None:
    """คืน subject (admin id เป็น string) ถ้า token ใช้ได้ ไม่งั้นคืน None"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return None
    return payload.get("sub")
