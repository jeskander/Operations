"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { duplicate, indent, moveBlock, numbering, outdent, removeBlock, removeSubtree, shortcut, subtreeEnd, visibleBlocks } from "@/lib/blocks";
import { newId } from "@/lib/content";
import type { Block, BlockType, Consultant, Content, Filters } from "@/lib/types";
import { Inline } from "./Markdown";
import Sheet, { Choice } from "./Sheet";

type Update = (next: Content | ((c: Content) => Content)) => void;
type Caret = number | "end";
type TagKind = "kit" | "technique" | "consultant";
type Option = { kind: TagKind; id: string | null; name: string; label: string };

const KIND_LABEL: Record<TagKind, string> = { kit: "Kit", technique: "Mode", consultant: "Consultant" };

export const TYPES: { value: BlockType; label: string }[] = [
  { value: "toggle", label: "▸ Part" },
  { value: "bullet", label: "• Bullet" },
  { value: "number", label: "1. Numbered" },
  { value: "text", label: "Text" },
  { value: "heading", label: "Heading" },
];

const blank = (type: BlockType, depth: number, text = ""): Block => ({ id: newId(), type, text, depth, kit: null, technique: null, consultant: null });

function readClosed(opId: string, blocks: Block[]): Set<string> {
  try {
    const saved = localStorage.getItem(`op-closed-${opId}`);
    if (saved) return new Set(JSON.parse(saved) as string[]);
  } catch {}
  // First visit: the first part open, the others closed.
  return new Set(blocks.filter((b) => b.type === "toggle" && b.depth === 0).slice(1).map((b) => b.id));
}

type Props = {
  opId: string;
  content: Content;
  consultants: Consultant[];
  filters: Filters;
  update: Update;
  addConsultant: (name: string) => Promise<Consultant | null>;
};

export default function Steps({ opId, content, consultants, filters, update, addConsultant }: Props) {
  const blocks = content.blocks;
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<{ id: string; caret: Caret } | null>(null);
  const [draft, setDraftState] = useState<{ id: string; text: string } | null>(null);
  const [picker, setPicker] = useState<{ id: string; start: number; query: string; index: number } | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const draftRef = useRef(draft);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputs = useRef(new Map<string, HTMLTextAreaElement>());

  const setDraft = (d: { id: string; text: string } | null) => {
    draftRef.current = d;
    setDraftState(d);
  };

  useEffect(() => setClosed(readClosed(opId, blocks)), [opId]); // eslint-disable-line react-hooks/exhaustive-deps

  const setOpen = (id: string, open: boolean) => {
    setClosed((prev) => {
      const next = new Set(prev);
      if (open) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(`op-closed-${opId}`, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  // Typing stays local and is saved when you pause, leave the block or change its structure.
  const withDraft = (b: Block[]) => {
    const d = draftRef.current;
    return d ? b.map((x) => (x.id === d.id && x.text !== d.text ? { ...x, text: d.text } : x)) : b;
  };
  const setBlocks = (fn: (b: Block[]) => Block[]) => {
    if (idle.current) clearTimeout(idle.current);
    update((c) => ({ ...c, blocks: fn(withDraft(c.blocks)) }));
  };
  const commit = () => {
    if (idle.current) clearTimeout(idle.current);
    if (draftRef.current) update((c) => ({ ...c, blocks: withDraft(c.blocks) }));
  };

  const shown = useMemo(() => visibleBlocks(blocks, filters, closed), [blocks, filters, closed]);
  const numbers = useMemo(() => numbering(shown), [shown]);

  // Body flag so the phone toolbar can replace the Claude bar while typing.
  useEffect(() => {
    if (focus) document.body.dataset.editing = "";
    else delete document.body.dataset.editing;
    return () => {
      delete document.body.dataset.editing;
    };
  }, [focus]);

  // Put the caret where it belongs when a block gains focus.
  useLayoutEffect(() => {
    if (!focus) return;
    const el = inputs.current.get(focus.id);
    if (!el) return;
    if (document.activeElement !== el) el.focus();
    const at = focus.caret === "end" ? el.value.length : Math.min(focus.caret, el.value.length);
    el.setSelectionRange(at, at);
  }, [focus]);

  const startEditing = (id: string, text: string, caret: Caret) => {
    setDraft({ id, text });
    setFocus({ id, caret });
  };

  const focusBlock = (id: string, caret: Caret = "end") => {
    if (draftRef.current?.id !== id) {
      commit();
      const b = blocks.find((x) => x.id === id);
      setDraft(b ? { id, text: b.text } : null);
    }
    setFocus({ id, caret });
  };

  const blur = () => {
    commit();
    setDraft(null);
    setFocus(null);
    setPicker(null);
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const a = String(e.active.id);
    const o = String(e.over.id);
    setBlocks((b) => moveBlock(b, a, o));
  };

  // ---------- @ tags ----------

  const options = (query: string): Option[] => {
    const q = query.trim().toLowerCase();
    const all: Option[] = [
      ...content.kits.map((k) => ({ kind: "kit" as const, id: k.id, name: k.name, label: k.name })),
      ...content.techniques.map((t) => ({ kind: "technique" as const, id: t.id, name: t.name, label: t.name })),
      ...consultants.map((p) => ({ kind: "consultant" as const, id: p.id, name: p.name, label: p.name })),
    ].filter((o) => !q || o.name.toLowerCase().includes(q));
    if (q && !all.some((o) => o.name.toLowerCase() === q)) {
      const name = query.trim();
      for (const kind of ["kit", "technique", "consultant"] as TagKind[]) all.push({ kind, id: null, name, label: `New ${KIND_LABEL[kind].toLowerCase()} “${name}”` });
    }
    return all.slice(0, 12);
  };

  const applyTag = async (blockId: string, o: Option) => {
    const d = draftRef.current;
    const p = picker;
    setPicker(null);
    // Take the "@query" out of the text.
    if (d && p && d.id === blockId) {
      const head = d.text.slice(0, p.start);
      const tail = d.text.slice(p.start + 1 + p.query.length);
      const text = (tail.trim() ? head + tail : head.trimEnd()).replace(/ {2,}/g, " ");
      startEditing(blockId, text, p.start);
    }
    let id = o.id;
    if (!id && o.kind === "consultant") {
      const made = await addConsultant(o.name);
      if (!made) return;
      id = made.id;
    }
    const tagId = id ?? newId();
    if (!id && o.kind === "kit") update((c) => ({ ...c, kits: [...c.kits, { id: tagId, name: o.name, maker: "", url: "" }] }));
    if (!id && o.kind === "technique") update((c) => ({ ...c, techniques: [...c.techniques, { id: tagId, name: o.name }] }));
    setBlocks((b) => b.map((x) => (x.id === blockId ? { ...x, [o.kind]: tagId } : x)));
  };

  // ---------- Typing ----------

  const onChange = (b: Block, el: HTMLTextAreaElement) => {
    const text = el.value;
    const caret = el.selectionStart ?? text.length;
    // Notion's shortcuts: "- ", "1. ", "> ", "# " at the start turn the block into that type.
    const sc = shortcut(text);
    if (sc && caret === text.length - sc.rest.length) {
      setDraft({ id: b.id, text: sc.rest });
      setBlocks((all) => all.map((x) => (x.id === b.id ? { ...x, type: sc.type } : x)));
      if (sc.type === "toggle") setOpen(b.id, true);
      setFocus({ id: b.id, caret: 0 });
      return;
    }
    setDraft({ id: b.id, text });
    const at = text.slice(0, caret).match(/(^|\s)@([^@\n]{0,30})$/);
    setPicker(at ? { id: b.id, start: caret - at[2].length - 1, query: at[2], index: 0 } : null);
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(commit, 1500);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>, b: Block) => {
    const el = e.currentTarget;
    const text = el.value;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;

    if (picker && picker.id === b.id) {
      const opts = options(picker.query);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = opts.length || 1;
        setPicker({ ...picker, index: (picker.index + (e.key === "ArrowDown" ? 1 : n - 1)) % n });
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && opts[picker.index]) {
        e.preventDefault();
        applyTag(b.id, opts[picker.index]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setPicker(null);
        return;
      }
    }

    const idx = shown.findIndex((x) => x.id === b.id);

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // Enter on an empty list item turns it back into text, or brings it out a level.
      if (!text && (b.type === "bullet" || b.type === "number")) {
        setBlocks((all) => (b.depth > 0 ? outdent(all, b.id) : all.map((x) => (x.id === b.id ? { ...x, type: "text" } : x))));
        return;
      }
      const before = text.slice(0, start);
      const after = text.slice(end);
      const i = blocks.findIndex((x) => x.id === b.id);
      const hasKids = subtreeEnd(blocks, i) > i + 1;
      const open = !closed.has(b.id);
      // Like Notion: a new line inside an open part, a new part after a closed one, the same kind of line otherwise.
      const made =
        b.type === "toggle" && open
          ? blank("bullet", b.depth + 1, after)
          : b.type === "toggle"
            ? blank("toggle", b.depth, after)
            : b.type === "heading"
              ? blank("text", b.depth, after)
              : blank(b.type, hasKids ? b.depth + 1 : b.depth, after);
      setDraft({ id: b.id, text: before });
      setBlocks((all) => {
        const j = all.findIndex((x) => x.id === b.id);
        const at = b.type === "toggle" && !open ? subtreeEnd(all, j) : b.type === "heading" ? subtreeEnd(all, j) : j + 1;
        const out = [...all];
        out.splice(at, 0, made);
        return out;
      });
      startEditing(made.id, after, 0);
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      setBlocks((all) => (e.shiftKey ? outdent(all, b.id) : indent(all, b.id)));
      setFocus({ id: b.id, caret: start });
      return;
    }

    if (e.key === "Backspace" && start === 0 && end === 0) {
      if (b.type !== "text") {
        // The first Backspace turns a bullet, number, part or heading back into text.
        e.preventDefault();
        setBlocks((all) => all.map((x) => (x.id === b.id ? { ...x, type: "text" } : x)));
        return;
      }
      const prev = shown[idx - 1];
      if (!prev) return;
      e.preventDefault();
      // Join this block onto the end of the one above.
      const joined = prev.text + text;
      setDraft(null);
      setBlocks((all) => removeBlock(all, b.id).map((x) => (x.id === prev.id ? { ...x, text: joined } : x)));
      startEditing(prev.id, joined, prev.text.length);
      return;
    }

    if (e.key === "ArrowUp" && start === 0 && end === 0 && shown[idx - 1]) {
      e.preventDefault();
      focusBlock(shown[idx - 1].id, "end");
      return;
    }
    if (e.key === "ArrowDown" && start === text.length && shown[idx + 1]) {
      e.preventDefault();
      focusBlock(shown[idx + 1].id, 0);
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      el.blur();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
      e.preventDefault();
      let copyId = "";
      setBlocks((all) => {
        const r = duplicate(all, b.id, newId);
        copyId = r.copyId;
        return r.blocks;
      });
      if (copyId) startEditing(copyId, text, "end");
    }
  };

  // ---------- Block actions (menu and phone toolbar) ----------

  const setType = (id: string, type: BlockType) => {
    setBlocks((all) => all.map((x) => (x.id === id ? { ...x, type } : x)));
    if (type === "toggle") setOpen(id, true);
  };
  const setTag = (id: string, kind: TagKind, value: string | null) => setBlocks((all) => all.map((x) => (x.id === id ? { ...x, [kind]: value } : x)));

  const addAtEnd = () => {
    const last = blocks[blocks.length - 1];
    const inPart = last && !closed.has(blocks.filter((x) => x.depth === 0).pop()?.id ?? "") && blocks.some((x) => x.type === "toggle" && x.depth === 0);
    const b = inPart ? blank("bullet", 1) : blank("toggle", 0);
    setBlocks((all) => [...all, b]);
    startEditing(b.id, "", 0);
  };

  const tagNames = (b: Block) =>
    [
      !filters.kit && content.kits.find((k) => k.id === b.kit)?.name,
      !filters.technique && content.techniques.find((t) => t.id === b.technique)?.name,
      !filters.consultant && consultants.find((c) => c.id === b.consultant)?.name,
    ].filter(Boolean) as string[];

  const menuBlock = menu ? blocks.find((b) => b.id === menu) : undefined;
  const focused = focus ? blocks.find((b) => b.id === focus.id) : undefined;
  let partNo = 0;

  return (
    <>
      {!blocks.length && (
        <p className="empty">
          Nothing here yet. Tap <em>+ Add a block</em>, then type <em>&gt; space</em> for a part, <em>- space</em> for a bullet, <em>@</em> to tag.
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={shown.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          <ol className="blocks">
            {shown.map((b) => {
              const isPart = b.type === "toggle" && b.depth === 0;
              if (isPart) partNo += 1;
              const open = !closed.has(b.id);
              const editing = focus?.id === b.id;
              const value = editing && draft?.id === b.id ? draft.text : b.text;
              const pick = picker?.id === b.id ? options(picker.query) : null;
              return (
                <SortableRow
                  key={b.id}
                  id={b.id}
                  className="block"
                  data-type={b.type}
                  data-part={isPart || undefined}
                  onHandle={() => {
                    blur();
                    setMenu(b.id);
                  }}
                  handleLabel="Drag to move, tap for options"
                  style={{ "--depth": b.depth } as React.CSSProperties}
                >
                  <div className="block-line">
                    {isPart && (
                      <button type="button" className="step-num" onClick={() => setOpen(b.id, !open)} aria-label={open ? "Close part" : "Open part"}>
                        {String(partNo).padStart(2, "0")}
                      </button>
                    )}
                    {b.type === "toggle" && !isPart && (
                      <button type="button" className="tri" data-open={open || undefined} onClick={() => setOpen(b.id, !open)} aria-label={open ? "Close" : "Open"}>
                        ▸
                      </button>
                    )}
                    {b.type === "bullet" && <span className="marker">•</span>}
                    {b.type === "number" && <span className="marker num">{numbers.get(b.id)}.</span>}
                    <div className="block-text">
                      {editing ? (
                        <textarea
                          ref={(el) => {
                            if (el) inputs.current.set(b.id, el);
                            else inputs.current.delete(b.id);
                          }}
                          className="block-input"
                          rows={1}
                          value={value}
                          placeholder={b.type === "toggle" ? "Part name" : "Type > for a part, - for a bullet, @ to tag"}
                          aria-label="Block text"
                          onChange={(e) => onChange(b, e.currentTarget)}
                          onKeyDown={(e) => onKeyDown(e, b)}
                          onBlur={(e) => {
                            // Moving to the phone toolbar or the tag list keeps the block open.
                            const to = e.relatedTarget as HTMLElement | null;
                            if (to?.closest(".kb-bar, .picker")) return;
                            if (focus?.id === b.id) blur();
                          }}
                        />
                      ) : (
                        <span
                          className="block-view"
                          data-empty={b.text ? undefined : ""}
                          onClick={(e) => {
                            if ((e.target as HTMLElement).closest("a")) return;
                            focusBlock(b.id, "end");
                          }}
                        >
                          {b.text ? <Inline>{b.text}</Inline> : b.type === "toggle" ? "Untitled part" : " "}
                        </span>
                      )}
                      {tagNames(b).map((t) => (
                        <button key={t} type="button" className="cond" onClick={() => setMenu(b.id)}>
                          {t}
                        </button>
                      ))}
                    </div>
                    {isPart && (
                      <button type="button" className="chev-btn" aria-label={open ? "Close part" : "Open part"} onClick={() => setOpen(b.id, !open)}>
                        <span className="chev" data-open={open || undefined} />
                      </button>
                    )}
                  </div>
                  {pick && (
                    <div className="picker" role="listbox" aria-label="Tag this block">
                      {pick.length ? (
                        pick.map((o, i) => (
                          <button
                            key={`${o.kind}-${o.id ?? o.name}`}
                            type="button"
                            role="option"
                            aria-selected={i === picker!.index}
                            className="picker-item"
                            onPointerDown={(e) => e.preventDefault()}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => applyTag(b.id, o)}
                          >
                            <span className="picker-kind">{KIND_LABEL[o.kind]}</span>
                            <span>{o.label}</span>
                          </button>
                        ))
                      ) : (
                        <p className="picker-empty">Type a name to add a kit, mode or consultant</p>
                      )}
                    </div>
                  )}
                </SortableRow>
              );
            })}
          </ol>
        </SortableContext>
      </DndContext>
      <button type="button" className="add-block" onClick={addAtEnd}>
        + Add a block
      </button>

      {focused && (
        <KeyboardBar
          block={focused}
          onIndent={() => setBlocks((all) => indent(all, focused.id))}
          onOutdent={() => setBlocks((all) => outdent(all, focused.id))}
          onType={(t) => setType(focused.id, focused.type === t ? "text" : t)}
          onTag={() => {
            const el = inputs.current.get(focused.id);
            if (!el) return;
            const at = el.selectionStart ?? el.value.length;
            const head = el.value.slice(0, at);
            const insert = head && !/\s$/.test(head) ? " @" : "@";
            const text = head + insert + el.value.slice(at);
            const caret = at + insert.length;
            setDraft({ id: focused.id, text });
            setPicker({ id: focused.id, start: caret - 1, query: "", index: 0 });
            setFocus({ id: focused.id, caret });
          }}
          onMenu={() => {
            const id = focused.id;
            blur();
            setMenu(id);
          }}
          onDone={blur}
        />
      )}

      {menuBlock && (
        <Sheet title="Block" onClose={() => setMenu(null)}>
          <textarea
            id="block-text"
            className="textarea"
            value={menuBlock.text}
            placeholder="Text"
            onChange={(e) => {
              const text = e.target.value;
              setBlocks((all) => all.map((x) => (x.id === menuBlock.id ? { ...x, text } : x)));
            }}
          />
          <div className="sheet-row">
            <p className="label">Turn into</p>
            <Choice<BlockType> options={TYPES} value={menuBlock.type} onChange={(t) => setType(menuBlock.id, t)} />
          </div>
          <div className="sheet-row">
            <div className="chips">
              <button type="button" className="chip" disabled={menuBlock.depth === 0} onClick={() => setBlocks((all) => outdent(all, menuBlock.id))}>
                ⇤ Unindent
              </button>
              <button type="button" className="chip" onClick={() => setBlocks((all) => indent(all, menuBlock.id))}>
                Indent ⇥
              </button>
            </div>
          </div>
          <TagChoice label="Kit" all="Every kit" list={content.kits} value={menuBlock.kit} onChange={(v) => setTag(menuBlock.id, "kit", v)} />
          <TagChoice label="Mode" all="Every mode" list={content.techniques} value={menuBlock.technique} onChange={(v) => setTag(menuBlock.id, "technique", v)} />
          <TagChoice label="Consultant" all="Everyone" list={consultants} value={menuBlock.consultant} onChange={(v) => setTag(menuBlock.id, "consultant", v)} />
          {menuBlock.type === "toggle" && <p className="hint">A tag on a part applies to everything inside it.</p>}
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                setBlocks((all) => removeSubtree(all, menuBlock.id));
                setMenu(null);
              }}
            >
              Delete
              {(() => {
                const i = blocks.findIndex((x) => x.id === menuBlock.id);
                const inside = subtreeEnd(blocks, i) - i - 1;
                return inside ? ` with ${inside} inside` : "";
              })()}
            </button>
            <button
              type="button"
              className="mono-btn"
              data-boxed=""
              onClick={() => {
                setBlocks((all) => duplicate(all, menuBlock.id, newId).blocks);
                setMenu(null);
              }}
            >
              Duplicate
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

function TagChoice({ label, all, list, value, onChange }: { label: string; all: string; list: { id: string; name: string }[]; value: string | null; onChange: (v: string | null) => void }) {
  if (!list.length) return null;
  return (
    <div className="sheet-row">
      <p className="label">Only for this {label.toLowerCase()}</p>
      <Choice options={[{ value: "", label: all }, ...list.map((x) => ({ value: x.id, label: x.name || "Unnamed" }))]} value={value ?? ""} onChange={(v) => onChange(v || null)} />
    </div>
  );
}

/** Above the phone keyboard: the keys a phone doesn't have. Tapping keeps the keyboard up. */
function KeyboardBar({
  block,
  onIndent,
  onOutdent,
  onType,
  onTag,
  onMenu,
  onDone,
}: {
  block: Block;
  onIndent: () => void;
  onOutdent: () => void;
  onType: (t: BlockType) => void;
  onTag: () => void;
  onMenu: () => void;
  onDone: () => void;
}) {
  const [bottom, setBottom] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const place = () => setBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    place();
    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
    };
  }, []);
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const key = (label: string, aria: string, on: () => void, pressed?: boolean) => (
    <button type="button" className="kb-key" aria-label={aria} aria-pressed={pressed} onPointerDown={keep} onMouseDown={keep} onClick={on}>
      {label}
    </button>
  );
  return (
    <div className="kb-bar" style={{ bottom }}>
      {key("⇤", "Unindent", onOutdent)}
      {key("⇥", "Indent", onIndent)}
      {key("@", "Tag", onTag)}
      {key("▸", "Part", () => onType("toggle"), block.type === "toggle")}
      {key("•", "Bullet", () => onType("bullet"), block.type === "bullet")}
      {key("1.", "Numbered", () => onType("number"), block.type === "number")}
      {key("⋯", "More", onMenu)}
      <button type="button" className="kb-key kb-done" onPointerDown={keep} onMouseDown={keep} onClick={onDone}>
        Done
      </button>
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
  style,
  ...data
}: {
  id: string;
  className: string;
  onHandle: () => void;
  handleLabel: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  [key: `data-${string}`]: unknown;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <li
      ref={setNodeRef}
      className={className}
      data-dragging={isDragging || undefined}
      style={{ ...style, transform: CSS.Translate.toString(transform), transition }}
      {...(data as Record<string, string>)}
    >
      <button type="button" ref={setActivatorNodeRef} className="grip" aria-label={handleLabel} onClick={onHandle} {...attributes} {...listeners}>
        <span aria-hidden>⋮⋮</span>
      </button>
      <div className="row-content">{children}</div>
    </li>
  );
}
