"use client";

import { useEffect, useRef } from "react";
import AskBar from "./AskBar";
import { Markdown } from "./Markdown";

export type ChatMsg = { role: "user" | "assistant"; content: string; sources?: { id: string; name: string }[] };

type Props = {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  /** The operation on screen, if any. */
  viewing: string | null;
  busy: boolean;
  note: string | null;
  error: boolean;
  onSend: (text: string) => void;
  chat: ChatMsg[];
  onClear: () => void;
  onOpenOp: (id: string) => void;
};

/** The one Claude: a bubble bottom right that opens a large chat. It knows the page you're on and can reach every page. */
export default function ClaudeBubble({ open, onOpen, onClose, viewing, busy, note, error, onSend, chat, onClear, onOpenOp }: Props) {
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
        <aside className="chat-drawer" aria-label="Ask Claude">
          <header className="chat-drawer-head">
            <div>
              <h2 className="label">Ask Claude</h2>
              <p className="chat-drawer-sub">{viewing ? <>On {viewing}</> : "All operations"}</p>
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
          <div className="chat-log" ref={scroller}>
            {chat.length === 0 && (
              <div className="chat-empty">
                <p>Ask about any operation, or tell me what to add or change. I&rsquo;ll draft it for you to accept.</p>
                <ul>
                  <li>{viewing ? "Add: keep the incision low if Mako" : "Add to TKR: keep the incision low if Mako"}</li>
                  <li>{viewing ? "What are the key steps here?" : "What tip–apex distance for a DHS?"}</li>
                  <li>Add a page for ankle arthroscopy</li>
                </ul>
              </div>
            )}
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
                      {m.sources.map((src) => (
                        <button key={src.id} className="mono-btn" onClick={() => onOpenOp(src.id)}>
                          {src.name} →
                        </button>
                      ))}
                    </p>
                  )}
                </div>
              ),
            )}
          </div>
          <AskBar id="ask-any" autoFocus placeholder={viewing ? "Ask, or say what to change…" : "Ask anything, or add a learning…"} busy={busy} note={note} error={error} onSend={onSend} />
        </aside>
      )}
      <button
        className="chat-bubble"
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
