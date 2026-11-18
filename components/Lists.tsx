"use client";

import { useState } from "react";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { newId } from "@/lib/content";
import type { Content, Kit, Link, Question, Video } from "@/lib/types";
import Editable, { AddField } from "./Editable";
import { Inline, Markdown } from "./Markdown";
import Sheet from "./Sheet";
import { SortableRow } from "./Steps";

export type Update = (next: Content | ((c: Content) => Content)) => void;

function useDrag() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}

function SortableList<T extends { id: string }>({
  items,
  onReorder,
  onHandle,
  row,
}: {
  items: T[];
  onReorder: (items: T[]) => void;
  onHandle: (item: T) => void;
  row: (item: T) => React.ReactNode;
}) {
  const sensors = useDrag();
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const from = items.findIndex((x) => x.id === e.active.id);
    const to = items.findIndex((x) => x.id === e.over!.id);
    if (from >= 0 && to >= 0) onReorder(arrayMove(items, from, to));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        <ul className="rows">
          {items.map((x) => (
            <SortableRow key={x.id} id={x.id} className="list-row" onHandle={() => onHandle(x)} handleLabel="Move or change">
              {row(x)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

export const hostOf = (url: string) => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("youtu")) return "YouTube";
    if (h.includes("vumedi")) return "VuMedi";
    if (h.includes("aofoundation")) return "AO";
    if (h.includes("orthobullets")) return "Orthobullets";
    return h;
  } catch {
    return "";
  }
};

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim()) || /^www\.\S+$/i.test(s.trim());
const withScheme = (s: string) => (/^https?:\/\//i.test(s) ? s.trim() : `https://${s.trim()}`);

/** Look up a link's title and fill it in, unless it was changed meanwhile. */
async function fillTitle(url: string, apply: (title: string, source: string) => void) {
  try {
    const r = await fetch(`/api/title?url=${encodeURIComponent(url)}`);
    const j = (await r.json()) as { title?: string; source?: string };
    if (j.title) apply(j.title, j.source ?? "");
  } catch {}
}

function LinkRow({ href, title, sub, meta }: { href: string; title: string; sub: string; meta: string }) {
  const inner = (
    <>
      <span className="row-main">
        <span className="row-title">{title || href || "Untitled"}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      {meta && <span className="row-meta">{meta}</span>}
    </>
  );
  return href ? (
    <a className="row" href={href} target="_blank" rel="noreferrer">
      {inner}
    </a>
  ) : (
    <div className="row">{inner}</div>
  );
}

function Field({ id, label, value, onChange, placeholder, url }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; url?: boolean }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input id={id} className="input" value={value} placeholder={placeholder} inputMode={url ? "url" : undefined} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

// ---------- Videos ----------

export function Videos({ content, update }: { content: Content; update: Update }) {
  const [editing, setEditing] = useState<string | null>(null);
  const set = (id: string, change: Partial<Video>) => update((c) => ({ ...c, videos: c.videos.map((v) => (v.id === id ? { ...v, ...change } : v)) }));

  const add = (text: string) => {
    const id = newId();
    const url = isUrl(text) ? withScheme(text) : "";
    update((c) => ({ ...c, videos: [...c.videos, { id, title: url ? "" : text, url, source: url ? hostOf(url) : "", note: "", group: "full" }] }));
    if (url) fillTitle(url, (title, source) => update((c) => ({ ...c, videos: c.videos.map((v) => (v.id === id && !v.title ? { ...v, title, source: v.source || source } : v)) })));
  };

  const row = (v: Video) => <LinkRow href={v.url} title={v.title} sub="" meta={v.source || hostOf(v.url)} />;
  const v = content.videos.find((x) => x.id === editing);

  return (
    <>
      <SortableList items={content.videos} onReorder={(videos) => update((c) => ({ ...c, videos }))} onHandle={(x) => setEditing(x.id)} row={row} />
      <AddField className="add-line" placeholder="+ Paste a video link" inputMode="url" onAdd={add} />

      {v && (
        <Sheet title="Video" onClose={() => setEditing(null)}>
          <Field id="v-title" label="Title" value={v.title} onChange={(title) => set(v.id, { title })} />
          <Field id="v-url" label="Link" value={v.url} url onChange={(url) => set(v.id, { url })} />
          <Field id="v-source" label="Source" value={v.source} placeholder="YouTube" onChange={(source) => set(v.id, { source })} />
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                update((c) => ({ ...c, videos: c.videos.filter((x) => x.id !== v.id) }));
                setEditing(null);
              }}
            >
              Delete video
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

// ---------- Links ----------

export function Links({ content, update }: { content: Content; update: Update }) {
  const [editing, setEditing] = useState<string | null>(null);
  const set = (id: string, change: Partial<Link>) => update((c) => ({ ...c, links: c.links.map((l) => (l.id === id ? { ...l, ...change } : l)) }));
  const add = (text: string) => {
    const id = newId();
    const url = isUrl(text) ? withScheme(text) : "";
    update((c) => ({ ...c, links: [...c.links, { id, title: url ? "" : text, url, source: url ? hostOf(url) : "", note: "" }] }));
    if (url) fillTitle(url, (title, source) => update((c) => ({ ...c, links: c.links.map((l) => (l.id === id && !l.title ? { ...l, title, source: l.source || source } : l)) })));
  };
  const l = content.links.find((x) => x.id === editing);
  return (
    <>
      <SortableList
        items={content.links}
        onReorder={(links) => update((c) => ({ ...c, links }))}
        onHandle={(x) => setEditing(x.id)}
        row={(x) => <LinkRow href={x.url} title={x.title} sub={x.note} meta={x.source || hostOf(x.url)} />}
      />
      <AddField className="add-line" placeholder="+ Paste a link, e.g. the AO Surgery Reference page" inputMode="url" onAdd={add} />
      {l && (
        <Sheet title="Link" onClose={() => setEditing(null)}>
          <Field id="l-title" label="Title" value={l.title} onChange={(title) => set(l.id, { title })} />
          <Field id="l-url" label="Link" value={l.url} url onChange={(url) => set(l.id, { url })} />
          <div className="sheet-grid">
            <Field id="l-source" label="Source" value={l.source} placeholder="AO" onChange={(source) => set(l.id, { source })} />
            <Field id="l-note" label="Note" value={l.note} placeholder="e.g. Approach" onChange={(note) => set(l.id, { note })} />
          </div>
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                update((c) => ({ ...c, links: c.links.filter((x) => x.id !== l.id) }));
                setEditing(null);
              }}
            >
              Delete link
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

// ---------- Op tech (kits) ----------

export function KitSheet({ kit, update, onClose }: { kit: Kit; update: Update; onClose: () => void }) {
  const set = (change: Partial<Kit>) => update((c) => ({ ...c, kits: c.kits.map((k) => (k.id === kit.id ? { ...k, ...change } : k)) }));
  return (
    <Sheet title="Kit" onClose={onClose}>
      <Field id="k-name" label="Name" value={kit.name} placeholder="e.g. DePuy Synthes Attune" onChange={(name) => set({ name })} />
      <Field id="k-url" label="Op tech link" value={kit.url} url placeholder="Paste the surgical technique PDF link" onChange={(url) => set({ url })} />
      <div className="sheet-actions">
        <button
          type="button"
          className="mono-btn"
          data-danger=""
          onClick={() => {
            update((c) => ({
              ...c,
              kits: c.kits.filter((k) => k.id !== kit.id),
              blocks: c.blocks.map((b) => (b.kit === kit.id ? { ...b, kit: null } : b)),
            }));
            onClose();
          }}
        >
          Remove kit
        </button>
      </div>
    </Sheet>
  );
}

export function OpTech({ content, update }: { content: Content; update: Update }) {
  const [editing, setEditing] = useState<string | null>(null);
  const kit = content.kits.find((k) => k.id === editing);
  return (
    <>
      <SortableList
        items={content.kits}
        onReorder={(kits) => update((c) => ({ ...c, kits }))}
        onHandle={(k) => setEditing(k.id)}
        row={(k) =>
          k.url ? (
            <LinkRow href={k.url} title={k.name} sub="" meta="↗" />
          ) : (
            <button type="button" className="row row-btn" onClick={() => setEditing(k.id)}>
              <span className="row-main">
                <span className="row-title">{k.name || "Unnamed kit"}</span>
              </span>
            </button>
          )
        }
      />
      <AddField
        className="add-line"
        placeholder="+ Add a kit, e.g. DePuy Synthes Attune"
        onAdd={(name) => {
          const id = newId();
          update((c) => ({ ...c, kits: [...c.kits, { id, name, maker: "", url: "" }] }));
          setEditing(id);
        }}
      />
      {kit && <KitSheet kit={kit} update={update} onClose={() => setEditing(null)} />}
    </>
  );
}

// ---------- Knowledge ----------

export function Knowledge({ content, update }: { content: Content; update: Update }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [answering, setAnswering] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const set = (id: string, change: Partial<Question>) => update((c) => ({ ...c, questions: c.questions.map((q) => (q.id === id ? { ...q, ...change } : q)) }));
  const toggle = (id: string) => {
    const next = new Set(open);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setOpen(next);
  };
  const q = content.questions.find((x) => x.id === editing);

  return (
    <>
      <SortableList
        items={content.questions}
        onReorder={(questions) => update((c) => ({ ...c, questions }))}
        onHandle={(x) => setEditing(x.id)}
        row={(x) => (
          <div className="qa">
            <button type="button" className="q-head" onClick={() => toggle(x.id)}>
              <span className="q-text">
                <Inline>{x.q}</Inline>
              </span>
              <span className="chev" data-open={open.has(x.id) || undefined} />
            </button>
            {open.has(x.id) && (
              <div className="q-body">
                <Editable
                  value={x.a}
                  multiline
                  placeholder="Tap to write the answer"
                  ariaLabel="answer"
                  autoEdit={answering === x.id}
                  onDone={() => answering === x.id && setAnswering(null)}
                  render={(v) => <Markdown>{v}</Markdown>}
                  onCommit={(a) => set(x.id, { a })}
                />
              </div>
            )}
          </div>
        )}
      />
      <AddField
        className="add-line"
        placeholder="+ Add a question"
        onAdd={(text) => {
          const id = newId();
          update((c) => ({ ...c, questions: [...c.questions, { id, q: text, a: "" }] }));
          setOpen(new Set([...open, id]));
          setAnswering(id);
        }}
      />
      {q && (
        <Sheet title="Question" onClose={() => setEditing(null)}>
          <label className="field">
            <span className="label">Question</span>
            <textarea id="q-text" className="textarea" value={q.q} onChange={(e) => set(q.id, { q: e.target.value })} />
          </label>
          <label className="field">
            <span className="label">Answer</span>
            <textarea id="q-answer" className="textarea" value={q.a} onChange={(e) => set(q.id, { a: e.target.value })} />
          </label>
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                update((c) => ({ ...c, questions: c.questions.filter((x) => x.id !== q.id) }));
                setEditing(null);
              }}
            >
              Delete question
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
