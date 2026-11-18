"use client";

import { useState } from "react";
import { REGIONS, itemsToText, markersFor, newId, textToItems } from "@/lib/content";
import type { Consultant, Kit, Link, Operation, OperationFields, Question, Technique, Video } from "@/lib/types";
import type { Tab } from "./OperationView";

type DraftSection = { id: string; title: string; text: string };

export type Draft = {
  name: string;
  region: string;
  subtitle: string;
  kits: Kit[];
  techniques: Technique[];
  sections: DraftSection[];
  videos: Video[];
  links: Link[];
  questions: Question[];
};

export function toDraft(op: Operation, consultants: Consultant[]): Draft {
  const m = markersFor(op.content, consultants);
  return {
    name: op.name,
    region: op.region,
    subtitle: op.subtitle,
    kits: op.content.kits.map((k) => ({ ...k })),
    techniques: op.content.techniques.map((t) => ({ ...t })),
    sections: op.content.sections.map((s) => ({ id: s.id, title: s.title, text: itemsToText(s.items, m) })),
    videos: op.content.videos.map((v) => ({ ...v })),
    links: op.content.links.map((l) => ({ ...l })),
    questions: op.content.questions.map((q) => ({ ...q })),
  };
}

export function fromDraft(d: Draft, op: Operation, consultants: Consultant[]): OperationFields {
  const kits = d.kits.filter((k) => k.name.trim() || k.url.trim());
  const techniques = d.techniques.filter((t) => t.name.trim());
  const m = { kits, techniques, consultants };
  return {
    name: d.name,
    region: d.region,
    subtitle: d.subtitle,
    content: {
      kits,
      techniques,
      sections: d.sections
        .filter((s) => s.title.trim() || s.text.trim())
        .map((s) => ({ id: s.id, title: s.title.trim() || "Untitled", items: textToItems(s.text, op.content.sections.find((x) => x.id === s.id)?.items ?? [], m) })),
      videos: d.videos.filter((v) => v.title.trim() || v.url.trim()),
      links: d.links.filter((l) => l.title.trim() || l.url.trim()),
      questions: d.questions.filter((q) => q.q.trim()),
    },
  };
}

function move<T>(list: T[], i: number, by: number): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

function Tools({ onUp, onDown, onRemove }: { onUp: () => void; onDown: () => void; onRemove: () => void }) {
  return (
    <span className="edit-tools">
      <button type="button" className="mono-btn" aria-label="Move up" onClick={onUp}>
        ↑
      </button>
      <button type="button" className="mono-btn" aria-label="Move down" onClick={onDown}>
        ↓
      </button>
      <button type="button" className="mono-btn" aria-label="Remove" onClick={onRemove}>
        ✕
      </button>
    </span>
  );
}

/** The header fields while editing: name, region, subtitle. */
export function EditHead({ draft, set }: { draft: Draft; set: (d: Draft) => void }) {
  return (
    <div className="edit-head">
      <label className="field">
        <span className="label">Name</span>
        <input id="ed-name" className="input name-input" value={draft.name} onChange={(e) => set({ ...draft, name: e.target.value })} />
      </label>
      <label className="field">
        <span className="label">Group</span>
        <select id="ed-region" className="select" value={draft.region} onChange={(e) => set({ ...draft, region: e.target.value })}>
          {[...new Set([...REGIONS, draft.region])].map((r) => (
            <option key={r}>{r}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span className="label">Under the name</span>
        <input id="ed-sub" className="input" value={draft.subtitle} placeholder="e.g. Attune · Medacta · Mako" onChange={(e) => set({ ...draft, subtitle: e.target.value })} />
      </label>
    </div>
  );
}

type Props = { draft: Draft; set: (d: Draft) => void; tab: Tab; consultants: Consultant[] };

/** One tab of the page, editable by hand. */
export function EditPanel({ draft, set, tab, consultants }: Props) {
  if (tab === "steps") {
    const markers = [...draft.kits.map((k) => k.name), ...draft.techniques.map((t) => t.name), ...consultants.map((c) => c.name)].filter(Boolean);
    const up = (i: number, s: Partial<DraftSection>) => set({ ...draft, sections: draft.sections.map((x, j) => (j === i ? { ...x, ...s } : x)) });
    return (
      <>
        <p className="hint">
          One line each. <code>- </code> bullet, <code>1. </code> numbered, two spaces in front to indent.
          {markers.length > 0 && (
            <>
              {" "}
              End a line with {markers.slice(0, 4).map((m, i) => <code key={i}>[{m}]</code>)} to show it only for that one.
            </>
          )}
        </p>
        {draft.sections.map((s, i) => (
          <div key={s.id} className="edit-block">
            <div className="edit-row">
              <input id={`sec-${s.id}`} className="input" value={s.title} placeholder="Section title" onChange={(e) => up(i, { title: e.target.value })} />
              <Tools
                onUp={() => set({ ...draft, sections: move(draft.sections, i, -1) })}
                onDown={() => set({ ...draft, sections: move(draft.sections, i, 1) })}
                onRemove={() => set({ ...draft, sections: draft.sections.filter((_, j) => j !== i) })}
              />
            </div>
            <textarea id={`sec-text-${s.id}`} className="textarea" data-mono="" value={s.text} placeholder="- First step" onChange={(e) => up(i, { text: e.target.value })} />
          </div>
        ))}
        <button type="button" className="mono-btn add-btn" data-boxed="" onClick={() => set({ ...draft, sections: [...draft.sections, { id: newId(), title: "", text: "" }] })}>
          + Section
        </button>
      </>
    );
  }

  if (tab === "videos") {
    const up = (i: number, v: Partial<Video>) => set({ ...draft, videos: draft.videos.map((x, j) => (j === i ? { ...x, ...v } : x)) });
    return (
      <>
        {draft.videos.map((v, i) => (
          <div key={v.id} className="edit-block">
            <div className="edit-row">
              <input id={`v-t-${v.id}`} className="input" value={v.title} placeholder="Title" onChange={(e) => up(i, { title: e.target.value })} />
              <Tools
                onUp={() => set({ ...draft, videos: move(draft.videos, i, -1) })}
                onDown={() => set({ ...draft, videos: move(draft.videos, i, 1) })}
                onRemove={() => set({ ...draft, videos: draft.videos.filter((_, j) => j !== i) })}
              />
            </div>
            <div className="edit-grid">
              <input id={`v-u-${v.id}`} className="input wide" value={v.url} placeholder="Link" inputMode="url" onChange={(e) => up(i, { url: e.target.value })} />
              <input id={`v-s-${v.id}`} className="input" value={v.source} placeholder="Source, e.g. YouTube" onChange={(e) => up(i, { source: e.target.value })} />
              <select id={`v-g-${v.id}`} className="select" value={v.group} onChange={(e) => up(i, { group: e.target.value as Video["group"] })}>
                <option value="full">Full operation</option>
                <option value="other">Other</option>
              </select>
              <input id={`v-n-${v.id}`} className="input wide" value={v.note} placeholder="Note, e.g. starts at 11:10" onChange={(e) => up(i, { note: e.target.value })} />
            </div>
          </div>
        ))}
        <button
          type="button"
          className="mono-btn add-btn"
          data-boxed=""
          onClick={() => set({ ...draft, videos: [...draft.videos, { id: newId(), title: "", url: "", source: "", note: "", group: "full" }] })}
        >
          + Video
        </button>
      </>
    );
  }

  if (tab === "links") {
    const up = (i: number, l: Partial<Link>) => set({ ...draft, links: draft.links.map((x, j) => (j === i ? { ...x, ...l } : x)) });
    return (
      <>
        {draft.links.map((l, i) => (
          <div key={l.id} className="edit-block">
            <div className="edit-row">
              <input id={`l-t-${l.id}`} className="input" value={l.title} placeholder="Title" onChange={(e) => up(i, { title: e.target.value })} />
              <Tools
                onUp={() => set({ ...draft, links: move(draft.links, i, -1) })}
                onDown={() => set({ ...draft, links: move(draft.links, i, 1) })}
                onRemove={() => set({ ...draft, links: draft.links.filter((_, j) => j !== i) })}
              />
            </div>
            <div className="edit-grid">
              <input id={`l-u-${l.id}`} className="input wide" value={l.url} placeholder="Link" inputMode="url" onChange={(e) => up(i, { url: e.target.value })} />
              <input id={`l-s-${l.id}`} className="input" value={l.source} placeholder="Source, e.g. AO" onChange={(e) => up(i, { source: e.target.value })} />
              <input id={`l-n-${l.id}`} className="input" value={l.note} placeholder="Note, e.g. Approach" onChange={(e) => up(i, { note: e.target.value })} />
            </div>
          </div>
        ))}
        <button type="button" className="mono-btn add-btn" data-boxed="" onClick={() => set({ ...draft, links: [...draft.links, { id: newId(), title: "", url: "", source: "", note: "" }] })}>
          + Link
        </button>
      </>
    );
  }

  if (tab === "optech") {
    const upK = (i: number, k: Partial<Kit>) => set({ ...draft, kits: draft.kits.map((x, j) => (j === i ? { ...x, ...k } : x)) });
    const upT = (i: number, t: Partial<Technique>) => set({ ...draft, techniques: draft.techniques.map((x, j) => (j === i ? { ...x, ...t } : x)) });
    return (
      <>
        <p className="label sub-label">Kits</p>
        {draft.kits.map((k, i) => (
          <div key={k.id} className="edit-block">
            <div className="edit-row">
              <input id={`k-n-${k.id}`} className="input" value={k.name} placeholder="Kit, e.g. Attune" onChange={(e) => upK(i, { name: e.target.value })} />
              <Tools
                onUp={() => set({ ...draft, kits: move(draft.kits, i, -1) })}
                onDown={() => set({ ...draft, kits: move(draft.kits, i, 1) })}
                onRemove={() => set({ ...draft, kits: draft.kits.filter((_, j) => j !== i) })}
              />
            </div>
            <div className="edit-grid">
              <input id={`k-m-${k.id}`} className="input" value={k.maker} placeholder="Maker, e.g. DePuy Synthes" onChange={(e) => upK(i, { maker: e.target.value })} />
              <input id={`k-u-${k.id}`} className="input" value={k.url} placeholder="Op tech link" inputMode="url" onChange={(e) => upK(i, { url: e.target.value })} />
            </div>
          </div>
        ))}
        <button type="button" className="mono-btn add-btn" data-boxed="" onClick={() => set({ ...draft, kits: [...draft.kits, { id: newId(), name: "", maker: "", url: "" }] })}>
          + Kit
        </button>

        <p className="label sub-label">Techniques</p>
        <p className="hint">Only if the steps differ, e.g. Conventional and Robotic (Mako).</p>
        {draft.techniques.map((t, i) => (
          <div key={t.id} className="edit-block">
            <div className="edit-row">
              <input id={`t-n-${t.id}`} className="input" value={t.name} placeholder="Technique" onChange={(e) => upT(i, { name: e.target.value })} />
              <Tools
                onUp={() => set({ ...draft, techniques: move(draft.techniques, i, -1) })}
                onDown={() => set({ ...draft, techniques: move(draft.techniques, i, 1) })}
                onRemove={() => set({ ...draft, techniques: draft.techniques.filter((_, j) => j !== i) })}
              />
            </div>
          </div>
        ))}
        <button type="button" className="mono-btn add-btn" data-boxed="" onClick={() => set({ ...draft, techniques: [...draft.techniques, { id: newId(), name: "" }] })}>
          + Technique
        </button>
      </>
    );
  }

  const up = (i: number, q: Partial<Question>) => set({ ...draft, questions: draft.questions.map((x, j) => (j === i ? { ...x, ...q } : x)) });
  return (
    <>
      {draft.questions.map((q, i) => (
        <div key={q.id} className="edit-block">
          <div className="edit-row">
            <input id={`q-q-${q.id}`} className="input" value={q.q} placeholder="Question" onChange={(e) => up(i, { q: e.target.value })} />
            <Tools
              onUp={() => set({ ...draft, questions: move(draft.questions, i, -1) })}
              onDown={() => set({ ...draft, questions: move(draft.questions, i, 1) })}
              onRemove={() => set({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })}
            />
          </div>
          <textarea id={`q-a-${q.id}`} className="textarea" value={q.a} placeholder="Answer" onChange={(e) => up(i, { a: e.target.value })} />
        </div>
      ))}
      <button type="button" className="mono-btn add-btn" data-boxed="" onClick={() => set({ ...draft, questions: [...draft.questions, { id: newId(), q: "", a: "" }] })}>
        + Question
      </button>
    </>
  );
}

/** Save / cancel / delete, pinned to the bottom while editing. */
export function EditBar({ busy, onSave, onCancel, onDelete }: { busy: boolean; onSave: () => void; onCancel: () => void; onDelete: () => void }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="edit-bar">
      <div>
        {confirm ? (
          <>
            <button type="button" className="mono-btn" data-danger="" onClick={onDelete} disabled={busy}>
              Delete for good
            </button>
            <button type="button" className="mono-btn" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="mono-btn" data-danger="" onClick={() => setConfirm(true)}>
            Delete
          </button>
        )}
      </div>
      <div>
        <button type="button" className="mono-btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="mono-btn" data-primary="" onClick={onSave} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
