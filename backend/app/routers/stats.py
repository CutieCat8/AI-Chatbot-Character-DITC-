"""
routers/stats.py — Conversation Stats API (Scope 6.3) สำหรับหน้าแดชบอร์ดสถิติหัวข้อบทสนทนา

ต่างจาก routers/documents.py กับ routers/chat.py (ที่ยังเปิดโล่งไม่มี auth ตาม comment ในไฟล์นั้น ๆ
เอง — "T27 ยังไม่ทำ") — endpoint นี้ผูก get_current_admin ไว้ตั้งแต่แรกตามที่ผู้ว่าจ้างสั่งชัดเจน
ว่า "อย่าเปิดโล่ง" (ต่อให้ endpoint อื่นในระบบยังไม่มี auth ก็ตาม) ใช้ dependency ตัวเดียวกับที่
routers/auth.py เตรียมไว้ให้ router อื่นมาคุ้มกันได้ (ยังไม่มีใครใช้จริงมาก่อนไฟล์นี้)
"""
from __future__ import annotations

from collections import Counter
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.admin import AdminUser
from app.models.conversation import ConversationSession
from app.models.enums import SessionStatus, Topic
from app.routers.auth import get_current_admin
from app.schemas.stats import ConversationStatsOut, DailyConversationCountOut, TopicCountOut
from app.services.topic_classifier import TOPIC_LABELS

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/conversations", response_model=ConversationStatsOut)
def conversation_stats(
    start: date = Query(..., description="วันเริ่ม (inclusive) — ไม่มีค่าเริ่มต้น ต้องระบุเสมอ"),
    end: date = Query(..., description="วันสิ้นสุด (inclusive) — ไม่มีค่าเริ่มต้น ต้องระบุเสมอ"),
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(get_current_admin),
) -> ConversationStatsOut:
    if start > end:
        raise HTTPException(status_code=422, detail="start ต้องไม่มากกว่า end")

    # ขอบเขตวันแบบ UTC ทั้งวัน (00:00:00 ถึง 23:59:59.999999) — เหมือนที่ documents.py:sync_status
    # ใช้ UTC สำหรับ "today" อยู่แล้ว (ไม่ได้แปลงเป็นเวลาไทย) ทำตามรูปแบบเดิมของโปรเจกต์ ไม่เพิ่ม
    # ความซับซ้อนเรื่อง timezone ใหม่ — ถ้าต้องการความแม่นยำระดับวันตามเวลาไทยจริง ต้องแก้จุดนี้
    start_dt = datetime.combine(start, time.min, tzinfo=timezone.utc)
    end_dt = datetime.combine(end, time.max, tzinfo=timezone.utc)

    base_filter = (ConversationSession.started_at >= start_dt) & (ConversationSession.started_at <= end_dt)
    non_noise_filter = base_filter & (ConversationSession.status != SessionStatus.NOISE)

    total_conversations = (
        db.scalar(select(func.count()).select_from(ConversationSession).where(non_noise_filter)) or 0
    )
    noise_count = (
        db.scalar(
            select(func.count())
            .select_from(ConversationSession)
            .where(base_filter & (ConversationSession.status == SessionStatus.NOISE))
        )
        or 0
    )
    # tags IS NULL คือสัญญาณเดียวที่บอกว่า classify ยังไม่สำเร็จ (ยังไม่ทำงานจบ/ล้มเหลว/ไม่มีสัญญาณ
    # ให้ classify เลย) — ห้ามใช้ status เพราะ session_tracker.py ตั้ง status="unclassified" ไว้คงที่
    # ตลอดไปทุก session (classifier ไม่แตะ status เลย ดู schemas/stats.py:ConversationStatsOut)
    unclassified_count = (
        db.scalar(
            select(func.count())
            .select_from(ConversationSession)
            .where(non_noise_filter & ConversationSession.tags.is_(None))
        )
        or 0
    )
    # ConversationSession.tags ประกาศเป็น sqlalchemy.ARRAY แบบ generic (ไม่ใช่
    # sqlalchemy.dialects.postgresql.ARRAY) — .contains() ของ ARRAY generic ไม่รองรับ (raise
    # NotImplementedError) ใช้ array_position() ของ Postgres ตรง ๆ แทน (คืน NULL ถ้าไม่เจอ)
    other_count = (
        db.scalar(
            select(func.count())
            .select_from(ConversationSession)
            .where(
                non_noise_filter
                & func.array_position(ConversationSession.tags, Topic.OTHER.value).is_not(None)
            )
        )
        or 0
    )

    # แนวโน้มรายวัน — group by วันที่ (UTC) ของ started_at แล้วเติมวันที่ไม่มีบทสนทนาเลยด้วย 0 กันกราฟ
    # เส้นขาดช่วง (frontend คาดหวังจุดข้อมูลครบทุกวันในช่วงที่เลือก)
    daily_rows = db.execute(
        select(func.date(ConversationSession.started_at).label("day"), func.count())
        .where(non_noise_filter)
        .group_by("day")
    ).all()
    counts_by_day: dict[date, int] = {row.day: row[1] for row in daily_rows}
    daily_counts = [
        DailyConversationCountOut(date=d, count=counts_by_day.get(d, 0))
        for d in _date_range(start, end)
    ]

    # หัวข้อยอดนิยม — นับจาก tags array ของทุก session ในช่วง (unnest ทำใน Python เพราะจำนวน session
    # ของตู้เดียวต่อวันไม่มากพอที่จะต้องใช้ SQL unnest ให้ซับซ้อนขึ้นโดยไม่จำเป็น)
    tags_rows = db.scalars(
        select(ConversationSession.tags).where(non_noise_filter & ConversationSession.tags.is_not(None))
    ).all()
    topic_counter: Counter[str] = Counter()
    for tags in tags_rows:
        topic_counter.update(tags)
    top_topics = [
        TopicCountOut(topic=Topic(value), label=TOPIC_LABELS.get(Topic(value), value), count=count)
        for value, count in topic_counter.most_common()
    ]

    return ConversationStatsOut(
        start_date=start,
        end_date=end,
        total_conversations=total_conversations,
        noise_count=noise_count,
        unclassified_count=unclassified_count,
        other_count=other_count,
        daily_counts=daily_counts,
        top_topics=top_topics,
    )


def _date_range(start: date, end: date) -> list[date]:
    days = (end - start).days
    return [start + timedelta(days=i) for i in range(days + 1)]
