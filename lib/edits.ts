import { fixDepths, subtreeEnd } from "./blocks";
import { newId, normalize } from "./content";
import type { Block, BlockType, Content, Operation, OperationFields } from "./types";

/**
 * Targeted edits Claude makes to a page, instead of rewriting it. Claude reads the whole page and
 * answers with a short list of edits; everything it doesn't touch stays exactly as it was.
 */

export type NewBlock = {
  id?: string;
  type?: string;
  text?: string;
  /** Relative nesting: 0 is the level of the place it goes, 1 is nested one deeper, and so on. */
  depth?: number;
  kit?: string | null;
  technique?: string | null;
  consultant?: string | null;
  level?: number | null;
  checked?: boolean | null;
};

type Place = { after?: string | null; before?: string | null; inside?: string | null; at?: "start" | "end" | null };

export type Edit = Place & {
  action: string;
  id?: string;
  blocks?: NewBlock[];
  // update
  text?: string;
  type?: string;
  kit?: string | null;
  technique?: string | null;
  consultant?: string | null;
  level?: number | null;
  checked?: boolean | null;
  // lists
  list?: string;
  item?: Record<string, unknown>;
  // set_page
  name?: string;
  region?: string;
  subtitle?: string;
};

const TYPES: BlockType[] = ["text", "bullet", "number", "toggle", "heading", "todo", "quote", "code", "divider", "image"];
const LISTS = ["kits", "techniques", "consultants", "videos", "links", "questions"] as const;
type ListName = (typeof LISTS)[number];

const toBlocks = (raw: NewBlock[] | undefined, base: number): Block[] =>
  (raw ?? []).map((b) => {
    const type = TYPES.includes(b.type as BlockType) ? (b.type as BlockType) : "bullet";
    return {
      id: typeof b.id === "string" && b.id ? b.id : newId(),
      type,
      text: typeof b.text === "string" ? b.text : "",
      depth: base + Math.max(0, Math.floor(Number(b.depth) || 0)),
      kit: b.kit || null,
      technique: b.technique || null,
      consultant: b.consultant || null,
      ...(type === "heading" ? { level: Math.max(1, Math.min(3, Number(b.level) || 2)) } : {}),
      ...(type === "todo" ? { checked: b.checked === true } : {}),
    };
  });

/** Where a place points: the index to insert at and the depth there. */
function locate(blocks: Block[], p: Place): { at: number; depth: number } | null {
  if (p.inside) {
    const i = blocks.findIndex((b) => b.id === p.inside);
    if (i < 0) return null;
    return { at: p.at === "start" ? i + 1 : subtreeEnd(blocks, i), depth: blocks[i].depth + 1 };
  }
  if (p.after) {
    const i = blocks.findIndex((b) => b.id === p.after);
    if (i < 0) return null;
    return { at: subtreeEnd(blocks, i), depth: blocks[i].depth };
  }
  if (p.before) {
    const i = blocks.findIndex((b) => b.id === p.before);
    if (i < 0) return null;
    return { at: i, depth: blocks[i].depth };
  }
  return p.at === "start" ? { at: 0, depth: 0 } : { at: blocks.length, depth: 0 };
}

/** Apply Claude's edits. Edits that point at something missing are skipped and reported. */
export function applyEdits(op: Operation, edits: Edit[]): { fields: OperationFields; problems: string[]; touched: string[] } {
  const c: Content = structuredClone(op.content);
  let { name, region, subtitle } = op;
  let blocks = [...c.blocks];
  const problems: string[] = [];
  const touched = new Set<string>();
  const find = (id?: string) => (id ? blocks.findIndex((b) => b.id === id) : -1);

  for (const e of edits ?? []) {
    switch (e?.action) {
      case "insert": {
        const where = locate(blocks, e);
        if (!where) {
          problems.push(`couldn't find where to add "${e.blocks?.[0]?.text ?? ""}"`);
          break;
        }
        const added = toBlocks(e.blocks, where.depth);
        blocks.splice(where.at, 0, ...added);
        added.forEach((b) => touched.add(b.id));
        break;
      }
      case "update": {
        const i = find(e.id);
        if (i < 0) {
          problems.push(`couldn't find a line to update (${e.id})`);
          break;
        }
        const b = { ...blocks[i] };
        if (typeof e.text === "string") b.text = e.text;
        if (e.type && TYPES.includes(e.type as BlockType)) b.type = e.type as BlockType;
        if (e.kit !== undefined) b.kit = e.kit || null;
        if (e.technique !== undefined) b.technique = e.technique || null;
        if (e.consultant !== undefined) b.consultant = e.consultant || null;
        if (b.type === "heading") b.level = Math.max(1, Math.min(3, Number(e.level ?? b.level) || 2));
        else delete b.level;
        if (b.type === "todo") b.checked = typeof e.checked === "boolean" ? e.checked : b.checked === true;
        else delete b.checked;
        blocks[i] = b;
        touched.add(b.id);
        break;
      }
      case "delete": {
        const i = find(e.id);
        if (i < 0) {
          problems.push(`couldn't find a line to remove (${e.id})`);
          break;
        }
        blocks.splice(i, subtreeEnd(blocks, i) - i);
        break;
      }
      case "move": {
        const i = find(e.id);
        if (i < 0) {
          problems.push(`couldn't find a line to move (${e.id})`);
          break;
        }
        const end = subtreeEnd(blocks, i);
        const moving = blocks.slice(i, end);
        if ([e.after, e.before, e.inside].some((t) => t && moving.some((m) => m.id === t))) {
          problems.push("can't move a section inside itself");
          break;
        }
        const rest = [...blocks.slice(0, i), ...blocks.slice(end)];
        const where = locate(rest, e);
        if (!where) {
          problems.push(`couldn't find where to move "${moving[0].text}"`);
          break;
        }
        const by = where.depth - moving[0].depth;
        rest.splice(where.at, 0, ...moving.map((m) => ({ ...m, depth: m.depth + by })));
        blocks = rest;
        touched.add(moving[0].id);
        break;
      }
      case "replace_section": {
        const i = find(e.id);
        if (i < 0) {
          problems.push(`couldn't find the section to rewrite (${e.id})`);
          break;
        }
        const old = new Map(blocks.slice(i, subtreeEnd(blocks, i)).map((b) => [b.id, JSON.stringify(b)]));
        const fresh = toBlocks(e.blocks, blocks[i].depth);
        blocks.splice(i, subtreeEnd(blocks, i) - i, ...fresh);
        fresh.forEach((b) => old.get(b.id) !== JSON.stringify(b) && touched.add(b.id));
        break;
      }
      case "replace_all_blocks": {
        const old = new Map(blocks.map((b) => [b.id, JSON.stringify(b)]));
        blocks = toBlocks(e.blocks, 0);
        blocks.forEach((b) => old.get(b.id) !== JSON.stringify(b) && touched.add(b.id));
        break;
      }
      case "add_item":
      case "update_item":
      case "remove_item": {
        const key = e.list as ListName;
        if (!LISTS.includes(key)) {
          problems.push(`unknown list "${e.list}"`);
          break;
        }
        const arr = c[key] as unknown as Record<string, unknown>[];
        if (e.action === "add_item") arr.push({ id: newId(), ...(e.item ?? {}) });
        else {
          const id = e.id ?? (e.item?.id as string | undefined);
          const k = arr.findIndex((x) => x.id === id);
          if (k < 0) problems.push(`couldn't find ${key} item ${id}`);
          else if (e.action === "remove_item") arr.splice(k, 1);
          else arr[k] = { ...arr[k], ...(e.item ?? {}), id: arr[k].id };
        }
        break;
      }
      case "set_page":
        if (e.name?.trim()) name = e.name.trim();
        if (e.region?.trim()) region = e.region.trim();
        if (typeof e.subtitle === "string") subtitle = e.subtitle.trim();
        break;
      default:
        problems.push(`unknown edit "${e?.action}"`);
    }
  }

  c.blocks = fixDepths(blocks);
  const content = normalize(c);
  content.note = op.content.note;
  content.debriefs = op.content.debriefs;
  return { fields: { name, region, subtitle, content }, problems, touched: [...touched] };
}

/** The page as Claude reads it: an indented outline of the steps with ids, plus the lists. */
export function pageOutline(op: Operation): string {
  const { content: c } = op;
  const tag = (b: Block) =>
    [b.kit && `kit:${b.kit}`, b.technique && `mode:${b.technique}`, b.consultant && `consultant:${b.consultant}`].filter(Boolean).join(" ");
  const steps = c.blocks
    .map((b) => {
      const t = tag(b);
      const extra = [b.type === "heading" ? `h${b.level ?? 2}` : "", b.type === "todo" ? (b.checked ? "done" : "open") : ""].filter(Boolean).join(" ");
      return `${"  ".repeat(b.depth)}[${b.id}] ${b.type}${extra ? ` ${extra}` : ""}${t ? ` {${t}}` : ""}: ${b.text}`;
    })
    .join("\n");
  return [
    `name: ${op.name}`,
    `region: ${op.region}`,
    `subtitle: ${op.subtitle}`,
    `kits: ${JSON.stringify(c.kits)}`,
    `modes (techniques): ${JSON.stringify(c.techniques)}`,
    `consultants: ${JSON.stringify(c.consultants)}`,
    `steps:\n${steps || "(none yet)"}`,
    `videos: ${JSON.stringify(c.videos)}`,
    `links: ${JSON.stringify(c.links)}`,
    `questions: ${JSON.stringify(c.questions)}`,
  ].join("\n\n");
}
