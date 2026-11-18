"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { contentToNote, noteLines } from "@/lib/note";
import type { Consultant, Operation, OperationFields } from "@/lib/types";
import Editable from "./Editable";
import Sheet from "./Sheet";
import type { Version } from "./VersionSwitch";

const NoteEditor = dynamic(() => import("./NoteEditor"), { ssr: false, loading: () => <p className="empty reading">Loading…</p> });

type Props = {
  op: Operation;
  consultants: Consultant[];
  groups: string[];
  change: (next: OperationFields | ((f: OperationFields) => OperationFields)) => void;
  saveState: "idle" | "saving" | "saved" | "error";
  canUndo: boolean;
  onUndo: () => void;
  onDelete: () => void;
  onBack: () => void;
  version: Version;
  onVersion: (v: Version) => void;
};

/** The simple version: the operation's name and one note. */
export default function SimplePage(p: Props) {
  const { op } = p;
  const [menu, setMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Until the note is first written, it starts from everything on the full page.
  const note = useMemo(() => op.content.note || contentToNote(op.content, p.consultants), [op.content, p.consultants]);
  const setField = (k: "name" | "region", v: string) => p.change((f) => ({ ...f, [k]: v }));

  return (
    <>
      <header className="topbar simple-top">
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
      </header>

      <section className="panel simple-panel">
        <NoteEditor key={op.id} value={note} onChange={(html) => p.change((f) => ({ ...f, content: { ...f.content, note: html } }))} />
      </section>

      {menu && (
        <Sheet
          title={op.name}
          onClose={() => {
            setMenu(false);
            setConfirmDelete(false);
          }}
        >
          <p className="hint">
            Type &gt; space for a toggle, - space for bullets, 1. space for numbers, # space for a heading. Cmd+B / I / U for bold, italic and underline; Tab and
            Shift+Tab indent a list. Or ask Claude below.
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

/** Claude's change to the note, shown before anything is saved. */
export function NoteProposalSheet({
  instruction,
  summary,
  before,
  after,
  onAccept,
  onDiscard,
}: {
  instruction: string;
  summary: string[];
  before: string;
  after: string;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  const a = noteLines(before);
  const b = noteLines(after);
  const inA = new Set(a);
  const inB = new Set(b);
  const lines = [...a.filter((l) => !inB.has(l)).map((text) => ({ kind: "del", text })), ...b.filter((l) => !inA.has(l)).map((text) => ({ kind: "add", text }))];
  return (
    <div className="proposal" role="dialog" aria-modal="true" aria-label="Claude's change">
      <div className="proposal-card">
        <p className="label">Claude&rsquo;s change</p>
        <p className="proposal-asked">“{instruction}”</p>
        {summary.length > 0 && (
          <ul className="summary-list">
            {summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
        {lines.length ? (
          <div className="diff-group">
            {lines.map((l, i) => (
              <div key={i} className="diff-line" data-kind={l.kind}>
                <span className="diff-sign">{l.kind === "add" ? "+" : "−"}</span>
                <span>{l.text}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">{after === before ? "Nothing in the note changes." : "Only the layout changes (order, headings or toggles)."}</p>
        )}
        <div className="proposal-actions">
          <button type="button" className="mono-btn" onClick={onDiscard}>
            {after === before ? "Close" : "Discard"}
          </button>
          {after !== before && (
            <button type="button" className="mono-btn" data-primary="" onClick={onAccept}>
              Accept
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
