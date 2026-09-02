"""
spike_gemini_live.py — สปาย์คทดสอบสมมติฐานที่ยังไม่พิสูจน์ก่อนลงมือสร้าง voice pipeline จริง

พิสูจน์ 3 อย่างในไฟล์เดียว:
  (ก) Gemini Live คุยภาษาไทยลื่นพอไหม
  (ข) เรียก function calling เข้า retrieval.py เดิมได้จริงกลางบทสนทนาไหม
  (ค) latency (ยิงคำถาม → ได้คำตอบ) เท่าไหร่

หมายเหตุจากการดีบัก: model ที่ key นี้เรียกได้ตอนนี้เป็นรุ่น native-audio ล้วน (เช็คจริงด้วย
client.models.list() แล้ว TEXT modality ใช้ไม่ได้กับรุ่นที่มี) ต้องใช้ response_modalities=AUDIO
+ output_audio_transcription เพื่อได้ text มาวัดผลแทนการฟังเสียงจริง
และต้องส่ง config/tool เป็น typed object (types.LiveConnectConfig ฯลฯ) ไม่ใช่ raw dict
เพราะ raw dict บาง field (เช่น output_audio_transcription={}) ทำให้ server ปฏิเสธ request

รัน: cd backend && .venv/Scripts/python -m app.scripts.spike_gemini_live "คำถาม"
ผลลัพธ์เขียนเป็น UTF-8 ไปที่ spike_result.txt (เลี่ยงปัญหา terminal Windows พิมพ์ไทยไม่ได้)
"""
from __future__ import annotations

import asyncio
import sys
import time

from google import genai
from google.genai import types

from app.config import settings
from app.database import SessionLocal
from app.rag.retrieval import keyword_search, search
from app.rag.embedding import get_embedder

MODEL = "gemini-3.1-flash-live-preview"

SYSTEM_INSTRUCTION = (
    "คุณคือ DITC CAT ผู้ช่วยตอบคำถามของศูนย์ DITC และคณะ CAMT มหาวิทยาลัยเชียงใหม่เท่านั้น "
    "หมายเหตุ: ถ้าได้ยินคำว่า \"ITC\" \"ดิติซี\" หรือ \"ดีไอทีซี\" ให้เข้าใจว่าหมายถึง \"DITC\" เสมอ "
    "(STT มักถอดเสียง D ตัวแรกของ DITC หายไป) "
    "กำลังคุยด้วยเสียงกับคนที่ยืนอยู่ตรงหน้า ตอบสั้น กระชับ 1-3 ประโยค เหมือนคนคุยกันจริง ๆ "
    "ห้ามใช้ bullet หรือเลขข้อ เพราะข้อความนี้จะถูกอ่านออกเสียง "
    "ทุกคำถามที่เกี่ยวกับ CAMT/DITC ต้องเรียกใช้ tool search_camt_knowledge_base ก่อนเสมอ "
    "ห้ามตอบจากความรู้ทั่วไปของคุณเอง ให้ตอบจากผลที่ tool คืนมาเท่านั้น"
)

SEARCH_FUNCTION = types.FunctionDeclaration(
    name="search_camt_knowledge_base",
    description=(
        "ค้นข้อมูลหลักสูตร ข่าวสาร ค่าเทอม คุณสมบัติผู้สมัคร ฯลฯ ของศูนย์ DITC และคณะ CAMT "
        "มหาวิทยาลัยเชียงใหม่ จากฐานความรู้จริงที่เก็บไว้ ต้องเรียกก่อนตอบคำถามที่เกี่ยวกับ CAMT/DITC เสมอ"
    ),
    parameters=types.Schema(
        type=types.Type.OBJECT,
        properties={
            "query": types.Schema(type=types.Type.STRING, description="คำค้นภาษาไทย สั้น กระชับ ตรงประเด็น"),
        },
        required=["query"],
    ),
)


def run_retrieval(query: str) -> str:
    """ใช้ retrieval.py เดิม (เหมือนที่ routers/chat.py ใช้) — พิสูจน์ข้อ (ข)"""
    db = SessionLocal()
    try:
        keyword_results = keyword_search(db, query, top_k=6, max_per_document=2)
        vector_results = search(db, query, top_k=4, embedder=get_embedder())
        seen: set[int] = set()
        results = []
        for r in [*keyword_results, *vector_results]:
            if r.chunk_id not in seen:
                seen.add(r.chunk_id)
                results.append(r)
        results = results[:6]
        if not results:
            return "ไม่พบข้อมูลที่เกี่ยวข้องในฐานความรู้"
        return "\n\n".join(
            f"[{r.document_title or r.source_url}]\n{r.content}" for r in results
        )
    finally:
        db.close()


async def main(question: str) -> list[str]:
    log: list[str] = []

    def out(line: str) -> None:
        log.append(line)

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    config = types.LiveConnectConfig(
        response_modalities=["AUDIO"],
        output_audio_transcription=types.AudioTranscriptionConfig(),
        system_instruction=SYSTEM_INSTRUCTION,
        tools=[types.Tool(function_declarations=[SEARCH_FUNCTION])],
    )

    out(f"[คำถาม] {question}")
    t0 = time.time()
    tool_call_at: float | None = None
    tool_result_at: float | None = None
    first_text_at: float | None = None

    async with client.aio.live.connect(model=MODEL, config=config) as session:
        await session.send_client_content(
            turns={"role": "user", "parts": [{"text": question}]}, turn_complete=True
        )

        full_answer = ""
        async for response in session.receive():
            if response.tool_call:
                tool_call_at = time.time()
                out(f"[+{tool_call_at - t0:.2f}s] เรียก tool แล้ว:")
                function_responses = []
                for fc in response.tool_call.function_calls:
                    q = fc.args.get("query", question)
                    out(f"    query = {q!r}")
                    result_text = run_retrieval(q)
                    function_responses.append(
                        types.FunctionResponse(id=fc.id, name=fc.name, response={"result": result_text})
                    )
                tool_result_at = time.time()
                out(f"[+{tool_result_at - t0:.2f}s] retrieval เสร็จ ({tool_result_at - tool_call_at:.2f}s) ส่งกลับให้ Gemini")
                await session.send_tool_response(function_responses=function_responses)

            transcript_piece = None
            if response.server_content and response.server_content.output_transcription:
                transcript_piece = response.server_content.output_transcription.text
            if transcript_piece:
                if first_text_at is None:
                    first_text_at = time.time()
                    out(f"[+{first_text_at - t0:.2f}s] เริ่มได้คำตอบ (first audio transcript chunk)")
                full_answer += transcript_piece

            if response.server_content and response.server_content.turn_complete:
                break

    t1 = time.time()
    out(f"\n[คำตอบ] {full_answer}")
    out(f"\n[สรุปเวลา] รวมทั้งหมด {t1 - t0:.2f}s")
    if tool_call_at:
        out(f"  - ก่อนเรียก tool: {tool_call_at - t0:.2f}s")
        out(f"  - retrieval (DB จริง): {tool_result_at - tool_call_at:.2f}s")
        out(f"  - หลังส่งผล tool กลับจนตอบเสร็จ: {t1 - tool_result_at:.2f}s")
    else:
        out("  - ไม่มีการเรียก tool เลย (ผิดคาด — เช็ค system_instruction/tool schema)")

    return log


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "อยากเรียนเป็น dev อยากเข้า CAMT ควรเรียนสาขาไหน"
    lines = asyncio.run(main(q))
    with open("spike_result.txt", "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("done -> spike_result.txt")
