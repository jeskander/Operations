// The simple version: one note per operation, stored as HTML in content.note. Headings, bold,
// italic, underline, bullet and numbered lists, links, and collapsible toggles; nothing else.

import type { Block, Consultant, Content } from "./types";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Markdown on one line (as the full version stores it) to the note's inline HTML. */
export function inlineHtml(md: string): string {
  let s = esc(md);
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, t, u) => `<a href="${u.replace(/"/g, "%22")}">${t}</a>`);
  s = s.replace(/&lt;u&gt;([^<\n]+?)&lt;\/u&gt;/g, "<u>$1</u>");
  s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^\w*])\*([^*\s\n][^*\n]*?)\*/g, "$1<em>$2</em>");
  s = s.replace(/~~([^~\n]+)~~/g, "$1").replace(/`([^`\n]+)`/g, "$1");
  return s;
}

const toggle = (summary: string, inner: string) => `<details><summary>${summary}</summary><div data-type="detailsContent">${inner || "<p></p>"}</div></details>`;

/** A multi-line Markdown answer to simple HTML: paragraphs and bullet lists; tables become lines. */
function answerHtml(md: string): string {
  const out: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(`<ul>${list.map((l) => `<li><p>${l}</p></li>`).join("")}</ul>`);
    list = [];
  };
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line || /^\|?\s*:?-{2,}/.test(line)) continue;
    const bullet = line.match(/^[-*+]\s+(.*)$/);
    if (bullet) {
      list.push(inlineHtml(bullet[1]));
      continue;
    }
    flush();
    const cells = line.startsWith("|") ? line.split("|").map((c) => c.trim()).filter(Boolean) : null;
    out.push(`<p>${cells ? inlineHtml(cells.join(" → ")) : inlineHtml(line)}</p>`);
  }
  flush();
  return out.join("");
}

/** The full version's steps (a flat list with depth) as nested HTML. Tags become words in brackets. */
function blocksHtml(blocks: Block[], tagName: (b: Block) => string): string {
  type Node = { b: Block; kids: Node[] };
  const root: Node[] = [];
  const stack: { depth: number; kids: Node[] }[] = [{ depth: -1, kids: root }];
  for (const b of blocks) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= b.depth) stack.pop();
    const n: Node = { b, kids: [] };
    stack[stack.length - 1].kids.push(n);
    stack.push({ depth: b.depth, kids: n.kids });
  }
  const text = (b: Block) => {
    const t = tagName(b);
    return (t ? `(${esc(t)}) ` : "") + inlineHtml(b.text);
  };
  const render = (nodes: Node[]): string => {
    let html = "";
    let i = 0;
    while (i < nodes.length) {
      const { b } = nodes[i];
      if (b.type === "bullet" || b.type === "number" || b.type === "todo") {
        // Consecutive items of one kind make one list.
        const ordered = b.type === "number";
        let items = "";
        while (i < nodes.length && (nodes[i].b.type === "number") === ordered && ["bullet", "number", "todo"].includes(nodes[i].b.type)) {
          const n = nodes[i];
          items += `<li><p>${n.b.type === "todo" ? (n.b.checked ? "☑ " : "☐ ") : ""}${text(n.b)}</p>${render(n.kids)}</li>`;
          i++;
        }
        html += ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
        continue;
      }
      const n = nodes[i];
      if (b.type === "toggle") html += toggle(text(b), render(n.kids));
      else if (b.type === "heading") html += `<h${b.level === 1 ? 2 : 3}>${text(b)}</h${b.level === 1 ? 2 : 3}>` + render(n.kids);
      else if (b.type === "divider") html += "";
      else if (b.type === "image") html += b.url ? `<p><a href="${esc(b.url)}">${esc(b.text || "Image")}</a></p>` : "";
      else html += (b.text ? `<p>${text(b)}</p>` : "") + render(n.kids);
      i++;
    }
    return html;
  };
  return render(root);
}

/** Everything on a full-version page, as one note. */
export function contentToNote(c: Content, consultants: Consultant[]): string {
  const tagName = (b: Block) =>
    [c.kits.find((k) => k.id === b.kit)?.name, c.techniques.find((t) => t.id === b.technique)?.name, consultants.find((p) => p.id === b.consultant)?.name]
      .filter(Boolean)
      .join(", ");
  const link = (url: string, title: string, extra = "") => `<li><p>${url ? `<a href="${esc(url)}">${esc(title || url)}</a>` : esc(title)}${extra ? ` (${esc(extra)})` : ""}</p></li>`;
  let html = blocksHtml(c.blocks, tagName);
  if (c.videos.length) html += `<h2>Videos</h2><ul>${c.videos.map((v) => link(v.url, v.title, v.source)).join("")}</ul>`;
  if (c.links.length) html += `<h2>Links</h2><ul>${c.links.map((l) => link(l.url, l.title, l.source)).join("")}</ul>`;
  if (c.kits.some((k) => k.url || k.maker)) html += `<h2>Op tech</h2><ul>${c.kits.map((k) => link(k.url, k.name, k.maker)).join("")}</ul>`;
  if (c.questions.length) html += `<h2>Knowledge</h2>${c.questions.map((q) => toggle(inlineHtml(q.q), answerHtml(q.a))).join("")}`;
  return html || "<p></p>";
}

/** The note as plain text, one line per paragraph, for search and for showing what changed. */
export function noteLines(html: string): string[] {
  return html
    .replace(/<(\/p|\/h[1-6]|\/li|\/summary|br\s*\/?)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Only the note's own tags and safe links survive saving. */
export function cleanNote(html: string): string {
  return html
    .replace(/<(script|style|iframe|object|embed)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed)[^>]*\/?>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/href\s*=\s*("|')\s*(javascript|data|vbscript):[^"']*\1/gi, 'href="#"')
    .slice(0, 500_000);
}
