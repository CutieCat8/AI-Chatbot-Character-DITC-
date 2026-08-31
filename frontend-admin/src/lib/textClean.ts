/**
 * tidyScrapedText — collapse the duplicate-nav/duplicate-block noise that the HTML
 * scraper often picks up (same menu or tab bar rendered twice in the DOM, repeated
 * blank lines). Only collapses lines/blocks that repeat *immediately* back-to-back —
 * it never removes a heading just because the same text appears again far later
 * (that's usually a legitimate repeated section, e.g. one tab bar per program card).
 */
export function tidyScrapedText(raw: string): string {
  const rawLines = raw.split(/\r?\n/).map((l) => l.trim());

  // collapse runs of blank lines to a single blank line
  const collapsedBlanks: string[] = [];
  for (const line of rawLines) {
    if (line === "" && collapsedBlanks[collapsedBlanks.length - 1] === "") continue;
    collapsedBlanks.push(line);
  }

  // drop a non-blank line that's an exact immediate repeat of the previous line
  const noAdjacentDupes: string[] = [];
  for (const line of collapsedBlanks) {
    if (line !== "" && line === noAdjacentDupes[noAdjacentDupes.length - 1]) continue;
    noAdjacentDupes.push(line);
  }

  // collapse a block of 2-6 lines that repeats immediately after itself
  // (e.g. a nav/tab bar rendered twice in the source HTML)
  const lines = noAdjacentDupes;
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    let collapsed = false;
    for (let w = 6; w >= 2; w--) {
      if (i + 2 * w > lines.length) continue;
      const a = lines.slice(i, i + w).join("\n");
      if (!a) continue;
      const b = lines.slice(i + w, i + 2 * w).join("\n");
      if (a === b) {
        out.push(...lines.slice(i, i + w));
        i += 2 * w;
        while (i + w <= lines.length && lines.slice(i, i + w).join("\n") === a) {
          i += w;
        }
        collapsed = true;
        break;
      }
    }
    if (!collapsed) {
      out.push(lines[i]);
      i++;
    }
  }

  return out.join("\n").trim();
}
