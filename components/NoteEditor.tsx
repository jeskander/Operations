"use client";

import { Extension, InputRule } from "@tiptap/core";
import { Details, DetailsContent, DetailsSummary } from "@tiptap/extension-details";
import { Placeholder } from "@tiptap/extensions";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";

/** "> " at the start of a line makes a toggle, as in Notion. */
const NoteShortcuts = Extension.create({
  name: "noteShortcuts",
  addInputRules() {
    return [
      new InputRule({
        find: /^>\s$/,
        handler: ({ range, chain }) => {
          chain().deleteRange(range).setDetails().run();
        },
      }),
    ];
  },
});

type Props = {
  /** The note as HTML. Changes from elsewhere (Claude, Undo) replace what's shown. */
  value: string;
  onChange: (html: string) => void;
};

/** One note: headings, bold, italic, underline, lists, links and collapsible toggles. */
export default function NoteEditor({ value, onChange }: Props) {
  const lastEmitted = useRef(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const [focused, setFocused] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
        link: { openOnClick: true, autolink: true, defaultProtocol: "https" },
      }),
      Details.configure({ persist: true, HTMLAttributes: { class: "toggle" } }),
      DetailsSummary,
      DetailsContent,
      Placeholder.configure({
        includeChildren: true,
        placeholder: ({ node }) => (node.type.name === "detailsSummary" ? "Toggle title" : "Write here. > for a toggle, - for a bullet, 1. for numbers, # for a heading"),
      }),
      NoteShortcuts,
    ],
    content: value,
    editorProps: { attributes: { class: "note-body" } },
    onUpdate: ({ editor }) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        const html = editor.getHTML();
        lastEmitted.current = html;
        cb.current(html);
      }, 600);
    },
    onFocus: () => setFocused(true),
    onBlur: ({ event }) => {
      const to = (event as FocusEvent).relatedTarget as HTMLElement | null;
      if (!to?.closest(".note-tools")) setFocused(false);
    },
  });

  // Save what's typed when leaving the page.
  useEffect(
    () => () => {
      if (timer.current && editor) {
        clearTimeout(timer.current);
        cb.current(editor.getHTML());
      }
    },
    [editor],
  );

  // A change from elsewhere: show it, unless you're mid-sentence (your typing saves in a moment).
  useEffect(() => {
    if (!editor || value === lastEmitted.current || timer.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  useEffect(() => {
    if (focused) document.body.dataset.editing = "";
    else delete document.body.dataset.editing;
    return () => {
      delete document.body.dataset.editing;
    };
  }, [focused]);

  return (
    <div className="note">
      {editor && <Tools editor={editor} floating={focused} onDone={() => editor.commands.blur()} />}
      <EditorContent editor={editor} />
    </div>
  );
}

/** Formatting buttons: at the top of the note on a computer, above the keyboard on a phone. */
function Tools({ editor, floating, onDone }: { editor: Editor; floating: boolean; onDone: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h2: e.isActive("heading", { level: 2 }),
      h3: e.isActive("heading", { level: 3 }),
      bold: e.isActive("bold"),
      italic: e.isActive("italic"),
      underline: e.isActive("underline"),
      bullet: e.isActive("bulletList"),
      number: e.isActive("orderedList"),
      toggle: e.isActive("details"),
      inList: e.isActive("listItem"),
      canUndo: e.can().undo(),
    }),
  });
  const [bottom, setBottom] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const place = () => setBottom(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
    place();
    vv.addEventListener("resize", place);
    vv.addEventListener("scroll", place);
    return () => {
      vv.removeEventListener("resize", place);
      vv.removeEventListener("scroll", place);
    };
  }, []);

  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault();
  const run = (fn: () => void) => () => fn();
  const btn = (label: React.ReactNode, aria: string, on: () => void, pressed?: boolean, cls = "") => (
    <button type="button" className={`note-tool ${cls}`} aria-label={aria} title={aria} aria-pressed={pressed} onPointerDown={keep} onMouseDown={keep} onClick={on}>
      {label}
    </button>
  );
  const c = () => editor.chain().focus();
  return (
    <div className="note-tools" data-floating={floating || undefined} style={floating ? { bottom } : undefined} role="toolbar" aria-label="Formatting">
      {btn("H2", "Heading", run(() => c().toggleHeading({ level: 2 }).run()), s.h2)}
      {btn("H3", "Small heading", run(() => c().toggleHeading({ level: 3 }).run()), s.h3)}
      {btn(<b>B</b>, "Bold (Cmd+B)", run(() => c().toggleBold().run()), s.bold)}
      {btn(<i>I</i>, "Italic (Cmd+I)", run(() => c().toggleItalic().run()), s.italic)}
      {btn(<u>U</u>, "Underline (Cmd+U)", run(() => c().toggleUnderline().run()), s.underline)}
      {btn("•", "Bullets", run(() => c().toggleBulletList().run()), s.bullet)}
      {btn("1.", "Numbers", run(() => c().toggleOrderedList().run()), s.number)}
      {btn("▸", "Toggle", run(() => (s.toggle ? c().unsetDetails().run() : c().setDetails().run())), s.toggle)}
      {btn("⇤", "Less indent (Shift+Tab)", run(() => c().liftListItem("listItem").run()), undefined, s.inList ? "" : "dim")}
      {btn("⇥", "Indent (Tab)", run(() => c().sinkListItem("listItem").run()), undefined, s.inList ? "" : "dim")}
      {btn("↶", "Undo (Cmd+Z)", run(() => c().undo().run()), undefined, s.canUndo ? "" : "dim")}
      {floating && btn("Done", "Done", onDone, undefined, "note-done")}
    </div>
  );
}
