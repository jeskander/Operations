"use client";

import { useState } from "react";
import { useDictation } from "./useDictation";

type Props = {
  placeholder: string;
  busy: boolean;
  /** What's happening, or what went wrong. */
  note?: string | null;
  error?: boolean;
  onSend: (text: string) => void;
};

/** Type or dictate a change for Claude. */
export default function AskBar({ placeholder, busy, note, error, onSend }: Props) {
  const [text, setText] = useState("");
  const dict = useDictation((phrase) => setText((t) => (t ? `${t} ${phrase}` : phrase)));

  const send = () => {
    const v = text.trim();
    if (!v || busy) return;
    dict.stop();
    onSend(v);
    setText("");
  };

  return (
    <div className="ask">
      {(note || dict.interim) && (
        <p className={`ask-note${busy ? " reading" : ""}`} data-error={error ? "" : undefined}>
          {dict.interim || note}
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
          id="ask"
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {dict.supported && (
          <button
            type="button"
            className="mono-btn mic"
            aria-pressed={dict.listening}
            onClick={() => (dict.listening ? dict.stop() : dict.start())}
          >
            {dict.listening ? "Stop" : "Dictate"}
          </button>
        )}
        <button type="submit" className="mono-btn" disabled={busy || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}
