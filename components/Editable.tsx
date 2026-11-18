"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onCommit: (v: string) => void;
  /** How the text looks when not being edited. */
  render?: (v: string) => React.ReactNode;
  placeholder?: string;
  className?: string;
  /** Enter adds a new line instead of finishing. */
  multiline?: boolean;
  /** Start in editing (e.g. a line just added). */
  autoEdit?: boolean;
  onEnter?: () => void;
  onBackspaceEmpty?: () => void;
  onTab?: (shift: boolean) => void;
  onDone?: () => void;
  ariaLabel?: string;
};

/** Text that becomes editable when tapped, and saves when you leave it. */
export default function Editable({
  value,
  onCommit,
  render,
  placeholder,
  className = "",
  multiline,
  autoEdit,
  onEnter,
  onBackspaceEmpty,
  onTab,
  onDone,
  ariaLabel,
}: Props) {
  const [editing, setEditing] = useState(!!autoEdit);
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (autoEdit) setEditing(true);
  }, [autoEdit]);

  useEffect(() => {
    if (!editing) setText(value);
  }, [value, editing]);

  useEffect(() => {
    if (!editing) return;
    done.current = false;
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [editing]);

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    // An emptied field is always reported, so a blank new line can be removed.
    if (save && (text !== value || !text.trim())) onCommit(text);
    setEditing(false);
    onDone?.();
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        className={`editable-input ${className}`}
        value={text}
        rows={1}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setText(value);
            done.current = true;
            setEditing(false);
            if (!value.trim()) onCommit(""); // a blank new line goes away
            onDone?.();
          } else if (e.key === "Enter" && !e.shiftKey && !multiline) {
            e.preventDefault();
            finish(true);
            onEnter?.();
          } else if (e.key === "Backspace" && !text && onBackspaceEmpty) {
            e.preventDefault();
            done.current = true;
            setEditing(false);
            onBackspaceEmpty();
          } else if (e.key === "Tab" && onTab) {
            e.preventDefault();
            finish(true);
            onTab(e.shiftKey);
          }
        }}
      />
    );
  }

  return (
    <span
      className={`editable ${className}`}
      data-empty={value ? undefined : ""}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel ? `Edit ${ariaLabel}` : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return; // links still open
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          setEditing(true);
        }
      }}
    >
      {value ? (render ? render(value) : value) : placeholder}
    </span>
  );
}

/** An always-open input that adds what you type when you press Enter or leave it. */
export function AddField({
  placeholder,
  onAdd,
  className = "",
  inputMode,
}: {
  placeholder: string;
  onAdd: (v: string) => void;
  className?: string;
  inputMode?: "url" | "text";
}) {
  const [text, setText] = useState("");
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText("");
  };
  return (
    <textarea
      className={`add-field ${className}`}
      rows={1}
      value={text}
      placeholder={placeholder}
      aria-label={placeholder}
      inputMode={inputMode}
      onChange={(e) => setText(e.target.value)}
      onBlur={add}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          add();
        }
      }}
    />
  );
}
