"use client";

import { useEffect, useState } from "react";
import { useRecorder } from "./useRecorder";

type Props = {
  placeholder: string;
  busy: boolean;
  /** What's happening, or what went wrong. */
  note?: string | null;
  error?: boolean;
  onSend: (text: string) => void;
  id?: string;
  autoFocus?: boolean;
  /** The operation on screen, so dictation knows its words. */
  currentId?: string | null;
};

const draftKey = (id: string) => `op-draft:${id}`;
const readDraft = (id: string) => {
  try {
    return localStorage.getItem(draftKey(id)) ?? "";
  } catch {
    return "";
  }
};
const writeDraft = (id: string, v: string) => {
  try {
    if (v) localStorage.setItem(draftKey(id), v);
    else localStorage.removeItem(draftKey(id));
  } catch {
    // Private mode or storage blocked: the draft just isn't kept.
  }
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** Type, paste or dictate for Claude. Unsent text is kept on this device until you send it. */
export default function AskBar({ placeholder, busy, note, error, onSend, id = "ask", autoFocus, currentId = null }: Props) {
  const [text, setText] = useState("");
  useEffect(() => setText(readDraft(id)), [id]);
  const update = (v: string) => {
    setText(v);
    writeDraft(id, v);
  };
  const rec = useRecorder((spoken) => setText((t) => {
    const v = t.trim() ? `${t.trimEnd()} ${spoken}` : spoken;
    writeDraft(id, v);
    return v;
  }), currentId);

  const send = () => {
    const v = text.trim();
    if (!v || busy || rec.state !== "idle") return;
    onSend(v);
    update("");
  };

  const status =
    rec.state === "recording"
      ? `Recording ${clock(rec.elapsed)}${rec.pending ? " · transcribing as you go" : ""}. Tap Stop when you're done.`
      : rec.state === "finishing"
        ? "Finishing the transcript…"
        : (rec.error ?? note);

  return (
    <div className="ask">
      {status && (
        <p className={`ask-note${busy || rec.state !== "idle" ? " reading" : ""}`} data-error={(error && !rec.error && status === note) || rec.error ? "" : undefined}>
          {status}
        </p>
      )}
      <form
        className="ask-inner"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          id={id}
          rows={1}
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          onChange={(e) => update(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {rec.supported && (
          <button
            type="button"
            className="mono-btn mic"
            aria-pressed={rec.state === "recording"}
            disabled={rec.state === "finishing"}
            onClick={() => (rec.state === "recording" ? rec.stop() : rec.start())}
            title="Dictate with an AI speech model"
          >
            {rec.state === "recording" ? "Stop" : "Dictate"}
          </button>
        )}
        <button type="submit" className="mono-btn" disabled={busy || !text.trim() || rec.state !== "idle"}>
          Send
        </button>
      </form>
    </div>
  );
}
