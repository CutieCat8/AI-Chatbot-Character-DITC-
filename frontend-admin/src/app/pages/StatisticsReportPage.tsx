import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Printer } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { getConversationStats, type ConversationStatsOut, type DailyConversationCountOut } from "../../lib/api";
import logo from "../../assets/logo.png";
import { ANSWER_STATUS_COLORS } from "../components/stats/chartPalette";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function formatShortDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year.slice(-2)}`;
}

function number(value: number): string {
  return value.toLocaleString("th-TH");
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

interface TrendReportChartProps {
  points: DailyConversationCountOut[];
  sharedCeiling?: number;
  globalPeak?: number;
  compact?: boolean;
}

function TrendReportChart({ points, sharedCeiling, globalPeak, compact = false }: TrendReportChartProps) {
  if (points.length === 0) {
    return <div className="report-empty-chart">ไม่มีข้อมูลแนวโน้มในช่วงนี้</div>;
  }
  if (points.length > 31) {
    const chunks: DailyConversationCountOut[][] = [];
    for (let index = 0; index < points.length; index += 31) chunks.push(points.slice(index, index + 31));
    const peak = Math.max(1, ...points.map((point) => point.count));
    const ceiling = Math.max(5, Math.ceil(peak / 5) * 5);
    return (
      <div className="report-trend-multi">
        {chunks.map((chunk) => (
          <TrendReportChart
            key={chunk[0].date}
            points={chunk}
            sharedCeiling={ceiling}
            globalPeak={peak}
            compact
          />
        ))}
      </div>
    );
  }

  const width = 720;
  const height = compact ? 160 : 248;
  const left = 38;
  const right = 14;
  const top = compact ? 21 : 29;
  const bottom = compact ? 31 : 42;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const maxValue = Math.max(1, ...points.map((point) => point.count));
  const ceiling = sharedCeiling ?? Math.max(5, Math.ceil(maxValue / 5) * 5);
  const slot = chartWidth / points.length;
  const gap = Math.min(7, Math.max(1, slot * 0.2));
  const barWidth = Math.max(2, slot - gap);
  const countFontSize = compact ? 8 : points.length > 14 ? 8 : 10;
  const labelStep = Math.max(1, Math.ceil(points.length / 10));
  const gridValues = [0, Math.round(ceiling / 2), ceiling];

  return (
    <svg className="report-trend-svg" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="แนวโน้มจำนวนบทสนทนารายวัน">
      {gridValues.map((value) => {
        const y = top + chartHeight - (value / ceiling) * chartHeight;
        return (
          <g key={value}>
            <line x1={left} y1={y} x2={width - right} y2={y} stroke="#e5e7eb" strokeDasharray={value === 0 ? undefined : "3 4"} />
            <text x={left - 7} y={y + 3} textAnchor="end" fill="#9ca3af" fontSize="9">
              {number(value)}
            </text>
          </g>
        );
      })}

      {points.map((point, index) => {
        const barHeight = (point.count / ceiling) * chartHeight;
        const x = left + index * slot + (slot - barWidth) / 2;
        const y = top + chartHeight - barHeight;
        const showDate = index === 0 || index === points.length - 1 || index % labelStep === 0;
        const isPeak = point.count === (globalPeak ?? maxValue);
        return (
          <g key={point.date}>
            <rect
              x={x}
              y={y}
              width={barWidth}
              height={Math.max(1, barHeight)}
              rx={Math.min(3, barWidth / 2)}
              fill={isPeak ? "#111827" : "#9ca3af"}
            >
              <title>{formatDate(point.date)}: {number(point.count)} บทสนทนา</title>
            </rect>
            <text
              x={x + barWidth / 2}
              y={Math.max(10, y - 5)}
              textAnchor="middle"
              fill={isPeak ? "#111827" : "#4b5563"}
              fontSize={countFontSize}
              fontWeight="700"
            >
              {number(point.count)}
            </text>
            {showDate && (
              <text x={x + barWidth / 2} y={height - 16} textAnchor="middle" fill="#6b7280" fontSize="8.5">
                {formatShortDate(point.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function ReportHeader({ stats, generatedAt }: { stats: ConversationStatsOut; generatedAt: string }) {
  return (
    <header className="report-document-header">
      <div className="report-brand">
        <img src={logo} alt="DITC CAT" />
        <div>
          <div className="report-brand-name">DITC CAT</div>
          <div className="report-brand-subtitle">Conversation Analytics Report</div>
        </div>
      </div>
      <div className="report-meta">
        <div>ช่วงข้อมูล <strong>{formatDate(stats.start_date)} – {formatDate(stats.end_date)}</strong></div>
        <div>สร้างเมื่อ <strong>{generatedAt}</strong></div>
        <div>ประเภท <strong>รายงานสรุปสถิติ</strong></div>
      </div>
    </header>
  );
}

function ReportFooter({ stats, page }: { stats: ConversationStatsOut; page: number }) {
  return (
    <footer className="report-document-footer">
      <span>DITC CAT · รายงานสถิติแบบสรุป ไม่มีข้อความบทสนทนาดิบ</span>
      <span>{formatDate(stats.start_date)} – {formatDate(stats.end_date)} · หน้า {page}/2</span>
    </footer>
  );
}

function ReportDocument({ stats }: { stats: ConversationStatsOut }) {
  const generatedAt = useMemo(
    () =>
      new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date()),
    [],
  );
  const grandTotal = stats.total_conversations + stats.noise_count;
  const quality = percent(stats.total_conversations, grandTotal);
  const classifiedTotal = stats.answered_count + stats.off_topic_only_count + stats.greeting_only_count;
  const topicTotal = stats.top_topics.reduce((sum, topic) => sum + topic.count, 0);
  const topicMax = Math.max(1, ...stats.top_topics.map((topic) => topic.count));
  const peak = stats.daily_counts.reduce<DailyConversationCountOut | null>(
    (best, item) => (!best || item.count > best.count ? item : best),
    null,
  );
  const dailyAverage = stats.daily_counts.length
    ? Math.round(stats.daily_counts.reduce((sum, item) => sum + item.count, 0) / stats.daily_counts.length)
    : 0;
  const statusRows = [
    { label: "ตอบได้จากฐานความรู้", count: stats.answered_count, color: ANSWER_STATUS_COLORS.answered },
    { label: "ถามนอกขอบเขต", count: stats.off_topic_only_count, color: ANSWER_STATUS_COLORS.offTopic },
    { label: "ทักทาย/คุยเล่นอย่างเดียว", count: stats.greeting_only_count, color: ANSWER_STATUS_COLORS.greeting },
  ];

  return (
    <div className="statistics-report-document">
      <article className="statistics-report-paper">
        <ReportHeader stats={stats} generatedAt={generatedAt} />

        <div className="report-title-block">
          <div className="report-kicker">ภาพรวมการใช้งาน</div>
          <h1>รายงานสถิติบทสนทนา</h1>
          <p>สรุปปริมาณการใช้งาน แนวโน้มรายวัน และประสิทธิภาพการตอบคำถามของผู้ช่วย DITC CAT</p>
        </div>

        <section className="report-kpi-grid">
          <div className="report-kpi report-kpi-primary"><span>บทสนทนาทั้งหมด</span><strong>{number(stats.total_conversations)}</strong><small>บทสนทนาที่มีคำถามจริง</small></div>
          <div className="report-kpi"><span>ตอบได้จากฐานความรู้</span><strong>{number(stats.answered_count)}</strong><small>{percent(stats.answered_count, classifiedTotal)}% ของบทสนทนา</small></div>
          <div className="report-kpi"><span>ยังไม่จัดหมวด</span><strong>{number(stats.unclassified_count)}</strong><small>รายการที่ควรตรวจสอบ</small></div>
          <div className="report-kpi"><span>คุณภาพสัญญาณ</span><strong>{quality}%</strong><small>คำถามจริงเทียบเหตุการณ์ทั้งหมด</small></div>
        </section>

        <section className="report-section">
          <div className="report-section-heading">
            <div><span>01</span><h2>แนวโน้มจำนวนบทสนทนาย้อนหลัง</h2></div>
            <p>ตัวเลขเหนือแท่งคือจำนวนบทสนทนาในแต่ละวัน</p>
          </div>
          <div className="report-chart-panel">
            <TrendReportChart points={stats.daily_counts} />
          </div>
          <div className="report-insight-row">
            <div><span>วันที่สูงสุด</span><strong>{peak ? formatDate(peak.date) : "–"}</strong><small>{peak ? `${number(peak.count)} บทสนทนา` : "ไม่มีข้อมูล"}</small></div>
            <div><span>เฉลี่ยต่อวัน</span><strong>{number(dailyAverage)}</strong><small>บทสนทนา/วัน</small></div>
            <div><span>เงียบหรือเสียงรบกวน</span><strong>{number(stats.noise_count)}</strong><small>{percent(stats.noise_count, grandTotal)}% ของเหตุการณ์ทั้งหมด</small></div>
          </div>
        </section>

        <section className="report-section report-status-section">
          <div className="report-section-heading">
            <div><span>02</span><h2>ผลลัพธ์การสนทนา</h2></div>
            <p>แยกตามผลลัพธ์หลักที่ไม่ซ้ำกัน</p>
          </div>
          <div className="report-status-list">
            {statusRows.map((row) => {
              const pct = percent(row.count, classifiedTotal);
              return (
                <div className="report-status-row" key={row.label}>
                  <div className="report-status-label"><i style={{ background: row.color }} /><span>{row.label}</span></div>
                  <div className="report-progress"><i style={{ width: `${pct}%`, background: row.color }} /></div>
                  <strong>{number(row.count)}</strong>
                  <span>{pct}%</span>
                </div>
              );
            })}
          </div>
        </section>

        <div className="report-privacy-note"><strong>PDPA</strong><span>รายงานนี้ใช้เฉพาะข้อมูลสถิติแบบสรุป ไม่มีข้อความบทสนทนาดิบหรือข้อมูลที่ใช้ระบุตัวบุคคล</span></div>
        <ReportFooter stats={stats} page={1} />
      </article>

      <article className="statistics-report-paper">
        <ReportHeader stats={stats} generatedAt={generatedAt} />

        <div className="report-title-block report-title-block-compact">
          <div className="report-kicker">รายละเอียดหัวข้อ</div>
          <h1>สถิติหัวข้อทั้งหมด</h1>
          <p>แสดงทุกหัวข้อที่ถูกจัดหมวด เรียงจากจำนวนครั้งมากไปน้อยโดยไม่มีการตัดรายการ</p>
        </div>

        <div className="report-topic-summary">
          <div><span>จำนวนหัวข้อที่พบ</span><strong>{number(stats.top_topics.length)}</strong><small>หัวข้อ</small></div>
          <div><span>จำนวนครั้งที่ติดแท็ก</span><strong>{number(topicTotal)}</strong><small>หนึ่งบทสนทนาอาจมีหลายแท็ก</small></div>
          <div><span>หัวข้ออันดับหนึ่ง</span><strong>{stats.top_topics[0]?.label ?? "–"}</strong><small>{stats.top_topics[0] ? `${number(stats.top_topics[0].count)} ครั้ง` : "ไม่มีข้อมูล"}</small></div>
        </div>

        <section className="report-section report-topic-section">
          <table className="report-topic-table">
            <thead><tr><th>อันดับ</th><th>หัวข้อ</th><th>สัดส่วนเทียบหัวข้อสูงสุด</th><th className="report-num">จำนวน</th><th className="report-num">สัดส่วน</th></tr></thead>
            <tbody>
              {stats.top_topics.length === 0 ? (
                <tr><td colSpan={5} className="report-empty-cell">ไม่มีหัวข้อที่ถูกจัดหมวดในช่วงนี้</td></tr>
              ) : (
                stats.top_topics.map((topic, index) => (
                  <tr key={topic.topic}>
                    <td className="report-rank">{String(index + 1).padStart(2, "0")}</td>
                    <td><div className="report-topic-name"><i /><span>{topic.label}</span></div></td>
                    <td><div className="report-topic-bar"><i style={{ width: `${(topic.count / topicMax) * 100}%` }} /></div></td>
                    <td className="report-num"><strong>{number(topic.count)}</strong></td>
                    <td className="report-num">{percent(topic.count, topicTotal)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <div className="report-reading-note">
          <strong>วิธีอ่านข้อมูลและคำจำกัดความ</strong>
          <p>“จำนวนครั้งที่ติดแท็ก” อาจมากกว่าจำนวนบทสนทนา เพราะหนึ่งบทสนทนาสามารถเกี่ยวข้องกับหัวข้อได้มากกว่าหนึ่งหัวข้อ</p>
          <p><b>ยังไม่จัดหมวด</b> คือบทสนทนาจริงที่ยังไม่มีแท็ก · <b>อื่น ๆ</b> คือจัดหมวดสำเร็จแต่ไม่ตรงกับหัวข้อที่มี · <b>เงียบ/ขยะ</b> คือพบการโต้ตอบแต่ไม่พบสัญญาณคำถามจริงและไม่นับรวมในจำนวนบทสนทนา</p>
        </div>
        <ReportFooter stats={stats} page={2} />
      </article>
    </div>
  );
}

export default function StatisticsReportPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  const [stats, setStats] = useState<ConversationStatsOut | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStats(null);
    if (!ISO_DATE.test(start) || !ISO_DATE.test(end)) {
      setError("ช่วงวันที่ในลิงก์รายงานไม่ถูกต้อง");
      return;
    }
    let cancelled = false;
    setError(null);
    getConversationStats(start, end)
      .then((result) => {
        if (!cancelled) setStats(result);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "โหลดรายงานไม่สำเร็จ");
      });
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  const printReport = () => {
    const originalTitle = document.title;
    document.title = `DITC-CAT-Report-${start}-${end}`;
    window.addEventListener("afterprint", () => (document.title = originalTitle), { once: true });
    window.print();
  };

  return (
    <main className="statistics-report-screen flex-1">
      <style>{REPORT_STYLES}</style>
      <div className="statistics-report-toolbar">
        <button type="button" className="report-toolbar-button" onClick={() => navigate("/dashboard/stats")}>
          <ArrowLeft size={15} /> กลับไปหน้าสถิติ
        </button>
        <div className="report-toolbar-title">
          <strong>ตัวอย่างรายงานสถิติบทสนทนา</strong>
          <span>{ISO_DATE.test(start) && ISO_DATE.test(end) ? `${formatDate(start)} – ${formatDate(end)}` : "DITC CAT"}</span>
        </div>
        <div className="report-toolbar-actions">
          <button type="button" className="report-toolbar-button" onClick={printReport} disabled={!stats}>
            <Printer size={15} /> พิมพ์
          </button>
          <button type="button" className="report-toolbar-button report-toolbar-primary" onClick={printReport} disabled={!stats}>
            <Download size={15} /> บันทึกเป็น PDF
          </button>
        </div>
      </div>

      <div className="statistics-report-workspace">
        {!stats && !error && <div className="report-loading">กำลังจัดทำรายงาน...</div>}
        {error && <div className="report-error">ไม่สามารถเปิดรายงานได้: {error}</div>}
        {stats && <ReportDocument stats={stats} />}
      </div>
    </main>
  );
}

const REPORT_STYLES = `
  .statistics-report-screen { min-height: calc(100vh - 3rem); background: #eef0f3; color: #1f2937; }
  .statistics-report-toolbar { position: sticky; top: 3rem; z-index: 40; display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 16px; min-height: 58px; padding: 9px 28px; border-bottom: 1px solid #dfe3e8; background: rgba(255,255,255,.96); box-shadow: 0 2px 12px rgba(17,24,39,.05); backdrop-filter: blur(12px); }
  .report-toolbar-title { display: flex; flex-direction: column; align-items: center; color: #111827; font-size: .8rem; }
  .report-toolbar-title span { margin-top: 1px; color: #9ca3af; font-size: .68rem; font-weight: 400; }
  .report-toolbar-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .report-toolbar-button { display: inline-flex; width: fit-content; align-items: center; justify-content: center; gap: 7px; border: 1px solid #d1d5db; border-radius: 8px; padding: 8px 12px; color: #4b5563; background: white; font-size: .76rem; font-weight: 600; transition: border-color .15s, background .15s, color .15s; }
  .report-toolbar-button:hover:not(:disabled) { border-color: #9ca3af; color: #111827; background: #f9fafb; }
  .report-toolbar-button:disabled { cursor: not-allowed; opacity: .45; }
  .report-toolbar-primary { border-color: #111827; color: white; background: #111827; }
  .report-toolbar-primary:hover:not(:disabled) { border-color: #374151; color: white; background: #374151; }
  .statistics-report-workspace { min-height: calc(100vh - 106px); padding: 34px 20px 64px; }
  .statistics-report-document { display: flex; flex-direction: column; align-items: center; gap: 28px; }
  .statistics-report-paper { display: flex; width: 210mm; min-height: 297mm; flex-direction: column; padding: 14mm 15mm 11mm; overflow: hidden; background: white; box-shadow: 0 18px 55px rgba(17,24,39,.12), 0 1px 2px rgba(17,24,39,.08); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .report-document-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 12px; border-bottom: 2px solid #111827; }
  .report-brand { display: flex; align-items: center; gap: 11px; }
  .report-brand img { width: 38px; height: 38px; border: 1px solid #e5e7eb; border-radius: 8px; object-fit: contain; padding: 3px; }
  .report-brand-name { color: #111827; font-size: 15px; font-weight: 800; letter-spacing: -.02em; }
  .report-brand-subtitle { margin-top: 1px; color: #9ca3af; font-size: 8.5px; }
  .report-meta { color: #6b7280; font-size: 8.5px; line-height: 1.65; text-align: right; }
  .report-meta strong { color: #374151; font-weight: 700; }
  .report-title-block { margin: 22px 0 18px; }
  .report-title-block-compact { margin-bottom: 14px; }
  .report-kicker { margin-bottom: 4px; color: #9ca3af; font-size: 8px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .report-title-block h1 { margin: 0; color: #111827; font-size: 23px; font-weight: 800; line-height: 1.2; letter-spacing: -.04em; }
  .report-title-block p { margin: 5px 0 0; color: #6b7280; font-size: 9.5px; }
  .report-kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .report-kpi { min-height: 76px; padding: 11px 12px; border: 1px solid #e5e7eb; border-radius: 9px; background: #fafafa; }
  .report-kpi span { display: block; min-height: 24px; color: #6b7280; font-size: 8.5px; font-weight: 600; line-height: 1.35; }
  .report-kpi strong { display: block; margin-top: 2px; color: #111827; font-size: 21px; font-weight: 800; line-height: 1; letter-spacing: -.035em; }
  .report-kpi small { display: block; margin-top: 6px; color: #9ca3af; font-size: 7.5px; }
  .report-kpi-primary { border-color: #111827; background: #111827; }
  .report-kpi-primary span, .report-kpi-primary strong { color: white; }
  .report-kpi-primary small { color: #9ca3af; }
  .report-section { margin-top: 18px; }
  .report-section-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 9px; }
  .report-section-heading > div { display: flex; align-items: center; gap: 8px; }
  .report-section-heading > div > span { display: grid; width: 20px; height: 20px; place-items: center; border-radius: 50%; color: white; background: #111827; font-size: 7px; font-weight: 700; }
  .report-section-heading h2 { margin: 0; color: #1f2937; font-size: 12px; font-weight: 700; }
  .report-section-heading p { margin: 0; color: #9ca3af; font-size: 7.5px; }
  .report-chart-panel { padding: 6px 8px 0; border: 1px solid #e5e7eb; border-radius: 9px; }
  .report-trend-svg { display: block; width: 100%; height: 205px; overflow: visible; }
  .report-trend-multi { display: flex; flex-direction: column; gap: 2px; }
  .report-trend-multi .report-trend-svg { height: 128px; }
  .report-empty-chart { display: grid; height: 205px; place-items: center; color: #9ca3af; font-size: 9px; }
  .report-insight-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 8px; }
  .report-insight-row > div { padding: 8px 10px; border-left: 2px solid #d1d5db; background: #f9fafb; }
  .report-insight-row span, .report-insight-row small { display: block; color: #9ca3af; font-size: 7.5px; }
  .report-insight-row strong { display: block; margin: 2px 0; color: #1f2937; font-size: 10.5px; }
  .report-status-section { margin-top: 16px; }
  .report-status-list { display: flex; flex-direction: column; gap: 8px; padding: 11px 13px; border: 1px solid #e5e7eb; border-radius: 9px; }
  .report-status-row { display: grid; grid-template-columns: 155px 1fr 42px 34px; align-items: center; gap: 10px; font-size: 8.5px; }
  .report-status-label { display: flex; align-items: center; gap: 7px; color: #4b5563; }
  .report-status-label i { width: 7px; height: 7px; border-radius: 50%; }
  .report-progress { height: 5px; overflow: hidden; border-radius: 99px; background: #f3f4f6; }
  .report-progress i { display: block; height: 100%; border-radius: inherit; }
  .report-status-row > strong, .report-status-row > span { text-align: right; font-variant-numeric: tabular-nums; }
  .report-status-row > span { color: #9ca3af; }
  .report-privacy-note { display: flex; gap: 9px; margin-top: 14px; padding: 8px 10px; border-radius: 7px; color: #6b7280; background: #f3f4f6; font-size: 7.5px; line-height: 1.5; }
  .report-privacy-note strong { color: #374151; }
  .report-document-footer { display: flex; justify-content: space-between; gap: 20px; margin-top: auto; padding-top: 9px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 7px; }
  .report-topic-summary { display: grid; grid-template-columns: .72fr .9fr 1.38fr; gap: 8px; margin-bottom: 15px; }
  .report-topic-summary > div { min-height: 62px; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; }
  .report-topic-summary span, .report-topic-summary small { display: block; color: #9ca3af; font-size: 7.5px; }
  .report-topic-summary strong { display: block; margin: 4px 0 2px; overflow: hidden; color: #1f2937; font-size: 13px; font-weight: 700; line-height: 1.25; text-overflow: ellipsis; white-space: nowrap; }
  .report-topic-section { margin-top: 0; }
  .report-topic-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 8.5px; }
  .report-topic-table th { padding: 8px 9px; color: #6b7280; background: #f3f4f6; font-size: 7.5px; font-weight: 700; text-align: left; }
  .report-topic-table th:nth-child(1) { width: 48px; }
  .report-topic-table th:nth-child(2) { width: 238px; }
  .report-topic-table th:nth-child(4), .report-topic-table th:nth-child(5) { width: 60px; }
  .report-topic-table td { min-height: 32px; padding: 5px 9px; border-bottom: 1px solid #eceff2; color: #4b5563; vertical-align: middle; }
  .report-rank { color: #9ca3af !important; font-weight: 700; }
  .report-topic-name { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .report-topic-name i { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #111827; }
  .report-topic-name span { overflow: visible; font-size: 8px; line-height: 1.3; white-space: normal; }
  .report-topic-bar { height: 6px; overflow: hidden; border-radius: 99px; background: #f3f4f6; }
  .report-topic-bar i { display: block; height: 100%; border-radius: inherit; background: #111827; }
  .report-num { text-align: right !important; font-variant-numeric: tabular-nums; }
  .report-num strong { color: #1f2937; }
  .report-empty-cell { height: 120px !important; color: #9ca3af !important; text-align: center; }
  .report-reading-note { margin-top: 16px; padding: 11px 13px; border-left: 3px solid #111827; border-radius: 0 7px 7px 0; background: #f3f4f6; }
  .report-reading-note strong { color: #1f2937; font-size: 8.5px; }
  .report-reading-note p { margin: 3px 0 0; color: #6b7280; font-size: 8px; line-height: 1.55; }
  .report-reading-note b { color: #374151; font-weight: 700; }
  .report-loading, .report-error { width: min(620px, 90vw); margin: 80px auto; padding: 32px; border: 1px solid #e5e7eb; border-radius: 12px; background: white; color: #6b7280; font-size: .85rem; text-align: center; }
  .report-error { color: #b91c1c; }
  @page { size: A4 portrait; margin: 0; }
  @media print {
    html, body, #root { height: auto !important; overflow: visible !important; background: white !important; }
    body > #root nav, .statistics-report-toolbar { display: none !important; }
    body > #root > div, .statistics-report-screen, .statistics-report-workspace { min-height: 0 !important; padding: 0 !important; background: white !important; }
    .statistics-report-document { display: block; }
    .statistics-report-paper { width: 210mm; height: 297mm; min-height: 297mm; margin: 0; padding: 14mm 15mm 11mm; break-after: page; page-break-after: always; box-shadow: none; }
    .statistics-report-paper:last-child { break-after: auto; page-break-after: auto; }
  }
  @media screen and (max-width: 860px) {
    .statistics-report-toolbar { grid-template-columns: 1fr auto; padding-inline: 14px; }
    .report-toolbar-title { display: none; }
    .statistics-report-workspace { overflow-x: auto; justify-content: flex-start; padding-inline: 14px; }
    .statistics-report-document { width: max-content; }
  }
`;
