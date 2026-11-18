import type { Consultant, Content, Filters, Item, ListStyle, Operation, Section } from "./types";

export const newId = () => Math.random().toString(36).slice(2, 10);

export const REGIONS = ["Hip", "Knee", "Foot & ankle", "Shoulder & elbow", "Hand & wrist", "Spine", "Paeds", "Trauma", "General", "Other"];

export const DEFAULT_SECTIONS = ["Pre-op & huddle", "Position & draping", "Approach", "Procedure", "Closure", "Post-op"];

export const emptyContent = (): Content => ({
  kits: [],
  techniques: [],
  sections: DEFAULT_SECTIONS.map((title) => ({ id: newId(), title, items: [] })),
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
    sections: arr(c.sections).map((s) => ({
      id: id(s.id),
      title: str(s.title),
      items: arr(s.items).map((i) => ({
        id: id(i.id),
        text: str(i.text),
        list: (i.list === "number" ? "number" : "bullet") as ListStyle,
        depth: Math.max(0, Math.min(2, Number(i.depth) || 0)),
        kit: strOrNull(i.kit),
        technique: strOrNull(i.technique),
        consultant: strOrNull(i.consultant),
      })),
    })),
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

/** Whether an item shows under the chosen kit, technique and consultant. Blank filters show everything. */
export function visible(item: Item, f: Filters): boolean {
  if (item.kit && f.kit && item.kit !== f.kit) return false;
  if (item.technique && f.technique && item.technique !== f.technique) return false;
  if (item.consultant && f.consultant && item.consultant !== f.consultant) return false;
  return true;
}

// ---------- Steps as plain text, for editing by hand ----------
// "- text", "1. text", two spaces per level, and [Name] at the end for a kit, technique or consultant.

type Named = { id: string; name: string };
export type Markers = { kits: Named[]; techniques: Named[]; consultants: Named[] };

export function markersFor(content: Content, consultants: Consultant[]): Markers {
  return { kits: content.kits, techniques: content.techniques, consultants };
}

export function itemsToText(items: Item[], m: Markers): string {
  const name = (list: Named[], id: string | null) => (id ? list.find((x) => x.id === id)?.name : undefined);
  const counters: number[] = [];
  return items
    .map((it) => {
      counters.length = it.depth + 1;
      counters[it.depth] = (counters[it.depth] ?? 0) + 1;
      const marker = it.list === "number" ? `${counters[it.depth]}. ` : "- ";
      const tags = [name(m.kits, it.kit), name(m.techniques, it.technique), name(m.consultants, it.consultant)]
        .filter(Boolean)
        .map((n) => ` [${n}]`)
        .join("");
      return "  ".repeat(it.depth) + marker + it.text + tags;
    })
    .join("\n");
}

export function textToItems(text: string, previous: Item[], m: Markers): Item[] {
  const find = (list: Named[], n: string) => list.find((x) => x.name.trim().toLowerCase() === n.trim().toLowerCase())?.id ?? null;
  const unused = [...previous];
  return text
    .split("\n")
    .filter((l) => l.trim())
    .map((line) => {
      const indent = line.match(/^[ \t]*/)![0].replace(/\t/g, "  ").length;
      let rest = line.trim();
      let list: ListStyle = "bullet";
      const num = rest.match(/^\d+[.)]\s+/);
      const bullet = rest.match(/^[-*•–]\s+/);
      if (num) {
        list = "number";
        rest = rest.slice(num[0].length);
      } else if (bullet) rest = rest.slice(bullet[0].length);

      let kit: string | null = null;
      let technique: string | null = null;
      let consultant: string | null = null;
      for (;;) {
        const tag = rest.match(/\s*\[([^\]]+)\]\s*$/);
        if (!tag) break;
        const n = tag[1];
        const k = find(m.kits, n);
        const t = find(m.techniques, n);
        const c = find(m.consultants, n);
        if (k) kit = k;
        else if (t) technique = t;
        else if (c) consultant = c;
        else break; // not a marker: leave it in the text
        rest = rest.slice(0, tag.index).trimEnd();
      }

      // Keep ids for unchanged lines.
      const match = unused.findIndex((p) => p.text === rest);
      const prevId = match >= 0 ? unused.splice(match, 1)[0].id : newId();
      return { id: prevId, text: rest, list, depth: Math.min(2, Math.floor(indent / 2)), kit, technique, consultant };
    });
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
    ...c.sections.flatMap((s: Section) => [s.title, ...s.items.map((i) => i.text)]),
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
    ...c.sections.flatMap((s) => s.items.map((i) => `${s.title}: ${i.text}`)),
    ...c.questions.map((x) => `Q: ${x.q}`),
    ...c.videos.map((v) => `Video: ${v.title}`),
    ...c.links.map((l) => `Link: ${l.title}`),
    ...c.kits.map((k) => `Kit: ${k.name}`),
  ];
  return lines.find((l) => l.toLowerCase().includes(needle)) ?? null;
}
