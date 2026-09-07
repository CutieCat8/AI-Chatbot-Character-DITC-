import { useEffect, useRef, useState } from "react";
import { Sparkles, Send, Globe, ExternalLink, Cat, User, Loader2 } from "lucide-react";
import { askChat, MAX_HISTORY_TURNS, type ChatSourceOut, type ChatTurn } from "../../lib/api";

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  sources?: ChatSourceOut[];
}

const SITE_LABEL: Record<ChatSourceOut["source_site"], string> = {
  ditc: "DITC",
  camt: "CAMT",
  manual: "Manual",
};

/**
 * แปลงรายการข้อความบนจอเป็นคู่ (คำถาม, คำตอบ) ให้ backend
 * เอาเฉพาะคู่ที่ผู้ใช้ถามแล้วบอทตอบต่อทันที — ข้อความต้อนรับที่ไม่มีคำถามคู่กัน
 * และข้อความ error จะไม่ถูกนับเป็นเทิร์น
 */
function buildHistory(messages: Message[]): ChatTurn[] {
  const turns: ChatTurn[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === "user" && messages[i + 1].role === "assistant") {
      turns.push({ question: messages[i].text, answer: messages[i + 1].text });
    }
  }
  return turns.slice(-MAX_HISTORY_TURNS);
}

const STARTER_PROMPTS = [
  "สาขา DII ในคณะ CAMT คืออะไร",
  "ห้องแลบมีอะไรให้ใช้บ้าง",
  "ข่าวล่าสุดของ DITC มีอะไรบ้าง",
];

const WELCOME_MESSAGE: Message = {
  id: "welcome",
  role: "assistant",
  text: "สวัสดีค่ะ ดิฉันคือ DITC CAT ผู้ช่วยตอบคำถามเกี่ยวกับศูนย์ DITC และคณะ CAMT ลองถามอะไรก็ได้เลยค่ะ",
};

// เก็บใน sessionStorage (ไม่ใช่ state เฉย ๆ) เพื่อให้แชทไม่หายตอนสลับไปหน้าอื่นแล้วกลับมา
// อยู่จนกว่าจะปิดแท็บ/ปิดเบราว์เซอร์ถึงจะหาย (ตามที่ขอ) ต่างจาก localStorage ที่อยู่ข้ามวัน
const MESSAGES_KEY = "ditc-cat-chat-messages";
const ACTIVE_SOURCE_KEY = "ditc-cat-chat-active-source";

function loadMessages(): Message[] {
  try {
    const raw = sessionStorage.getItem(MESSAGES_KEY);
    if (raw) return JSON.parse(raw) as Message[];
  } catch {
    // ข้อมูลเสีย/parse ไม่ได้ → เริ่มใหม่
  }
  return [WELCOME_MESSAGE];
}

function loadActiveSource(): ChatSourceOut | null {
  try {
    const raw = sessionStorage.getItem(ACTIVE_SOURCE_KEY);
    if (raw) return JSON.parse(raw) as ChatSourceOut;
  } catch {
    // ignore
  }
  return null;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeSource, setActiveSource] = useState<ChatSourceOut | null>(loadActiveSource);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    sessionStorage.setItem(MESSAGES_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    if (activeSource) {
      sessionStorage.setItem(ACTIVE_SOURCE_KEY, JSON.stringify(activeSource));
    } else {
      sessionStorage.removeItem(ACTIVE_SOURCE_KEY);
    }
  }, [activeSource]);

  const send = async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;

    // จับคู่ถาม-ตอบที่ผ่านมาส่งไปด้วย เพื่อให้คำถามต่อเนื่องที่ไม่ครบใจความ ("แล้วค่าเทอมล่ะ")
    // รู้ว่ากำลังพูดถึงหลักสูตรไหนอยู่ — ข้าม WELCOME_MESSAGE ที่ไม่มีคำถามคู่กัน
    const history = buildHistory(messages);

    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", text: q }]);
    setInput("");
    setLoading(true);

    try {
      const res = await askChat(q, history);
      setMessages((m) => [
        ...m,
        { id: crypto.randomUUID(), role: "assistant", text: res.answer, sources: res.sources },
      ]);
      if (res.sources.length > 0) setActiveSource(res.sources[0]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `เชื่อมต่อ AI ไม่สำเร็จ: ${err instanceof Error ? err.message : "unknown error"}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex min-h-0 bg-gray-50">
      {/* Left — chat */}
      <div className="w-[440px] shrink-0 flex flex-col border-r border-gray-100 bg-white">
        {/* header */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center shrink-0">
            <Cat size={16} className="text-white" />
          </div>
          <div>
            <p className="text-gray-900" style={{ fontSize: "0.85rem", fontWeight: 600 }}>DITC CAT</p>
            <p className="text-gray-400 flex items-center gap-1" style={{ fontSize: "0.68rem" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              deepseek-v4-pro · RAG demo
            </p>
          </div>
        </div>

        {/* messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-4">
          {messages.map((m) => (
            <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
              <div
                className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 mt-0.5 ${
                  m.role === "user" ? "bg-gray-100" : "bg-gray-900"
                }`}
              >
                {m.role === "user" ? <User size={12} className="text-gray-500" /> : <Sparkles size={12} className="text-white" />}
              </div>
              <div className={`flex flex-col gap-1.5 max-w-[85%] ${m.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`px-3.5 py-2.5 rounded-2xl whitespace-pre-wrap ${
                    m.role === "user"
                      ? "bg-gray-900 text-white rounded-tr-sm"
                      : "bg-gray-50 border border-gray-100 text-gray-700 rounded-tl-sm"
                  }`}
                  style={{ fontSize: "0.82rem", lineHeight: 1.6 }}
                >
                  {m.text}
                </div>

                {m.sources && m.sources.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {m.sources.map((s) => (
                      <button
                        key={s.document_id}
                        onClick={() => setActiveSource(s)}
                        className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-colors ${
                          activeSource?.document_id === s.document_id
                            ? "border-sky-200 bg-sky-50 text-sky-600"
                            : "border-gray-100 bg-gray-50 text-gray-400 hover:text-gray-700 hover:border-gray-200"
                        }`}
                        style={{ fontSize: "0.66rem" }}
                      >
                        <Globe size={10} />
                        {SITE_LABEL[s.source_site]} · {(s.title ?? s.url).slice(0, 22)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-md bg-gray-900 flex items-center justify-center shrink-0">
                <Loader2 size={12} className="text-white animate-spin" />
              </div>
              <div className="px-3.5 py-2.5 rounded-2xl rounded-tl-sm bg-gray-50 border border-gray-100 text-gray-400" style={{ fontSize: "0.82rem" }}>
                กำลังค้น Knowledge Base + คิดคำตอบ...
              </div>
            </div>
          )}

          {messages.length === 1 && !loading && (
            <div className="flex flex-col gap-1.5 mt-2">
              {STARTER_PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => send(p)}
                  className="text-left px-3 py-2 rounded-lg border border-gray-100 bg-gray-50 hover:bg-gray-100 hover:border-gray-200 text-gray-500 hover:text-gray-800 transition-colors"
                  style={{ fontSize: "0.76rem" }}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* input */}
        <div className="p-3 border-t border-gray-100">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 bg-gray-50 border border-gray-200 focus-within:border-gray-400 focus-within:ring-2 focus-within:ring-gray-100 rounded-xl px-3 py-2 transition-all"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="ถามอะไรก็ได้เกี่ยวกับ CAMT / DITC..."
              disabled={loading}
              className="flex-1 bg-transparent outline-none text-gray-800 placeholder-gray-400"
              style={{ fontSize: "0.82rem" }}
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="w-7 h-7 rounded-lg bg-gray-900 hover:bg-gray-700 disabled:opacity-30 flex items-center justify-center shrink-0 transition-colors"
            >
              <Send size={13} className="text-white" />
            </button>
          </form>
        </div>
      </div>

      {/* Right — live site preview */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* fake browser chrome */}
        <div className="h-11 shrink-0 bg-white border-b border-gray-100 flex items-center gap-3 px-4">
          <div className="flex gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-gray-100" />
            <span className="w-2.5 h-2.5 rounded-full bg-gray-100" />
            <span className="w-2.5 h-2.5 rounded-full bg-gray-100" />
          </div>
          <div className="flex-1 flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5 min-w-0">
            <Globe size={12} className="text-gray-300 shrink-0" />
            <span className="text-gray-500 truncate" style={{ fontSize: "0.75rem" }}>
              {activeSource ? activeSource.url : "เว็บอ้างอิงจะแสดงที่นี่หลัง AI ตอบ"}
            </span>
          </div>
          {activeSource && (
            <a
              href={activeSource.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-gray-400 hover:text-gray-800 transition-colors shrink-0"
              style={{ fontSize: "0.72rem" }}
            >
              <ExternalLink size={12} />
              เปิดแท็บใหม่
            </a>
          )}
        </div>

        <div className="flex-1 bg-white relative">
          {activeSource ? (
            <iframe key={activeSource.url} src={activeSource.url} title="source preview" className="w-full h-full border-0" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-300 bg-gray-50">
              <Globe size={28} className="text-gray-200" />
              <p style={{ fontSize: "0.82rem" }} className="text-gray-300">
                ยังไม่มีเว็บอ้างอิง — ลองถามคำถามด้านซ้ายก่อน
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
