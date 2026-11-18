// Between the steps as stored (a flat list of blocks with markdown text, see types.ts) and
// BlockNote's document (a tree of blocks with styled text). Ids carry across both ways, so tags,
// open parts and Claude's edits stay attached to the same blocks.

import { fixDepths } from "./blocks";
import type { Block, BlockType } from "./types";

type Styles = { bold?: true; italic?: true; code?: true; strike?: true };
type StyledText = { type: "text"; text: string; styles: Styles };
type LinkContent = { type: "link"; href: string; content: StyledText[] };
type Inline = StyledText | LinkContent;

export type BNBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: Inline[] | string | unknown;
  children?: BNBlock[];
};

const TO_BN: Record<BlockType, string> = {
  text: "paragraph",
  bullet: "bulletListItem",
  number: "numberedListItem",
  toggle: "toggleListItem",
  heading: "heading",
  todo: "checkListItem",
  quote: "quote",
  code: "codeBlock",
  divider: "divider",
  image: "image",
};
const FROM_BN: Record<string, BlockType> = Object.fromEntries(Object.entries(TO_BN).map(([k, v]) => [v, k as BlockType]));

// ---------- Inline text ----------

const TOKEN = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|~([^~\n]+)~|`([^`\n]+)`|\*([^*\s\n][^*\n]*?)\*|(?<![\w])_([^_\s\n][^_\n]*?)_(?![\w])/g;

/** Markdown on one line (bold, italic, code, strike-through, links) to styled text. */
export function mdToInline(md: string): Inline[] {
  const out: Inline[] = [];
  const plain = (text: string) => text && out.push({ type: "text", text, styles: {} });
  let last = 0;
  for (const m of md.matchAll(TOKEN)) {
    plain(md.slice(last, m.index));
    if (m[1] !== undefined) out.push({ type: "link", href: m[2], content: [{ type: "text", text: m[1], styles: {} }] });
    else if (m[3] !== undefined || m[4] !== undefined) out.push({ type: "text", text: m[3] ?? m[4], styles: { bold: true } });
    else if (m[5] !== undefined || m[6] !== undefined) out.push({ type: "text", text: m[5] ?? m[6], styles: { strike: true } });
    else if (m[7] !== undefined) out.push({ type: "text", text: m[7], styles: { code: true } });
    else out.push({ type: "text", text: m[8] ?? m[9], styles: { italic: true } });
    last = (m.index ?? 0) + m[0].length;
  }
  plain(md.slice(last));
  return out;
}

function styled(t: { text?: string; styles?: Record<string, unknown> }): string {
  let s = t.text ?? "";
  if (!s) return "";
  const st = t.styles ?? {};
  // Keep the spaces outside the markers so "**word** next" round-trips.
  const lead = s.match(/^\s*/)![0];
  const trail = s.match(/\s*$/)![0];
  let core = s.trim();
  if (!core) return s;
  if (st.code) core = `\`${core}\``;
  else {
    if (st.strike) core = `~~${core}~~`;
    if (st.italic) core = `*${core}*`;
    if (st.bold) core = `**${core}**`;
  }
  s = lead + core + trail;
  return s;
}

/** Styled text back to markdown on one line. */
export function inlineToMd(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c: { type?: string; text?: string; styles?: Record<string, unknown>; href?: string; content?: unknown }) => {
      if (c.type === "link") return `[${inlineToMd(c.content).replace(/[[\]]/g, "") || c.href}](${c.href})`;
      if (c.type === "text") return styled(c);
      return "";
    })
    .join("");
}

/** Plain text of a block's content, for code blocks. */
const plainText = (content: unknown) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c: { text?: string }) => c.text ?? "").join("") : "";

// ---------- Blocks ----------

/** The stored flat list as BlockNote's tree. */
export function toBN(blocks: Block[]): BNBlock[] {
  const root: BNBlock[] = [];
  const stack: { depth: number; kids: BNBlock[] }[] = [{ depth: -1, kids: root }];
  for (const b of blocks) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= b.depth) stack.pop();
    const node: BNBlock = { id: b.id, type: TO_BN[b.type] ?? "paragraph", props: {}, children: [] };
    if (b.type === "heading") node.props = { level: b.level ?? 2 };
    if (b.type === "todo") node.props = { checked: !!b.checked };
    if (b.type === "image") node.props = { url: b.url ?? "", caption: b.text };
    if (b.type === "code") node.content = b.text;
    else if (b.type !== "divider" && b.type !== "image") node.content = mdToInline(b.text);
    stack[stack.length - 1].kids.push(node);
    stack.push({ depth: b.depth, kids: node.children! });
  }
  return root;
}

type Tags = Pick<Block, "kit" | "technique" | "consultant">;

/** BlockNote's tree back to the stored flat list, keeping each block's tags by id. */
export function fromBN(doc: BNBlock[], tagsOf: (id: string) => Tags | undefined): Block[] {
  const out: Block[] = [];
  const walk = (list: BNBlock[], depth: number) => {
    for (const n of list) {
      const type = FROM_BN[n.type] ?? "text";
      const props = n.props ?? {};
      const tags = tagsOf(n.id) ?? { kit: null, technique: null, consultant: null };
      const text = type === "code" ? plainText(n.content) : type === "image" ? String(props.caption ?? "") : type === "divider" ? "" : inlineToMd(n.content);
      const b: Block = { id: n.id, type, text, depth, kit: tags.kit, technique: tags.technique, consultant: tags.consultant };
      if (type === "heading") b.level = Math.max(1, Math.min(3, Number(props.level) || 2));
      if (type === "todo") b.checked = props.checked === true;
      if (type === "image") b.url = String(props.url ?? "");
      out.push(b);
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(doc, 0);
  return fixDepths(out);
}

/** The blocks without their tags, to tell a tag-only change from a change to the text. */
export const shape = (blocks: Block[]) => JSON.stringify(blocks.map(({ kit: _k, technique: _t, consultant: _c, ...rest }) => rest));
