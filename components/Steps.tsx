"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { newId, visible } from "@/lib/content";
import type { Consultant, Content, Filters, Item, ListStyle, Section } from "@/lib/types";
import Editable, { AddField } from "./Editable";
import { Inline } from "./Markdown";
import Sheet, { Choice } from "./Sheet";

// The page as one flat list: a part's header, then its lines. Dragging moves rows within it.
type Row = { kind: "s"; id: string; s: Section } | { kind: "i"; id: string; it: Item; sid: string };

const flatten = (sections: Section[]): Row[] =>
  sections.flatMap((s) => [{ kind: "s" as const, id: `s:${s.id}`, s }, ...s.items.map((it) => ({ kind: "i" as const, id: `i:${it.id}`, it, sid: s.id }))]);

function unflatten(rows: Row[]): Section[] {
  const out: Section[] = [];
  const loose: Item[] = [];
  for (const r of rows) {
    if (r.kind === "s") out.push({ ...r.s, items: [] });
    else if (out.length) out[out.length - 1].items.push(r.it);
    else loose.push(r.it);
  }
  if (out.length) out[0].items.unshift(...loose);
  return out;
}

/** Where a part's block ends: its lines and, for a main part, its sub-parts. */
function blockEnd(rows: Row[], start: number): number {
  const head = rows[start];
  const depth = head.kind === "s" ? head.s.depth : 0;
  let i = start + 1;
  while (i < rows.length) {
    const r = rows[i];
    if (r.kind === "s" && r.s.depth <= depth) break;
    i++;
  }
  return i;
}

function moveRow(rows: Row[], activeId: string, overId: string): Row[] {
  const from = rows.findIndex((r) => r.id === activeId);
  const to = rows.findIndex((r) => r.id === overId);
  if (from < 0 || to < 0 || from === to) return rows;
  const active = rows[from];

  if (active.kind === "i") {
    const out = [...rows];
    out.splice(from, 1);
    out.splice(to, 0, active);
    return out;
  }

  // A part moves with its lines and sub-parts, landing before or after the whole part it was dropped on.
  const end = blockEnd(rows, from);
  const block = rows.slice(from, end);
  const rest = [...rows.slice(0, from), ...rows.slice(end)];
  const over = rest.findIndex((r) => r.id === overId);
  if (over < 0) return rows;
  let head = over;
  while (head >= 0 && rest[head].kind !== "s") head--;
  let at: number;
  if (head < 0) at = 0;
  else if (to > from) at = blockEnd(rest, head);
  else at = head;
  rest.splice(at, 0, ...block);
  return rest;
}

const readCollapsed = (opId: string, sections: Section[]): Set<string> => {
  try {
    const saved = localStorage.getItem(`op-open-${opId}`);
    if (saved) {
      const open = new Set(JSON.parse(saved) as string[]);
      return new Set(sections.filter((s) => !open.has(s.id)).map((s) => s.id));
    }
  } catch {}
  return new Set(sections.slice(1).map((s) => s.id));
};

type Props = {
  opId: string;
  content: Content;
  consultants: Consultant[];
  filters: Filters;
  update: (next: Content | ((c: Content) => Content)) => void;
};

export default function Steps({ opId, content, consultants, filters, update }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ kind: "i" | "s"; id: string } | null>(null);

  useEffect(() => setCollapsed(readCollapsed(opId, content.sections)), [opId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOpen = (id: string, open: boolean) => {
    const next = new Set(collapsed);
    if (open) next.delete(id);
    else next.add(id);
    setCollapsed(next);
    try {
      localStorage.setItem(`op-open-${opId}`, JSON.stringify(content.sections.filter((s) => !next.has(s.id)).map((s) => s.id)));
    } catch {}
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const filtering = !!(filters.kit || filters.technique || filters.consultant);

  // What's on screen: lines hidden by the filters or a closed part drop out.
  const shown = useMemo(() => {
    const out: Row[] = [];
    let mainClosed = false;
    for (const s of content.sections) {
      if (s.depth === 0) mainClosed = collapsed.has(s.id);
      else if (mainClosed) continue;
      const lines = s.items.filter((it) => visible(it, filters));
      if (filtering && s.items.length && !lines.length) continue; // nothing here for this case
      out.push({ kind: "s", id: `s:${s.id}`, s });
      if (!collapsed.has(s.id)) out.push(...lines.map((it) => ({ kind: "i" as const, id: `i:${it.id}`, it, sid: s.id })));
    }
    return out;
  }, [content.sections, collapsed, filters, filtering]);

  // Every change works on the latest page, so several in a row (edit, then Enter) don't undo each other.
  const setSections = (fn: (sections: Section[]) => Section[]) => update((c) => ({ ...c, sections: fn(c.sections) }));

  const editItem = (id: string, change: Partial<Item>) =>
    setSections((all) => all.map((s) => ({ ...s, items: s.items.map((it) => (it.id === id ? { ...it, ...change } : it)) })));
  const editSection = (id: string, change: Partial<Section>) => setSections((all) => all.map((s) => (s.id === id ? { ...s, ...change } : s)));

  const removeItem = (id: string) => setSections((all) => all.map((s) => ({ ...s, items: s.items.filter((it) => it.id !== id) })));

  const insertAfter = (sid: string, afterId: string | null, base?: Partial<Item>): string => {
    const it: Item = { id: newId(), text: "", list: base?.list ?? "bullet", depth: base?.depth ?? 0, kit: null, technique: null, consultant: null };
    setSections((all) =>
      all.map((s) => {
        if (s.id !== sid) return s;
        const items = [...s.items];
        const at = afterId ? items.findIndex((x) => x.id === afterId) + 1 : items.length;
        items.splice(at, 0, it);
        return { ...s, items };
      }),
    );
    return it.id;
  };

  const addLine = (sid: string, text: string) =>
    setSections((all) =>
      all.map((x) => {
        if (x.id !== sid) return x;
        const last = x.items[x.items.length - 1];
        return { ...x, items: [...x.items, { id: newId(), text, list: last?.list ?? "bullet", depth: last?.depth ?? 0, kit: null, technique: null, consultant: null }] };
      }),
    );

  const addPart = () => {
    const s: Section = { id: newId(), title: "", depth: 0, items: [] };
    setSections((all) => [...all, s]);
    setRenaming(s.id);
  };

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const a = String(e.active.id);
    const o = String(e.over.id);
    setSections((all) => unflatten(moveRow(flatten(all), a, o)));
  };

  const nameOf = (list: { id: string; name: string }[], id: string | null) => (id ? list.find((x) => x.id === id)?.name : undefined);
  const tags = (it: Item) =>
    [
      !filters.kit && nameOf(content.kits, it.kit),
      !filters.technique && nameOf(content.techniques, it.technique),
      !filters.consultant && nameOf(consultants, it.consultant),
    ].filter(Boolean) as string[];

  // Numbering: main parts count 01, 02…; numbered lines count within their part and level.
  let partNo = 0;
  const lineNo = new Map<string, number>();
  {
    let counters: number[] = [];
    let current = "";
    for (const r of shown) {
      if (r.kind === "s") {
        counters = [];
        current = r.s.id;
        continue;
      }
      if (r.sid !== current) continue;
      counters.length = r.it.depth + 1;
      counters[r.it.depth] = (counters[r.it.depth] ?? 0) + 1;
      lineNo.set(r.it.id, counters[r.it.depth]);
    }
  }

  const menuItem = menu?.kind === "i" ? content.sections.flatMap((s) => s.items).find((it) => it.id === menu.id) : undefined;
  const menuSection = menu?.kind === "s" ? content.sections.find((s) => s.id === menu.id) : undefined;

  return (
    <>
      {!content.sections.length && <p className="empty">No parts yet. Add one below, or ask Claude to draft the steps.</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          <ol className="rows">
            {shown.map((r, idx) => {
              if (r.kind === "s") {
                const s = r.s;
                if (s.depth === 0) partNo += 1;
                const open = !collapsed.has(s.id);
                const empty = open && (!shown[idx + 1] || shown[idx + 1].kind === "s");
                return (
                  <Fragment key={r.id}>
                  <SortableRow id={r.id} className="part" data-depth={s.depth} data-open={open || undefined} onHandle={() => setMenu({ kind: "s", id: s.id })} handleLabel={`Move or change ${s.title || "part"}`}>
                    <div className="part-head">
                      <span className="step-num">{s.depth === 0 ? String(partNo).padStart(2, "0") : "›"}</span>
                      {renaming === s.id ? (
                        <Editable
                          value={s.title}
                          placeholder="Name this part"
                          className="part-title"
                          autoEdit
                          onCommit={(v) => editSection(s.id, { title: v.trim() })}
                          onDone={() => {
                            setRenaming(null);
                            setOpen(s.id, true);
                          }}
                        />
                      ) : (
                        <button type="button" className="part-title" onClick={() => setOpen(s.id, !open)} onDoubleClick={() => setRenaming(s.id)}>
                          {s.title || "Untitled part"}
                        </button>
                      )}
                      <button type="button" className="chev-btn" aria-label={open ? "Close" : "Open"} onClick={() => setOpen(s.id, !open)}>
                        <span className="chev" data-open={open || undefined} />
                      </button>
                    </div>
                  </SortableRow>
                  {empty && <AddLine sid={s.id} onAdd={addLine} />}
                  </Fragment>
                );
              }

              const it = r.it;
              const next = shown[idx + 1];
              const endOfPart = !next || next.kind === "s";
              return (
                <Fragment key={r.id}>
                <SortableRow
                  id={r.id}
                  className="line"
                  data-list={it.list}
                  data-depth={it.depth}
                  onHandle={() => setMenu({ kind: "i", id: it.id })}
                  handleLabel="Move or change this line"
                >
                  <div className="line-body">
                    {it.list === "number" && <span className="item-n">{lineNo.get(it.id)}.</span>}
                    <Editable
                      value={it.text}
                      placeholder="Type here"
                      render={(v) => <Inline>{v}</Inline>}
                      autoEdit={focusId === it.id}
                      ariaLabel="line"
                      onCommit={(v) => (v.trim() ? editItem(it.id, { text: v.trim() }) : removeItem(it.id))}
                      onDone={() => focusId === it.id && setFocusId(null)}
                      onEnter={() => setFocusId(insertAfter(r.sid, it.id, it))}
                      onBackspaceEmpty={() => {
                        const prev = shown[idx - 1];
                        removeItem(it.id);
                        if (prev?.kind === "i") setFocusId(prev.it.id);
                      }}
                      onTab={(shift) => editItem(it.id, { depth: Math.max(0, Math.min(2, it.depth + (shift ? -1 : 1))) })}
                    />
                    {tags(it).map((t) => (
                      <button key={t} type="button" className="cond" onClick={() => setMenu({ kind: "i", id: it.id })}>
                        {t}
                      </button>
                    ))}
                  </div>
                </SortableRow>
                {endOfPart && <AddLine sid={r.sid} onAdd={addLine} />}
                </Fragment>
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
      <button type="button" className="mono-btn add-btn" data-boxed="" onClick={addPart}>
        + Part
      </button>

      {menuItem && (
        <Sheet title="Line" onClose={() => setMenu(null)}>
          <p className="sheet-text">{menuItem.text || "Empty line"}</p>
          <MarkerChoice label="Kit" all="Every kit" list={content.kits} value={menuItem.kit} onChange={(kit) => editItem(menuItem.id, { kit })} />
          <MarkerChoice label="Mode" all="Every mode" list={content.techniques} value={menuItem.technique} onChange={(technique) => editItem(menuItem.id, { technique })} />
          <MarkerChoice label="Consultant" all="Everyone" list={consultants} value={menuItem.consultant} onChange={(consultant) => editItem(menuItem.id, { consultant })} />
          <div className="sheet-row">
            <Choice<ListStyle>
              options={[
                { value: "bullet", label: "• Bullet" },
                { value: "number", label: "1. Numbered" },
              ]}
              value={menuItem.list}
              onChange={(list) => editItem(menuItem.id, { list })}
            />
          </div>
          <div className="sheet-row">
            <div className="chips">
              <button type="button" className="chip" disabled={menuItem.depth === 0} onClick={() => editItem(menuItem.id, { depth: menuItem.depth - 1 })}>
                ← Less indent
              </button>
              <button type="button" className="chip" disabled={menuItem.depth === 2} onClick={() => editItem(menuItem.id, { depth: menuItem.depth + 1 })}>
                Indent →
              </button>
            </div>
          </div>
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                removeItem(menuItem.id);
                setMenu(null);
              }}
            >
              Delete line
            </button>
          </div>
        </Sheet>
      )}

      {menuSection && (
        <Sheet title="Part" onClose={() => setMenu(null)}>
          <input
            id="part-name"
            className="input"
            value={menuSection.title}
            placeholder="Name this part"
            onChange={(e) => editSection(menuSection.id, { title: e.target.value })}
          />
          <div className="sheet-row">
            <Choice<"0" | "1">
              options={[
                { value: "0", label: "Main part" },
                { value: "1", label: "Sub-part of the part above" },
              ]}
              value={menuSection.depth === 1 ? "1" : "0"}
              onChange={(v) => editSection(menuSection.id, { depth: Number(v) })}
            />
          </div>
          <p className="hint">Hold ⋮⋮ and drag to move a part with all its lines.</p>
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                setSections((all) => all.filter((s) => s.id !== menuSection.id));
                setMenu(null);
              }}
            >
              Delete part{menuSection.items.length ? ` and its ${menuSection.items.length} line${menuSection.items.length === 1 ? "" : "s"}` : ""}
            </button>
            <button
              type="button"
              className="mono-btn"
              data-boxed=""
              onClick={() => {
                setOpen(menuSection.id, true);
                setMenu(null);
                setFocusId(insertAfter(menuSection.id, null));
              }}
            >
              + Add line
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function AddLine({ sid, onAdd }: { sid: string; onAdd: (sid: string, text: string) => void }) {
  return (
    <li className="add-row">
      <AddField className="add-line" placeholder="+ Add a line" onAdd={(v) => onAdd(sid, v)} />
    </li>
  );
}

function MarkerChoice({
  label,
  all,
  list,
  value,
  onChange,
}: {
  label: string;
  all: string;
  list: { id: string; name: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  if (!list.length) return null;
  return (
    <div className="sheet-row">
      <p className="label">Only for this {label.toLowerCase()}</p>
      <Choice
        options={[{ value: "", label: all }, ...list.map((x) => ({ value: x.id, label: x.name || "Unnamed" }))]}
        value={value ?? ""}
        onChange={(v) => onChange(v || null)}
      />
    </div>
  );
}

/** A row you can hold and drag by its handle; tapping the handle opens its options. */
export function SortableRow({
  id,
  className,
  onHandle,
  handleLabel,
  children,
  ...data
}: {
  id: string;
  className: string;
  onHandle: () => void;
  handleLabel: string;
  children: React.ReactNode;
  [key: `data-${string}`]: unknown;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      className={className}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...(data as Record<string, string>)}
    >
      <button type="button" ref={setActivatorNodeRef} className="grip" aria-label={handleLabel} onClick={onHandle} {...attributes} {...listeners}>
        <span aria-hidden>⋮⋮</span>
      </button>
      <div className="row-content">{children}</div>
    </li>
  );
}
