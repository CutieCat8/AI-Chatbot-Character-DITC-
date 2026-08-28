"""
scripts/create_admin.py — สร้าง/รีเซ็ตรหัสผ่านแอดมิน (รันครั้งเดียวตอน setup หรือลืมรหัสผ่าน)

ใช้:
    python -m app.scripts.create_admin <email> <password> [display_name]
"""
import sys

from app.auth.security import hash_password
from app.database import SessionLocal
from app.models.admin import AdminUser


def main() -> None:
    if len(sys.argv) < 3:
        print("ใช้: python -m app.scripts.create_admin <email> <password> [display_name]")
        raise SystemExit(1)

    email, password = sys.argv[1], sys.argv[2]
    display_name = sys.argv[3] if len(sys.argv) > 3 else None

    db = SessionLocal()
    try:
        admin = db.query(AdminUser).filter(AdminUser.email == email).one_or_none()
        if admin is None:
            admin = AdminUser(email=email, hashed_password=hash_password(password), display_name=display_name)
            db.add(admin)
            print(f"สร้างแอดมินใหม่: {email}")
        else:
            admin.hashed_password = hash_password(password)
            if display_name:
                admin.display_name = display_name
            print(f"อัปเดตรหัสผ่านแอดมิน: {email}")
        db.commit()
    finally:
        db.close()


if __name__ == "__main__":
    main()
