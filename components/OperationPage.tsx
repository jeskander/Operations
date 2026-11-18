"use client";

import { useEffect, useState } from "react";
import { newId } from "@/lib/content";
import { visibleBlocks } from "@/lib/blocks";
import type { Consultant, Content, Filters, Operation, OperationFields } from "@/lib/types";
import Editable from "./Editable";
import { KitSheet, Knowledge, Links, OpTech, Videos, type Update } from "./Lists";
import Sheet from "./Sheet";
import dynamic from "next/dynamic";
import Steps from "./Steps";

// The Notion-style editor runs in the browser only.
const BlockEditor = dynamic(() => import("./BlockEditor"), { ssr: false, loading: () => <p className="empty reading">Loading the editor…</p> });

type EditorMode = "notion" | "classic";
const readMode = (): EditorMode => {
  try {
    return localStorage.getItem("op-editor") === "classic" ? "classic" : "notion";
  } catch {
    return "notion";
  }
};

export type Tab = "steps" | "videos" | "links" | "optech" | "knowledge";

const TABS: { id: Tab; label: string }[] = [
  { id: "steps", label: "Steps" },
  { id: "videos", label: "Videos" },
  { id: "links", label: "Links" },
  { id: "optech", label: "Op tech" },
  { id: "knowledge", label: "Knowledge" },
];

type Props = {
  op: Operation;
  /** The groups an operation can be filed under. */
  groups: string[];
  /** Every operation, for [[ links. */
  operations: { id: string; name: string }[];
  onSearch: () => void;
  consultants: Consultant[];
  filters: Filters;
  setFilter: (k: keyof Filters, v: string) => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  /** Change the page; it saves itself. */
  change: (next: OperationFields | ((f: OperationFields) => OperationFields)) => void;
  saveState: "idle" | "saving" | "saved" | "error";
  canUndo: boolean;
  onUndo: () => void;
  onDelete: () => void;
  onBack: () => void;
  addConsultant: (name: string) => Promise<Consultant | null>;
  renameConsultant: (id: string, name: string) => void;
  removeConsultant: (id: string) => void;
};

export default function OperationPage(p: Props) {
  const { op, consultants, filters, tab } = p;
  const c = op.content;
  const [manage, setManage] = useState<{ kind: "kit" | "mode" | "consultant"; id: string } | null>(null);
  const [menu, setMenu] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("notion");
  useEffect(() => setEditorMode(readMode()), []);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const update: Update = (next) => p.change((f) => ({ ...f, content: typeof next === "function" ? next(f.content) : next }));
  const setField = (k: "name" | "subtitle" | "region", v: string) => p.change((f) => ({ ...f, [k]: v }));

  const counts: Record<Tab, number> = {
    steps: visibleBlocks(c.blocks, filters, new Set()).filter((b) => b.depth === 0 && b.type === "toggle").length,
    videos: c.videos.length,
    links: c.links.length,
    optech: c.kits.length,
    knowledge: c.questions.length,
  };

  const addKit = (name: string) => {
    const id = newId();
    update((x) => ({ ...x, kits: [...x.kits, { id, name, maker: "", url: "" }] }));
    p.setFilter("kit", id);
  };
  const addMode = (name: string) => {
    const id = newId();
    update((x) => ({ ...x, techniques: [...x.techniques, { id, name }] }));
    p.setFilter("technique", id);
  };
  const clearRefs = (key: "technique" | "consultant", id: string) => (x: Content): Content => ({
    ...x,
    blocks: x.blocks.map((b) => (b[key] === id ? { ...b, [key]: null } : b)),
  });

  const kit = manage?.kind === "kit" ? c.kits.find((k) => k.id === manage.id) : undefined;
  const mode = manage?.kind === "mode" ? c.techniques.find((t) => t.id === manage.id) : undefined;
  const person = manage?.kind === "consultant" ? consultants.find((x) => x.id === manage.id) : undefined;

  return (
    <>
      <header className="topbar">
        <div className="topbar-primary">
          <button className="back" onClick={p.onBack}>
            ← Operations
          </button>
          <select className="region-select label" aria-label="Group" value={op.region} onChange={(e) => setField("region", e.target.value)}>
            {[...new Set([...p.groups, op.region])].map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
          <h1 className="name">
            <Editable value={op.name} placeholder="Operation name" ariaLabel="name" onCommit={(v) => v.trim() && setField("name", v.trim())} />
          </h1>
          <p className="subtitle">
            <Editable value={op.subtitle} placeholder="Add a line under the name" ariaLabel="subtitle" onCommit={(v) => setField("subtitle", v.trim())} />
          </p>
        </div>
        <div className="topbar-actions">
          <span className="save-state" data-state={p.saveState}>
            {p.saveState === "saving" ? "Saving…" : p.saveState === "saved" ? "Saved" : p.saveState === "error" ? "Not saved" : ""}
          </span>
          {p.canUndo && (
            <button className="mono-btn" onClick={p.onUndo}>
              Undo
            </button>
          )}
          <button className="mono-btn" aria-label="More" onClick={() => setMenu(true)}>
            ···
          </button>
        </div>

        <div className="filters">
          <ChipRow label="Kit" all="All" items={c.kits} value={filters.kit} onSelect={(v) => p.setFilter("kit", v)} onManage={(id) => setManage({ kind: "kit", id })} onAdd={addKit} addLabel="Kit" />
          <ChipRow
            label="Mode"
            all="All"
            items={c.techniques}
            value={filters.technique}
            onSelect={(v) => p.setFilter("technique", v)}
            onManage={(id) => setManage({ kind: "mode", id })}
            onAdd={addMode}
            addLabel="Mode"
          />
          <ChipRow
            label="Consultant"
            all="Anyone"
            items={consultants}
            value={filters.consultant}
            onSelect={(v) => p.setFilter("consultant", v)}
            onManage={(id) => setManage({ kind: "consultant", id })}
            onAdd={async (name) => {
              const made = await p.addConsultant(name);
              if (made) p.setFilter("consultant", made.id);
            }}
            addLabel="Consultant"
          />
        </div>

        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => p.setTab(t.id)}>
              {t.label}
              {counts[t.id] > 0 && <span className="tab-count">{counts[t.id]}</span>}
            </button>
          ))}
        </nav>
      </header>

      <section className="panel">
        {tab === "steps" && (
          <>
            <div className="editor-switch">
              <span className="label">{editorMode === "notion" ? "New editor · test" : "Classic editor"}</span>
              <button
                type="button"
                className="mono-btn"
                onClick={() => {
                  const next = editorMode === "notion" ? "classic" : "notion";
                  setEditorMode(next);
                  try {
                    localStorage.setItem("op-editor", next);
                  } catch {}
                }}
              >
                {editorMode === "notion" ? "Use classic" : "Try the new editor"}
              </button>
            </div>
            {editorMode === "notion" ? (
              <BlockEditor
                key={op.id}
                opId={op.id}
                content={c}
                consultants={consultants}
                filters={filters}
                update={update}
                addConsultant={p.addConsultant}
                operations={p.operations}
                onSearch={p.onSearch}
              />
            ) : (
              <Steps opId={op.id} content={c} consultants={consultants} filters={filters} update={update} addConsultant={p.addConsultant} />
            )}
          </>
        )}
        {tab === "videos" && <Videos content={c} update={update} />}
        {tab === "links" && <Links content={c} update={update} />}
        {tab === "optech" && <OpTech content={c} update={update} />}
        {tab === "knowledge" && <Knowledge content={c} update={update} />}
      </section>

      {kit && <KitSheet kit={kit} update={update} onClose={() => setManage(null)} />}

      {mode && (
        <Sheet title="Mode" onClose={() => setManage(null)}>
          <input
            id="mode-name"
            className="input"
            value={mode.name}
            onChange={(e) => update((x) => ({ ...x, techniques: x.techniques.map((t) => (t.id === mode.id ? { ...t, name: e.target.value } : t)) }))}
          />
          <p className="hint">e.g. Conventional, Robotic (Mako). Lines marked for a mode show only when it&rsquo;s chosen.</p>
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                update((x) => ({ ...clearRefs("technique", mode.id)(x), techniques: x.techniques.filter((t) => t.id !== mode.id) }));
                p.setFilter("technique", "");
                setManage(null);
              }}
            >
              Remove mode
            </button>
          </div>
        </Sheet>
      )}

      {person && (
        <Sheet title="Consultant" onClose={() => setManage(null)}>
          <ConsultantName key={person.id} person={person} onRename={p.renameConsultant} />
          <p className="hint">Consultants are shared by every operation.</p>
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                update(clearRefs("consultant", person.id));
                p.removeConsultant(person.id);
                p.setFilter("consultant", "");
                setManage(null);
              }}
            >
              Remove from all operations
            </button>
          </div>
        </Sheet>
      )}

      {menu && (
        <Sheet
          title={op.name}
          onClose={() => {
            setMenu(false);
            setConfirmDelete(false);
          }}
        >
          <p className="hint">
            Tap any text to change it. Like Notion: type &gt; space for a part, - space for a bullet, 1. space for a numbered list, # space for a heading, and @ to tag a block with a kit, mode or consultant. Enter adds a block, Tab and Shift+Tab nest and un-nest, Backspace at the start turns a block back into text. Hold ⋮⋮ and drag to move a block with everything inside it; tap ⋮⋮ for its menu. Tap a selected chip at the top to rename or remove it.
          </p>
          <div className="sheet-actions">
            {confirmDelete ? (
              <>
                <button type="button" className="mono-btn" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </button>
                <button type="button" className="mono-btn" data-danger="" data-boxed="" onClick={p.onDelete}>
                  Delete for good
                </button>
              </>
            ) : (
              <button type="button" className="mono-btn" data-danger="" onClick={() => setConfirmDelete(true)}>
                Delete operation
              </button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}

function ConsultantName({ person, onRename }: { person: Consultant; onRename: (id: string, name: string) => void }) {
  const [name, setName] = useState(person.name);
  return (
    <input
      id="consultant-name"
      className="input"
      value={name}
      onChange={(e) => setName(e.target.value)}
      onBlur={() => name.trim() && name !== person.name && onRename(person.id, name.trim())}
    />
  );
}

function ChipRow({
  label,
  all,
  items,
  value,
  onSelect,
  onManage,
  onAdd,
  addLabel,
}: {
  label: string;
  all: string;
  items: { id: string; name: string }[];
  value: string;
  onSelect: (id: string) => void;
  onManage: (id: string) => void;
  onAdd: (name: string) => void;
  addLabel: string;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const selected = items.some((x) => x.id === value) ? value : "";
  const add = () => {
    if (name.trim()) onAdd(name.trim());
    setName("");
    setAdding(false);
  };
  return (
    <div className="chip-row">
      <span className="label chip-label">{label}</span>
      <div className="chips">
        {items.length > 0 && (
          <button type="button" className="chip" aria-pressed={!selected} onClick={() => onSelect("")}>
            {all}
          </button>
        )}
        {items.map((x) => (
          <button
            key={x.id}
            type="button"
            className="chip"
            aria-pressed={x.id === selected}
            onClick={() => (x.id === selected ? onManage(x.id) : onSelect(x.id))}
          >
            {x.name || "Unnamed"}
            {x.id === selected && <span className="chip-more" aria-label="options"> ···</span>}
          </button>
        ))}
        {adding ? (
          <input
            className="chip chip-input"
            autoFocus
            value={name}
            placeholder={`${addLabel} name`}
            aria-label={`New ${addLabel.toLowerCase()}`}
            onChange={(e) => setName(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === "Enter") add();
              if (e.key === "Escape") {
                setName("");
                setAdding(false);
              }
            }}
          />
        ) : (
          <button type="button" className="chip chip-add" onClick={() => setAdding(true)} aria-label={`Add ${addLabel.toLowerCase()}`}>
            {items.length ? "+" : `+ ${addLabel}`}
          </button>
        )}
      </div>
    </div>
  );
}
