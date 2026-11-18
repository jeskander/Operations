import type { Block, BlockType, Filters } from "./types";

export const MAX_DEPTH = 6;

/** Index just past a block's nested children. */
export function subtreeEnd(b: Block[], i: number): number {
  let j = i + 1;
  while (j < b.length && b[j].depth > b[i].depth) j++;
  return j;
}

/** Keep nesting valid: a block can be at most one level deeper than the block above it. */
export function fixDepths(b: Block[]): Block[] {
  let prev = -1;
  return b.map((x) => {
    const d = Math.max(0, Math.min(x.depth, prev + 1, MAX_DEPTH));
    prev = d;
    return d === x.depth ? x : { ...x, depth: d };
  });
}

const shift = (b: Block[], from: number, to: number, by: number) =>
  b.map((x, k) => (k >= from && k < to ? { ...x, depth: Math.max(0, x.depth + by) } : x));

/** Tab: nest the block (and its children) inside the block above. */
export function indent(b: Block[], id: string): Block[] {
  const i = b.findIndex((x) => x.id === id);
  if (i <= 0 || b[i - 1].depth < b[i].depth || b[i].depth >= MAX_DEPTH) return b;
  return shift(b, i, subtreeEnd(b, i), 1);
}

/** Shift+Tab: move the block (and its children) out one level. */
export function outdent(b: Block[], id: string): Block[] {
  const i = b.findIndex((x) => x.id === id);
  if (i < 0 || b[i].depth === 0) return b;
  return fixDepths(shift(b, i, subtreeEnd(b, i), -1));
}

/** Drag: move a block with its children to where another block is, as that block's sibling. */
export function moveBlock(b: Block[], activeId: string, overId: string): Block[] {
  const from = b.findIndex((x) => x.id === activeId);
  const to = b.findIndex((x) => x.id === overId);
  if (from < 0 || to < 0 || from === to) return b;
  const end = subtreeEnd(b, from);
  if (to > from && to < end) return b; // dropped on its own child
  const moving = b.slice(from, end);
  const rest = [...b.slice(0, from), ...b.slice(end)];
  const over = rest.findIndex((x) => x.id === overId);
  const at = to > from ? subtreeEnd(rest, over) : over;
  const by = rest[over].depth - moving[0].depth;
  rest.splice(at, 0, ...moving.map((x) => ({ ...x, depth: x.depth + by })));
  return fixDepths(rest);
}

export function duplicate(b: Block[], id: string, newId: () => string): { blocks: Block[]; copyId: string } {
  const i = b.findIndex((x) => x.id === id);
  if (i < 0) return { blocks: b, copyId: id };
  const end = subtreeEnd(b, i);
  const copy = b.slice(i, end).map((x) => ({ ...x, id: newId() }));
  return { blocks: [...b.slice(0, end), ...copy, ...b.slice(end)], copyId: copy[0].id };
}

/** Delete a block. Its children move up a level so nothing else is lost. */
export function removeBlock(b: Block[], id: string): Block[] {
  const i = b.findIndex((x) => x.id === id);
  if (i < 0) return b;
  const end = subtreeEnd(b, i);
  return fixDepths([...b.slice(0, i), ...shift(b, i + 1, end, -1).slice(i + 1)]);
}

/** Delete a block and everything nested in it. */
export function removeSubtree(b: Block[], id: string): Block[] {
  const i = b.findIndex((x) => x.id === id);
  if (i < 0) return b;
  return fixDepths([...b.slice(0, i), ...b.slice(subtreeEnd(b, i))]);
}

const tagOk = (x: Block, f: Filters) =>
  !(x.kit && f.kit && x.kit !== f.kit) && !(x.technique && f.technique && x.technique !== f.technique) && !(x.consultant && f.consultant && x.consultant !== f.consultant);

export const isFiltering = (f: Filters) => !!(f.kit || f.technique || f.consultant);

/**
 * The blocks on screen: a tag hides a block and everything in it when another kit, mode or
 * consultant is chosen; a closed toggle hides its children. While filtering, a toggle whose
 * contents are all for other cases is hidden too.
 */
export function visibleBlocks(b: Block[], f: Filters, collapsed: Set<string>): Block[] {
  const filtering = isFiltering(f);
  const passes: boolean[] = [];
  const stack: { depth: number; ok: boolean }[] = [];
  for (const x of b) {
    while (stack.length && stack[stack.length - 1].depth >= x.depth) stack.pop();
    const ok = tagOk(x, f) && (stack.length ? stack[stack.length - 1].ok : true);
    passes.push(ok);
    stack.push({ depth: x.depth, ok });
  }
  const out: Block[] = [];
  let hideBelow = Infinity; // depth under which blocks are inside a closed or hidden block
  b.forEach((x, i) => {
    if (x.depth > hideBelow) return;
    hideBelow = Infinity;
    if (!passes[i]) {
      hideBelow = x.depth;
      return;
    }
    if (filtering && x.type === "toggle") {
      const end = subtreeEnd(b, i);
      if (end > i + 1 && !passes.slice(i + 1, end).some(Boolean)) {
        hideBelow = x.depth;
        return;
      }
    }
    out.push(x);
    if (x.type === "toggle" && collapsed.has(x.id)) hideBelow = x.depth;
  });
  return out;
}

/** The number shown on each numbered block: consecutive numbered siblings count up. */
export function numbering(shown: Block[]): Map<string, number> {
  const n = new Map<string, number>();
  const count: number[] = [];
  const last: (BlockType | undefined)[] = [];
  for (const x of shown) {
    count.length = x.depth + 1;
    last.length = x.depth + 1;
    if (x.type === "number") {
      count[x.depth] = last[x.depth] === "number" ? (count[x.depth] ?? 0) + 1 : 1;
      n.set(x.id, count[x.depth]);
    }
    last[x.depth] = x.type;
  }
  return n;
}

/** Notion's typing shortcuts at the start of a block. */
export function shortcut(text: string): { type: BlockType; rest: string } | null {
  const m = text.match(/^([-*+]|1\.|a\.|i\.|>|#{1,3})\s/);
  if (!m) return null;
  const k = m[1];
  const type: BlockType = k === ">" ? "toggle" : k.startsWith("#") ? "heading" : /[-*+]/.test(k) ? "bullet" : "number";
  return { type, rest: text.slice(m[0].length) };
}

/** The block above whose children include this one, for showing a block's part. */
export function parentOf(b: Block[], i: number): number {
  for (let j = i - 1; j >= 0; j--) if (b[j].depth < b[i].depth) return j;
  return -1;
}
