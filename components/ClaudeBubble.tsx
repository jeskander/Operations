"use client";

import { useEffect, useRef } from "react";
import AskBar from "./AskBar";
import { Markdown } from "./Markdown";

export type ChatMsg = { role: "user" | "assistant"; content: string; sources?: { id: string; name: string }[] };

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** Lift the bubble clear of an operation's own ask bar. */
  aboveAsk: boolean;
  busy: boolean;
  note: string | null;
  error: boolean;
  onSend: (text: string) => void;
  chat: ChatMsg[];
  onClear: () => void;
  onOpenOp: (id: string) => void;
};

/** A bubble that floats bottom right and opens the universal "add a learning" box as a card. */
export default function ClaudeBubble({ open, onOpen, onClose, aboveAsk, busy, note, error, onSend, chat, onClear, onOpenOp }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [chat.length, open, busy]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {open && (
        <aside className="chat-drawer" data-above-ask={aboveAsk || undefined} aria-label="Ask Claude">
          <header className="chat-drawer-head">
            <div>
              <h2 className="label">Ask Claude</h2>
              <p className="chat-drawer-sub">Ask about any operation, or add a learning: Claude finds the right page and shows you the change first.</p>
            </div>
            <div className="chat-drawer-actions">
              {chat.length > 0 && (
                <button className="mono-btn" onClick={onClear} disabled={busy}>
                  Clear
                </button>
              )}
              <button className="panel-close" aria-label="Close" onClick={onClose}>
                ×
              </button>
            </div>
          </header>
          {chat.length > 0 && (
            <div className="chat-log" ref={scroller}>
              {chat.map((m, i) =>
                m.role === "user" ? (
                  <p key={i} className="chat-q">
                    {m.content}
                  </p>
                ) : (
                  <div key={i} className="chat-a">
                    <Markdown>{m.content}</Markdown>
                    {!!m.sources?.length && (
                      <p className="chat-sources">
                        From:{" "}
                        {m.sources.map((src) => (
                          <button key={src.id} className="mono-btn" onClick={() => onOpenOp(src.id)}>
                            {src.name}
                          </button>
                        ))}
                      </p>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
          <AskBar id="ask-any" autoFocus placeholder="Ask anything, or add a learning…" busy={busy} note={note} error={error} onSend={onSend} />
        </aside>
      )}
      <button
        className="chat-bubble"
        data-above-ask={aboveAsk || undefined}
        data-busy={busy || undefined}
        aria-label={open ? "Close" : "Ask Claude"}
        aria-expanded={open}
        title={open ? "Close" : "Ask Claude"}
        onClick={open ? onClose : onOpen}
      >
        {open ? (
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
            <path
              d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3.1-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </>
  );
}
