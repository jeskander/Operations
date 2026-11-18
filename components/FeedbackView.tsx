"use client";

import { useState } from "react";
import type { Feedback, Priority } from "@/lib/types";
import Editable from "./Editable";
import { Markdown } from "./Markdown";

const PRIORITIES: Priority[] = ["P1", "P2", "P3"];
const next = (p: Priority): Priority => PRIORITIES[(PRIORITIES.indexOf(p) + 1) % 3];

type Props = {
  items: Feedback[] | null;
  onAdd: (text: string, priority: Priority) => void;
  onUpdate: (id: string, patch: { priority?: Priority; done?: boolean; text?: string }) => void;
  onDelete: (id: string) => void;
  onBack: () => void;
};

/** Your own checklist of problems with the app and changes you'd like, by priority. */
export default function FeedbackView({ items, onAdd, onUpdate, onDelete, onBack }: Props) {
  const [priority, setPriority] = useState<Priority>("P2");
  const [text, setText] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const add = () => {
    if (!text.trim()) return;
    onAdd(text.trim(), priority);
    setText("");
  };

  const open = (items ?? []).filter((f) => !f.doneAt).sort((a, b) => a.priority.localeCompare(b.priority) || b.createdAt.localeCompare(a.createdAt));
  const done = (items ?? []).filter((f) => f.doneAt).sort((a, b) => b.doneAt!.localeCompare(a.doneAt!));

  const row = (f: Feedback) => (
    <li key={f.id} className="feedback-item" data-done={f.doneAt ? "" : undefined}>
      <input type="checkbox" className="feedback-check" checked={!!f.doneAt} aria-label={f.doneAt ? "Mark not done" : "Mark done"} onChange={(e) => onUpdate(f.id, { done: e.target.checked })} />
      <button className="priority" data-priority={f.priority} title="Change priority" onClick={() => onUpdate(f.id, { priority: next(f.priority) })}>
        {f.priority}
      </button>
      <div className="feedback-body">
        <Editable value={f.text} multiline ariaLabel="feedback" render={(v) => <Markdown>{v}</Markdown>} onCommit={(v) => v.trim() && onUpdate(f.id, { text: v.trim() })} />
      </div>
      <button className="mono-btn" onClick={() => (confirming === f.id ? onDelete(f.id) : setConfirming(f.id))} onBlur={() => setConfirming(null)}>
        {confirming === f.id ? "Confirm" : "Delete"}
      </button>
    </li>
  );

  return (
    <>
      <header className="topbar">
        <div className="topbar-primary">
          <button className="back" onClick={onBack}>
            ← Operations
          </button>
          <h1 className="page-title">Feedback</h1>
          <p className="subtitle">Problems and changes you&rsquo;d like in this app. From any Claude bar, start with &ldquo;feedback:&rdquo; to add one.</p>
        </div>
      </header>
      <section className="panel feedback">
        <div className="feedback-add">
          <textarea
            id="feedback-new"
            className="textarea"
            placeholder="A problem, or a change you'd like."
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
          />
          <div className="feedback-add-row">
            <div className="priority-picker" role="radiogroup" aria-label="Priority">
              {PRIORITIES.map((p) => (
                <button key={p} role="radio" aria-checked={priority === p} className="priority" data-priority={p} onClick={() => setPriority(p)}>
                  {p}
                </button>
              ))}
            </div>
            <button className="mono-btn" data-primary="" disabled={!text.trim()} onClick={add}>
              Add
            </button>
          </div>
        </div>
        {!items && <p className="empty reading">Loading…</p>}
        {items && !open.length && <p className="empty">Nothing open.</p>}
        <ul className="feedback-list">{open.map(row)}</ul>
        {done.length > 0 && (
          <details className="feedback-done">
            <summary className="label">Done · {done.length}</summary>
            <ul className="feedback-list">{done.map(row)}</ul>
          </details>
        )}
      </section>
    </>
  );
}
