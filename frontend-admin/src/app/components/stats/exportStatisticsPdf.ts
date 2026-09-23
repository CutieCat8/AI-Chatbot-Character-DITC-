import type { ConversationStatsOut } from "../../../lib/api";
import logo from "../../../assets/logo.png";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString("th-TH");
}

function percentage(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function createTrendChart(stats: ConversationStatsOut): string {
  const points = stats.daily_counts;
  if (points.length === 0) return '<div class="empty-chart">ไม่มีข้อมูลแนวโน้มในช่วงนี้</div>';

  const width = 760;
  const height = 190;
  const chartTop = 16;
  const chartBottom = 150;
  const chartHeight = chartBottom - chartTop;
  const max = Math.max(1, ...points.map((point) => point.count));
  const gap = points.length > 45 ? 1 : points.length > 20 ? 2 : 4;
  const barWidth = Math.max(2, (width - gap * (points.length - 1)) / points.length);

  const bars = points
    .map((point, index) => {
      const barHeight = (point.count / max) * chartHeight;
      const x = index * (barWidth + gap);
      const y = chartBottom - barHeight;
      return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${barWidth.toFixed(2)}" height="${barHeight.toFixed(2)}" rx="${Math.min(3, barWidth / 2).toFixed(2)}" fill="#41342B"><title>${escapeHtml(formatDate(point.date))}: ${formatNumber(point.count)} บทสนทนา</title></rect>`;
    })
    .join("");

  const labelIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const labels = labelIndexes
    .map((index) => {
      const point = points[index];
      const x = index * (barWidth + gap) + barWidth / 2;
      const anchor = index === 0 ? "start" : index === points.length - 1 ? "end" : "middle";
      return `<text x="${x.toFixed(2)}" y="178" text-anchor="${anchor}" fill="#8A837C" font-size="10">${escapeHtml(formatDate(point.date))}</text>`;
    })
    .join("");

  return `
    <svg class="trend-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="แนวโน้มจำนวนบทสนทนา">
      <line x1="0" y1="${chartBottom}" x2="${width}" y2="${chartBottom}" stroke="#DED9D2" />
      <line x1="0" y1="${chartTop}" x2="${width}" y2="${chartTop}" stroke="#EEEAE5" stroke-dasharray="4 4" />
      <text x="0" y="11" fill="#8A837C" font-size="10">สูงสุด ${formatNumber(max)} บทสนทนา/วัน</text>
      ${bars}
      ${labels}
    </svg>`;
}

function createTopicRows(stats: ConversationStatsOut): string {
  const total = stats.top_topics.reduce((sum, topic) => sum + topic.count, 0);
  if (stats.top_topics.length === 0) {
    return '<tr><td colspan="4" class="empty-cell">ไม่มีหัวข้อที่ถูกจัดหมวดในช่วงนี้</td></tr>';
  }

  return stats.top_topics
    .map((topic, index) => {
      const pct = percentage(topic.count, total);
      return `
        <tr>
          <td class="rank">${index + 1}</td>
          <td>${escapeHtml(topic.label)}</td>
          <td>
            <div class="topic-bar"><span style="width:${pct}%"></span></div>
          </td>
          <td class="number">${formatNumber(topic.count)} <small>${pct}%</small></td>
        </tr>`;
    })
    .join("");
}

function reportHtml(stats: ConversationStatsOut, start: string, end: string): string {
  const classifiedTotal = stats.answered_count + stats.off_topic_only_count + stats.greeting_only_count;
  const signalTotal = stats.total_conversations + stats.noise_count;
  const qualityPct = percentage(stats.total_conversations, signalTotal);
  const generatedAt = new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date());

  const answerRows = [
    ["ตอบได้จากฐานความรู้", stats.answered_count],
    ["ถามนอกขอบเขต", stats.off_topic_only_count],
    ["ทักทาย/คุยเล่นอย่างเดียว", stats.greeting_only_count],
  ] as const;

  return `<!DOCTYPE html>
<html lang="th">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>รายงานสถิติบทสนทนา DITC CAT</title>
    <style>
      * { box-sizing: border-box; }
      :root { color-scheme: light; }
      html { background: #e9e7e3; }
      body { margin: 0; color: #292521; font-family: Tahoma, "Noto Sans Thai", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .toolbar { position: sticky; top: 0; z-index: 10; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 24px; background: rgba(255,255,255,.96); border-bottom: 1px solid #ddd9d3; backdrop-filter: blur(10px); }
      .toolbar-title { font-size: 13px; font-weight: 700; }
      .toolbar-note { margin-top: 2px; color: #817b75; font-size: 11px; }
      .print-button { appearance: none; border: 0; border-radius: 999px; padding: 10px 18px; color: white; background: #24211f; font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
      .print-button:hover { background: #41342b; }
      .paper-wrap { padding: 32px 16px; }
      .paper { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 17mm 16mm 15mm; background: white; box-shadow: 0 20px 60px rgba(42,36,32,.12); }
      .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 18px; border-bottom: 2px solid #41342b; }
      .brand { display: flex; align-items: center; gap: 12px; }
      .brand img { width: 44px; height: 44px; object-fit: contain; }
      .brand-name { font-size: 18px; font-weight: 800; letter-spacing: -.02em; }
      .brand-subtitle { margin-top: 2px; color: #8a837c; font-size: 10px; }
      .meta { color: #766f69; font-size: 10px; line-height: 1.7; text-align: right; }
      .meta strong { color: #332e2a; }
      h1 { margin: 24px 0 4px; font-size: 25px; line-height: 1.2; letter-spacing: -.035em; }
      .subtitle { margin: 0 0 24px; color: #827b75; font-size: 11px; }
      .summary-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
      .summary-card { min-height: 78px; padding: 12px; border: 1px solid #e7e3de; border-radius: 10px; background: #faf9f7; }
      .summary-label { color: #817a74; font-size: 9px; line-height: 1.35; }
      .summary-value { margin-top: 10px; color: #332e2a; font-size: 21px; font-weight: 800; letter-spacing: -.04em; }
      .summary-card.quality { color: white; background: #41342b; border-color: #41342b; }
      .summary-card.quality .summary-label, .summary-card.quality .summary-value { color: inherit; }
      .section { margin-top: 25px; break-inside: avoid; }
      .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; margin-bottom: 10px; }
      .section h2 { margin: 0; padding-left: 9px; border-left: 3px solid #874526; font-size: 14px; }
      .section-note { color: #928b85; font-size: 9px; }
      .trend-frame { padding: 12px 14px 4px; border: 1px solid #e8e4df; border-radius: 10px; }
      .trend-chart { display: block; width: 100%; height: 176px; overflow: visible; }
      .empty-chart { display: grid; height: 150px; place-items: center; color: #aaa39d; font-size: 11px; }
      .status-grid { display: grid; grid-template-columns: 1.05fr .95fr; gap: 14px; }
      .status-list { display: flex; flex-direction: column; gap: 10px; padding: 15px; border: 1px solid #e8e4df; border-radius: 10px; }
      .status-row { display: grid; grid-template-columns: 1fr auto auto; gap: 16px; align-items: center; font-size: 11px; }
      .status-row span:nth-child(2) { color: #8b847d; }
      .status-row strong { min-width: 30px; text-align: right; }
      .quality-panel { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; color: white; background: #41342b; border-radius: 10px; }
      .quality-score { font-size: 38px; font-weight: 800; letter-spacing: -.06em; }
      .quality-score small { margin-left: 3px; font-size: 13px; font-weight: 500; opacity: .62; }
      .quality-copy { max-width: 150px; font-size: 10px; line-height: 1.55; opacity: .7; text-align: right; }
      table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
      th { padding: 8px 9px; color: #8a837c; background: #f5f3ef; font-size: 9px; font-weight: 700; letter-spacing: .04em; text-align: left; }
      td { padding: 9px; border-bottom: 1px solid #eeeae5; }
      .rank { width: 30px; color: #aaa39d; }
      .number { width: 86px; font-weight: 700; text-align: right; white-space: nowrap; }
      .number small { margin-left: 4px; color: #9a938d; font-weight: 400; }
      .topic-bar { height: 5px; overflow: hidden; border-radius: 99px; background: #ede9e4; }
      .topic-bar span { display: block; height: 100%; border-radius: inherit; background: #874526; }
      .empty-cell { padding: 24px; color: #aaa39d; text-align: center; }
      .privacy { display: flex; gap: 9px; margin-top: 24px; padding: 12px 14px; color: #746e68; background: #f5f3ef; border-radius: 8px; font-size: 9.5px; line-height: 1.55; }
      .privacy strong { color: #41342b; }
      .footer { display: flex; justify-content: space-between; gap: 16px; margin-top: 24px; padding-top: 12px; color: #9b948e; border-top: 1px solid #e5e1dc; font-size: 9px; }
      @page { size: A4; margin: 0; }
      @media print {
        html, body { background: white; }
        .toolbar { display: none !important; }
        .paper-wrap { padding: 0; }
        .paper { width: 210mm; min-height: 297mm; margin: 0; box-shadow: none; }
      }
      @media screen and (max-width: 850px) {
        .paper-wrap { overflow-x: auto; }
      }
    </style>
  </head>
  <body>
    <div class="toolbar">
      <div>
        <div class="toolbar-title">ตัวอย่างรายงานสถิติ DITC CAT</div>
        <div class="toolbar-note">เลือก “Save as PDF” หรือ “บันทึกเป็น PDF” ในหน้าต่างพิมพ์</div>
      </div>
      <button class="print-button" onclick="window.print()">บันทึกเป็น PDF</button>
    </div>
    <div class="paper-wrap">
      <article class="paper">
        <header class="header">
          <div class="brand">
            <img src="${escapeHtml(logo)}" alt="DITC CAT" />
            <div>
              <div class="brand-name">DITC CAT</div>
              <div class="brand-subtitle">Conversation Analytics Report</div>
            </div>
          </div>
          <div class="meta">
            <div>ช่วงข้อมูล <strong>${formatDate(start)} – ${formatDate(end)}</strong></div>
            <div>สร้างเมื่อ <strong>${escapeHtml(generatedAt)}</strong></div>
            <div>ประเภท <strong>รายงานสรุปสถิติ</strong></div>
          </div>
        </header>

        <h1>รายงานสถิติบทสนทนา</h1>
        <p class="subtitle">ภาพรวมการใช้งาน หัวข้อที่ถูกถาม และประสิทธิภาพการค้นข้อมูลของ DITC CAT</p>

        <section class="summary-grid">
          <div class="summary-card"><div class="summary-label">จำนวนบทสนทนา</div><div class="summary-value">${formatNumber(stats.total_conversations)}</div></div>
          <div class="summary-card"><div class="summary-label">ยังไม่จัดหมวด</div><div class="summary-value">${formatNumber(stats.unclassified_count)}</div></div>
          <div class="summary-card"><div class="summary-label">หัวข้ออื่น ๆ</div><div class="summary-value">${formatNumber(stats.other_count)}</div></div>
          <div class="summary-card"><div class="summary-label">เงียบ/ขยะ</div><div class="summary-value">${formatNumber(stats.noise_count)}</div></div>
          <div class="summary-card quality"><div class="summary-label">คุณภาพสัญญาณ</div><div class="summary-value">${qualityPct}%</div></div>
        </section>

        <section class="section">
          <div class="section-head">
            <h2>แนวโน้มจำนวนบทสนทนา</h2>
            <span class="section-note">รายวัน · รวม ${formatNumber(stats.daily_counts.reduce((sum, day) => sum + day.count, 0))} รายการ</span>
          </div>
          <div class="trend-frame">${createTrendChart(stats)}</div>
        </section>

        <section class="section">
          <div class="section-head"><h2>สถานะการค้นข้อมูล</h2></div>
          <div class="status-grid">
            <div class="status-list">
              ${answerRows
                .map(
                  ([label, count]) => `<div class="status-row"><span>${label}</span><span>${percentage(count, classifiedTotal)}%</span><strong>${formatNumber(count)}</strong></div>`,
                )
                .join("")}
            </div>
            <div class="quality-panel">
              <div><div class="quality-score">${qualityPct}<small>/100</small></div><div style="font-size:9px;opacity:.62">คุณภาพสัญญาณ</div></div>
              <div class="quality-copy">สัดส่วนบทสนทนาจริงเทียบกับเหตุการณ์เงียบหรือเสียงรบกวนทั้งหมด</div>
            </div>
          </div>
        </section>

        <section class="section">
          <div class="section-head">
            <h2>สถิติหัวข้อทั้งหมด</h2>
            <span class="section-note">เรียงจากจำนวนมากไปน้อย</span>
          </div>
          <table>
            <thead><tr><th>#</th><th>หัวข้อ</th><th>สัดส่วน</th><th style="text-align:right">จำนวน</th></tr></thead>
            <tbody>${createTopicRows(stats)}</tbody>
          </table>
        </section>

        <div class="privacy">
          <strong>PDPA</strong>
          <span>รายงานนี้ประกอบด้วยข้อมูลสถิติแบบสรุปเท่านั้น ไม่มีข้อความบทสนทนาดิบหรือข้อมูลที่ใช้ระบุตัวบุคคล</span>
        </div>

        <footer class="footer">
          <span>DITC CAT · AI Knowledge Assistant</span>
          <span>${formatDate(start)} – ${formatDate(end)}</span>
        </footer>
      </article>
    </div>
  </body>
</html>`;
}

export function exportStatisticsPdf(stats: ConversationStatsOut, start: string, end: string): boolean {
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) return false;

  reportWindow.opener = null;
  reportWindow.document.open();
  reportWindow.document.write(reportHtml(stats, start, end));
  reportWindow.document.close();
  return true;
}
