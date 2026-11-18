import { fixDepths } from "./blocks";
import type { Block, BlockType, Content, Operation } from "./types";

export const newId = () => Math.random().toString(36).slice(2, 10);

export const REGIONS = ["Hip", "Knee", "Foot & ankle", "Shoulder & elbow", "Hand & wrist", "Spine", "Paeds", "Trauma", "General", "Other"];

export const DEFAULT_SECTIONS = ["Pre-op & huddle", "Position & draping", "Approach", "Procedure", "Closure", "Post-op"];

export const emptyContent = (parts: string[] = DEFAULT_SECTIONS): Content => ({
  kits: [],
  techniques: [],
  blocks: parts.map((text) => ({ id: newId(), type: "toggle" as const, text, depth: 0, kit: null, technique: null, consultant: null })),
  videos: [],
  links: [],
  questions: [],
});

const str = (v: unknown) => (typeof v === "string" ? v : "");
const strOrNull = (v: unknown) => (typeof v === "string" && v ? v : null);
const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const id = (v: unknown) => str(v) || newId();

/** Whatever is stored, as a complete Content. */
export function normalize(raw: unknown): Content {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    kits: arr(c.kits).map((k) => ({ id: id(k.id), name: str(k.name), maker: str(k.maker), url: str(k.url) })),
    techniques: arr(c.techniques).map((t) => ({ id: id(t.id), name: str(t.name) })),
    blocks: Array.isArray(c.blocks) ? normalizeBlocks(arr(c.blocks)) : fromSections(arr(c.sections)),
    videos: arr(c.videos).map((v) => ({
      id: id(v.id),
      title: str(v.title),
      url: str(v.url),
      source: str(v.source),
      note: str(v.note),
      group: v.group === "other" ? "other" : "full",
    })),
    links: arr(c.links).map((l) => ({ id: id(l.id), title: str(l.title), url: str(l.url), source: str(l.source), note: str(l.note) })),
    questions: arr(c.questions).map((q) => ({ id: id(q.id), q: str(q.q), a: str(q.a) })),
  };
}

const TYPES: BlockType[] = ["text", "bullet", "number", "toggle", "heading", "todo", "quote", "code", "divider", "image"];

function normalizeBlocks(raw: Record<string, unknown>[]): Block[] {
  return fixDepths(
    raw.map((b) => ({
      id: id(b.id),
      type: TYPES.includes(b.type as BlockType) ? (b.type as BlockType) : "text",
      text: str(b.text),
      depth: Math.max(0, Math.floor(Number(b.depth) || 0)),
      kit: strOrNull(b.kit),
      technique: strOrNull(b.technique),
      consultant: strOrNull(b.consultant),
      ...(b.type === "heading" ? { level: Math.max(1, Math.min(3, Number(b.level) || 2)) } : {}),
      ...(b.type === "todo" ? { checked: b.checked === true } : {}),
      ...(b.type === "image" ? { url: str(b.url) } : {}),
    })),
  );
}

/** Pages saved before blocks: each part becomes a toggle, its lines the blocks inside it. */
function fromSections(sections: Record<string, unknown>[]): Block[] {
  return normalizeBlocks(
    sections.flatMap((s) => {
      const base = Number(s.depth) === 1 ? 1 : 0;
      return [
        { id: s.id, type: "toggle", text: s.title, depth: base },
        ...arr(s.items).map((i) => ({ ...i, type: i.list === "number" ? "number" : "bullet", depth: base + 1 + (Number(i.depth) || 0) })),
      ];
    }),
  );
}

/** Everything searchable about an operation, lower-cased. */
export function searchText(op: Operation): string {
  const c = op.content;
  return [
    op.name,
    op.region,
    op.subtitle,
    ...c.kits.map((k) => `${k.name} ${k.maker}`),
    ...c.techniques.map((t) => t.name),
    ...c.blocks.map((b) => b.text),
    ...c.videos.map((v) => `${v.title} ${v.source} ${v.note}`),
    ...c.links.map((l) => `${l.title} ${l.source} ${l.note}`),
    ...c.questions.map((q) => `${q.q} ${q.a}`),
  ]
    .join("\n")
    .toLowerCase();
}

/** The first line that matches a search, to show under the operation's name. */
export function matchLine(op: Operation, q: string): string | null {
  const needle = q.toLowerCase();
  if (op.name.toLowerCase().includes(needle)) return null;
  const c = op.content;
  const lines = [
    ...c.blocks.map((b) => b.text),
    ...c.questions.map((x) => `Q: ${x.q}`),
    ...c.videos.map((v) => `Video: ${v.title}`),
    ...c.links.map((l) => `Link: ${l.title}`),
    ...c.kits.map((k) => `Kit: ${k.name}`),
  ];
  return lines.find((l) => l.toLowerCase().includes(needle)) ?? null;
}
