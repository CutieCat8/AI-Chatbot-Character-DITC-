# ============================================================
# DITC CAT — Backend (FastAPI) Dockerfile
# ============================================================
FROM python:3.13-slim

# ตั้งค่าพื้นฐาน: ไม่สร้าง .pyc, log ออกทันที (ไม่ buffer)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# ติดตั้ง dependency ก่อน copy โค้ด (ใช้ layer cache ได้ดีกว่า)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# copy โค้ดทั้งหมด
COPY . .

EXPOSE 8000

# ค่า default (docker-compose จะ override เป็นโหมด --reload ตอน dev)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
