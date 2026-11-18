"use client";

import { useState } from "react";
import { IDLE_MINUTES } from "@/lib/auth";
import { newId } from "@/lib/content";
import type { Consultant, Settings } from "@/lib/types";
import VersionSwitch, { type Version } from "./VersionSwitch";

type Props = {
  settings: Settings;
  consultants: Consultant[];
  onSave: (s: Settings) => Promise<void>;
  onSaveConsultants: (list: Consultant[]) => Promise<void>;
  onLock: () => void;
  onBack: () => void;
  dark: boolean;
  onDark: (on: boolean) => void;
  mode: Version;
  onMode: (m: Version) => void;
};

const toLines = (v: string) => v.split("\n").map((x) => x.trim()).filter(Boolean);

export default function SettingsView({ settings, consultants, onSave, onSaveConsultants, onLock, onBack, dark, onDark, mode, onMode }: Props) {
  const [instructions, setInstructions] = useState(settings.instructions);
  const [parts, setParts] = useState(settings.parts.join("\n"));
  const [groups, setGroups] = useState(settings.groups.join("\n"));
  const [people, setPeople] = useState(consultants);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const changed =
    instructions !== settings.instructions ||
    toLines(parts).join("\n") !== settings.parts.join("\n") ||
    toLines(groups).join("\n") !== settings.groups.join("\n") ||
    JSON.stringify(people.filter((p) => p.name.trim())) !== JSON.stringify(consultants);

  const save = async () => {
    setBusy(true);
    setSaved(null);
    try {
      await onSave({ instructions, parts: toLines(parts), groups: toLines(groups) });
      if (JSON.stringify(people) !== JSON.stringify(consultants)) await onSaveConsultants(people.filter((p) => p.name.trim()));
      setSaved("Saved");
    } catch (e) {
      setSaved((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= people.length) return;
    const out = [...people];
    [out[i], out[j]] = [out[j], out[i]];
    setPeople(out);
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-primary">
          <button className="back" onClick={onBack}>
            ← Operations
          </button>
          <h1 className="page-title">Settings</h1>
        </div>
      </header>
      <section className="panel settings">
        <div className="setting">
          <label className="label" htmlFor="set-instructions">
            Claude&rsquo;s standing instructions
          </label>
          <p className="hint">Added to every change you ask Claude for, e.g. how terse to be, sources you trust, how to name parts.</p>
          <textarea
            id="set-instructions"
            className="textarea"
            value={instructions}
            placeholder="e.g. Keep lines under 12 words. Prefer AO Surgery Reference and Orthobullets for links."
            onChange={(e) => setInstructions(e.target.value)}
          />
        </div>

        <div className="setting">
          <label className="label" htmlFor="set-parts">
            A new operation starts with these parts
          </label>
          <p className="hint">One per line.</p>
          <textarea id="set-parts" className="textarea" data-mono="" value={parts} onChange={(e) => setParts(e.target.value)} />
        </div>

        <div className="setting">
          <label className="label" htmlFor="set-groups">
            Groups
          </label>
          <p className="hint">The headings operations are filed under on the home screen, in this order. One per line.</p>
          <textarea id="set-groups" className="textarea" data-mono="" value={groups} onChange={(e) => setGroups(e.target.value)} />
        </div>

        <div className="setting">
          <p className="label">Consultants</p>
          <p className="hint">Shared by every operation. Removing one also hides their tags on the steps.</p>
          {people.map((c, i) => (
            <div key={c.id} className="edit-row">
              <input
                id={`c-${c.id}`}
                className="input"
                value={c.name}
                placeholder="e.g. Mr Smith"
                onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <span className="edit-tools">
                <button className="mono-btn" aria-label="Move up" onClick={() => move(i, -1)}>
                  ↑
                </button>
                <button className="mono-btn" aria-label="Move down" onClick={() => move(i, 1)}>
                  ↓
                </button>
                <button className="mono-btn" aria-label="Remove" onClick={() => setPeople(people.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </span>
            </div>
          ))}
          <button className="mono-btn add-btn" data-boxed="" onClick={() => setPeople([...people, { id: newId(), name: "" }])}>
            + Consultant
          </button>
        </div>

        <div className="setting">
          <p className="label">Version</p>
          <p className="hint">
            Also at the top of every operation. Simple: one note, edited by hand or by Claude. Notion-style and Classic: the full page (steps with parts, tags
            and filters, plus videos, links, op tech and knowledge), with the steps in the Notion-style editor or the classic one. The simple note starts from
            the full page the first time you open an operation in it; after that the two are kept separately. On this device.
          </p>
          <VersionSwitch value={mode} onChange={onMode} />
        </div>

        <div className="setting">
          <p className="label">Appearance</p>
          <p className="hint">On this device. Cmd/Ctrl+Shift+L switches it anywhere.</p>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={!dark} onClick={() => onDark(false)}>
              Light
            </button>
            <button type="button" className="chip" aria-pressed={dark} onClick={() => onDark(true)}>
              Dark
            </button>
          </div>
        </div>

        <div className="setting">
          <p className="label">Keyboard</p>
          <p className="hint">
            As in Notion. Cmd/Ctrl+Opt+0–8 turn into text, heading 1–3, to-do, bullet, numbered, part, code. Cmd/Ctrl+/ turn into. Tab / Shift+Tab indent.
            Cmd/Ctrl+Shift+↑/↓ move. Cmd/Ctrl+D duplicate. Esc picks a block, Shift+↑/↓ picks more. Cmd/Ctrl+Enter opens a part or ticks a to-do. Cmd/Ctrl+B / I / U / E,
            Cmd/Ctrl+Shift+S, Cmd/Ctrl+K link. Cmd/Ctrl+P search, Cmd/Ctrl+[ / ] back and forward, Cmd/Ctrl+\ sidebar. @ tags, [[ links to an operation.
          </p>
        </div>

        <div className="setting">
          <p className="label">Security</p>
          <p className="hint">
            The app locks after {IDLE_MINUTES} minutes without use, and when the browser closes. The password is never stored on this device: only a
            signed note of when you last used the app, which the server refuses once it&rsquo;s {IDLE_MINUTES} minutes old.
          </p>
          <div>
            <button className="mono-btn" data-boxed="" onClick={onLock}>
              Lock now
            </button>
          </div>
        </div>
      </section>
      <div className="edit-bar">
        <span className="hint">{saved}</span>
        <div>
          <button className="mono-btn" data-primary="" onClick={save} disabled={busy || !changed}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
