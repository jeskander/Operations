"use client";

import "@blocknote/mantine/style.css";
import { BlockNoteSchema, createExtension, createHeadingBlockSpec, defaultBlockSpecs, type BlockNoteEditor } from "@blocknote/core";
import { SideMenuExtension, SuggestionMenu } from "@blocknote/core/extensions";
import { BlockNoteView } from "@blocknote/mantine";
import {
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useExtensionState,
  type SuggestionMenuProps,
} from "@blocknote/react";
import { Extension as TiptapExtension } from "@tiptap/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { visibleBlocks } from "@/lib/blocks";
import { fromBN, shape, toBN, type BNBlock } from "@/lib/bn";
import { newId } from "@/lib/content";
import type { Block, Consultant, Content, Filters } from "@/lib/types";
import Sheet, { Choice } from "./Sheet";

type Update = (next: Content | ((c: Content) => Content)) => void;
type TagKind = "kit" | "technique" | "consultant";
type AnyEditor = BlockNoteEditor<any, any, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const KIND_LABEL: Record<TagKind, string> = { kit: "Kit", technique: "Mode", consultant: "Consultant" };

const { paragraph, bulletListItem, numberedListItem, checkListItem, toggleListItem, quote, codeBlock, divider, image } = defaultBlockSpecs;

/** The blocks this app uses: no tables, files, audio or video. Headings go to level 3. */
const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph,
    heading: createHeadingBlockSpec({ levels: [1, 2, 3] }),
    bulletListItem,
    numberedListItem,
    checkListItem,
    toggleListItem,
    quote,
    codeBlock,
    divider,
    image,
  },
});

// ---------- Notion's keys ----------

/** What the keyboard shortcuts need from the page around the editor. */
type Hooks = {
  /** Blocks picked with Esc and Shift+↑/↓, in order; empty when none. */
  picked: string[];
  anchor: string | null;
  setPicked: (ids: string[]) => void;
  openMenu: (ids: string[]) => void;
  openLink: () => void;
  openSearch: () => void;
};
const hooks = new WeakMap<object, Hooks>();

/** Notion's Cmd+Opt+0–8 block types. */
const TYPE_KEYS: [string, string, Record<string, unknown>?][] = [
  ["paragraph", "paragraph"],
  ["heading", "heading", { level: 1 }],
  ["heading", "heading", { level: 2 }],
  ["heading", "heading", { level: 3 }],
  ["checkListItem", "checkListItem"],
  ["bulletListItem", "bulletListItem"],
  ["numberedListItem", "numberedListItem"],
  ["toggleListItem", "toggleListItem"],
  ["codeBlock", "codeBlock"],
];

/** The blocks a command acts on: the picked ones, else those the text selection spans, else the cursor's. */
function targets(editor: AnyEditor): string[] {
  const h = hooks.get(editor);
  if (h?.picked.length) return h.picked;
  const sel = editor.getSelection()?.blocks;
  return sel?.length ? sel.map((b) => b.id) : [editor.getTextCursorPosition().block.id];
}

/** Blocks on screen, top to bottom (closed toggles hide their children). */
function shownOrder(editor: AnyEditor): string[] {
  const root = editor.domElement;
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(".bn-block-outer[data-id]")].filter((el) => el.offsetParent !== null).map((el) => el.dataset.id!);
}

function toggleButton(editor: AnyEditor, id: string) {
  return editor.domElement?.querySelector<HTMLButtonElement>(`.bn-block-outer[data-id="${CSS.escape(id)}"] > .bn-block > .bn-toggle-wrapper > .bn-toggle-button`);
}

function duplicateBlocks(editor: AnyEditor, ids: string[]) {
  const blocks = ids.map((id) => editor.getBlock(id)).filter(Boolean) as unknown as BNBlock[];
  if (!blocks.length) return;
  editor.insertBlocks(blocks.map((b) => stripIds(b)) as never, blocks[blocks.length - 1].id, "after");
}

/** At the end of an open part, Enter starts a line inside it, as in Notion. */
function enterInToggle(editor: AnyEditor): boolean {
  const b = editor.getTextCursorPosition().block;
  if (b.type !== "toggleListItem") return false;
  const sel = editor.prosemirrorState.selection;
  if (!sel.empty || sel.$from.parentOffset !== sel.$from.parent.content.size) return false;
  // A closed part with lines in it gets a new part after it; an empty or open one gets its first line.
  if (b.children.length && toggleButton(editor, b.id)?.getAttribute("aria-expanded") !== "true") return false;
  const first = b.children[0];
  let id: string | undefined;
  if (first) id = editor.insertBlocks([{ type: "bulletListItem" }] as never, first.id, "before")[0]?.id;
  else {
    editor.updateBlock(b.id, { children: [{ type: "bulletListItem" }] } as never);
    id = editor.getBlock(b.id)?.children[0]?.id;
  }
  if (id) editor.setTextCursorPosition(id, "start");
  return true;
}

function modEnter(editor: AnyEditor): boolean {
  const b = editor.getTextCursorPosition().block;
  if (b.type === "checkListItem") {
    editor.updateBlock(b, { props: { checked: !(b.props as { checked?: boolean }).checked } } as never);
    return true;
  }
  const btn = toggleButton(editor, b.id);
  if (!btn) return false;
  btn.click();
  return true;
}

/**
 * Notion's keys. They're registered ahead of the editor's own (which would, for example, take
 * Cmd+Enter for a line break) and fall through when they don't apply.
 */
const notionKeys = createExtension(({ editor }: { editor: AnyEditor }) => {
  const keys: Record<string, () => boolean> = {
    ...Object.fromEntries(
      TYPE_KEYS.map(([type, , props], n) => [
        `Mod-Alt-${n}`,
        () => {
          for (const id of targets(editor)) editor.updateBlock(id, { type, props: props ?? {} } as never);
          return true;
        },
      ]),
    ),
    Enter: () => enterInToggle(editor),
    "Mod-Enter": () => modEnter(editor),
    "Mod-d": () => {
      duplicateBlocks(editor, targets(editor));
      return true;
    },
    "Mod-/": () => {
      hooks.get(editor)?.openMenu(targets(editor));
      return true;
    },
    "Mod-k": () => {
      const h = hooks.get(editor);
      if (editor.getSelectedText()) h?.openLink();
      else h?.openSearch();
      return true;
    },
    Escape: () => {
      // Esc picks the block you're in, as in Notion; Esc again lets go.
      const h = hooks.get(editor);
      if (!h) return false;
      if (editor.getExtension(SuggestionMenu)?.shown()) return false; // closing a menu first
      if (h.picked.length) {
        h.setPicked([]);
        return true;
      }
      const id = editor.getTextCursorPosition().block.id;
      h.anchor = id;
      h.setPicked([id]);
      return true;
    },
    "Shift-ArrowUp": () => extendPick(editor, -1),
    "Shift-ArrowDown": () => extendPick(editor, 1),
    Backspace: () => removePicked(editor),
    Delete: () => removePicked(editor),
    Tab: () => shiftPicked(editor, 1),
    "Shift-Tab": () => shiftPicked(editor, -1),
  };
  return {
    key: "notionKeys",
    inputRules: [
      // As in Notion: "> " a toggle (BlockNote would make a quote; '" ' still does), "[]" a to-do, "```" code.
      { find: /^>\s$/, replace: () => ({ type: "toggleListItem", props: {} }) },
      { find: /^\[\]$/, replace: () => ({ type: "checkListItem", props: {} }) },
      { find: /^```$/, replace: () => ({ type: "codeBlock", props: {} }) },
    ],
    tiptapExtensions: [TiptapExtension.create({ name: "notionKeys", priority: 1000, addKeyboardShortcuts: () => keys })],
  };
});

function extendPick(editor: AnyEditor, by: number): boolean {
  const h = hooks.get(editor);
  if (!h?.picked.length || !h.anchor) return false; // ordinary text selection
  const order = shownOrder(editor);
  const head = h.picked[0] === h.anchor ? h.picked[h.picked.length - 1] : h.picked[0];
  const next = order[Math.max(0, Math.min(order.length - 1, order.indexOf(head) + by))];
  const [a, b] = [order.indexOf(h.anchor), order.indexOf(next)].sort((x, y) => x - y);
  h.setPicked(order.slice(a, b + 1));
  return true;
}

function removePicked(editor: AnyEditor): boolean {
  const h = hooks.get(editor);
  if (!h?.picked.length) return false;
  editor.removeBlocks(h.picked);
  h.setPicked([]);
  return true;
}

/** Tab / Shift+Tab with several blocks picked: each top-level picked block moves in or out one level. */
function shiftPicked(editor: AnyEditor, by: 1 | -1): boolean {
  const h = hooks.get(editor);
  if (!h || h.picked.length < 1) return false;
  const picked = new Set(h.picked);
  // Only the picked blocks whose parent isn't also picked; their children come with them.
  const tops = h.picked.filter((id) => {
    const parent = editor.getParentBlock(id);
    return !parent || !picked.has(parent.id);
  });
  const blocks = tops.map((id) => editor.getBlock(id)).filter(Boolean) as unknown as BNBlock[];
  if (!blocks.length) return true;
  editor.transact(() => {
    if (by === 1) {
      const prev = editor.getPrevBlock(blocks[0].id);
      if (!prev) return;
      // Into the block above, after its own children.
      editor.removeBlocks(blocks.map((b) => b.id));
      const host = editor.getBlock(prev.id) as unknown as BNBlock;
      editor.updateBlock(prev.id, { children: [...(host.children ?? []), ...blocks] } as never);
    } else {
      const parent = editor.getParentBlock(blocks[0].id);
      if (!parent) return;
      // Out to just after the parent; later siblings stay where they are.
      editor.removeBlocks(blocks.map((b) => b.id));
      editor.insertBlocks(blocks as never, parent.id, "after");
    }
  });
  h.setPicked(h.picked);
  return true;
}

// ---------- Pieces ----------

async function uploadFile(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);
  const res = await fetch("/api/images", { method: "POST", body });
  const j = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
  if (!res.ok || !j?.url) throw new Error(j?.error ?? "Couldn't upload the image");
  return j.url;
}

/** How a tag looks after a block's text. */
const PILL =
  "align-self:center;margin-left:.5rem;padding:0 .45rem;border-radius:999px;background:var(--paper-2);font-family:var(--mono);font-size:.64rem;font-weight:400;font-style:normal;letter-spacing:.06em;color:var(--graphite);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;pointer-events:none;flex:0 1 auto";

const stripIds = (b: BNBlock): Omit<BNBlock, "id"> => ({ type: b.type, props: b.props, content: b.content, children: (b.children ?? []).map((c) => stripIds(c) as BNBlock) });

const TURN_INTO: { value: string; label: string }[] = [
  { value: "toggleListItem", label: "▸ Part" },
  { value: "bulletListItem", label: "• Bullet" },
  { value: "numberedListItem", label: "1. Numbered" },
  { value: "checkListItem", label: "☐ To-do" },
  { value: "paragraph", label: "Text" },
  { value: "heading:1", label: "Heading 1" },
  { value: "heading:2", label: "Heading 2" },
  { value: "heading:3", label: "Heading 3" },
  { value: "quote", label: "Quote" },
  { value: "codeBlock", label: "Code" },
];

type PickItem = { title: string; group: string; onItemClick: () => void };

/** The tag and page lists: a kind on the left, the name on the right, as in the classic editor. */
function PickerMenu({ items, selectedIndex, onItemClick }: SuggestionMenuProps<PickItem>) {
  if (!items.length) return <div className="picker"><p className="picker-empty">No match. Keep typing to add a new one.</p></div>;
  return (
    <div className="picker" role="listbox">
      {items.map((it, i) => (
        <button
          key={`${it.group}-${it.title}-${i}`}
          type="button"
          role="option"
          aria-selected={i === selectedIndex}
          className="picker-item"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onItemClick?.(it)}
          ref={(el) => {
            if (el && i === selectedIndex) el.scrollIntoView({ block: "nearest" });
          }}
        >
          <span className="picker-kind">{it.group}</span>
          <span>{it.title}</span>
        </button>
      ))}
    </div>
  );
}

type Props = {
  opId: string;
  content: Content;
  consultants: Consultant[];
  filters: Filters;
  update: Update;
  addConsultant: (name: string) => Promise<Consultant | null>;
  /** Other operations, for [[ links. */
  operations: { id: string; name: string }[];
  onSearch: () => void;
};

export default function BlockEditor({ opId, content, consultants, filters, update, addConsultant, operations, onSearch }: Props) {
  const contentRef = useRef(content);
  contentRef.current = content;
  const updateRef = useRef(update);
  updateRef.current = update;
  const lastShape = useRef(shape(content.blocks));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, setMenu] = useState<string[] | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [cursorType, setCursorType] = useState("");
  const [picked, setPickedState] = useState<string[]>([]);
  const wrap = useRef<HTMLDivElement>(null);

  const editor = useCreateBlockNote(
    {
      schema,
      initialContent: (() => {
        // First visit: the first part open.
        const first = content.blocks.find((b) => b.type === "toggle" && b.depth === 0);
        try {
          if (first && localStorage.getItem(`toggle-${first.id}`) === null) localStorage.setItem(`toggle-${first.id}`, "true");
        } catch {}
        const doc = toBN(content.blocks);
        return doc.length ? (doc as never) : undefined;
      })(),
      uploadFile,
      extensions: [notionKeys()],
      placeholders: { default: "Type / for blocks, > for a part, @ to tag", emptyDocument: "Type / for blocks, > for a part, @ to tag" },
    },
    [opId],
  );

  // What the shortcuts reach in this page.
  const h = useMemo<Hooks>(() => ({ picked: [], anchor: null, setPicked: () => {}, openMenu: () => {}, openLink: () => {}, openSearch: () => {} }), [editor]); // eslint-disable-line react-hooks/exhaustive-deps
  h.setPicked = (ids) => {
    h.picked = ids;
    if (!ids.length) h.anchor = null;
    setPickedState(ids);
    if (ids.length) {
      // Keep the text selection over the picked blocks, so the browser doesn't type into them.
      try {
        editor.setSelection(ids[0], ids[ids.length - 1]);
      } catch {}
    }
  };
  h.openMenu = (ids) => {
    flushRef.current();
    setMenu(ids);
  };
  h.openLink = () => setLink("");
  h.openSearch = onSearch;
  hooks.set(editor, h);

  // Picking ends with a click or any key other than the ones that act on picked blocks.
  useEffect(() => {
    const root = wrap.current;
    if (!root) return;
    const KEEP = new Set(["Shift", "Escape", "ArrowUp", "ArrowDown", "Tab", "Backspace", "Delete", "Meta", "Control", "Alt"]);
    const onKey = (e: KeyboardEvent) => {
      if (!h.picked.length) return;
      const mod = e.metaKey || e.ctrlKey;
      if (KEEP.has(e.key) && (e.key !== "ArrowUp" && e.key !== "ArrowDown" ? true : e.shiftKey)) return;
      if (mod && ["d", "/", "Enter"].includes(e.key)) return;
      if (mod && e.altKey) return;
      h.setPicked([]);
    };
    const onDown = () => h.picked.length && h.setPicked([]);
    root.addEventListener("keydown", onKey);
    root.addEventListener("mousedown", onDown);
    return () => {
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("mousedown", onDown);
    };
  }, [h]);

  // ---------- Saving: the editor's document back into the page ----------

  const tagsOf = useCallback((id: string) => contentRef.current.blocks.find((b) => b.id === id), []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const flat = fromBN(editor.document as unknown as BNBlock[], tagsOf);
    const s = shape(flat);
    if (s === lastShape.current) return;
    lastShape.current = s;
    updateRef.current((c) => ({ ...c, blocks: flat }));
  }, [editor, tagsOf]);
  const flushRef = useRef(flush);
  flushRef.current = flush;

  const onChange = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  };

  useEffect(() => () => flush(), [flush]);

  // A change from elsewhere (Claude, Undo): show it. A change to tags only leaves the text alone.
  useEffect(() => {
    const s = shape(content.blocks);
    if (s === lastShape.current) return;
    if (timer.current) return; // your typing wins; it saves in a moment
    lastShape.current = s;
    editor.replaceBlocks(editor.document, toBN(content.blocks) as never);
  }, [content.blocks, editor]);

  // ---------- Tags, filters and picked blocks, drawn by block id ----------

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of content.kits) m.set(`kit:${k.id}`, k.name);
    for (const t of content.techniques) m.set(`technique:${t.id}`, t.name);
    for (const c of consultants) m.set(`consultant:${c.id}`, c.name);
    return m;
  }, [content.kits, content.techniques, consultants]);

  // A stylesheet keyed by block id: the editor redraws anything that edits its own HTML.
  const css = useMemo(() => {
    const blocks = content.blocks;
    const shownIds = new Set(visibleBlocks(blocks, filters, new Set()).map((b) => b.id));
    const str = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
    const at = (id: string) => `.op-editor .bn-block-outer[data-id="${id.replace(/["\\]/g, "")}"]`;
    const rules: string[] = [];
    for (const b of blocks) {
      const sel = at(b.id);
      if (!shownIds.has(b.id)) {
        rules.push(`${sel}{display:none}`);
        continue;
      }
      const tags = [
        !filters.kit && b.kit && names.get(`kit:${b.kit}`),
        !filters.technique && b.technique && names.get(`technique:${b.technique}`),
        !filters.consultant && b.consultant && names.get(`consultant:${b.consultant}`),
      ].filter(Boolean) as string[];
      if (tags.length)
        rules.push(`${sel}>.bn-block>.bn-block-content::after,${sel}>.bn-block>.bn-toggle-wrapper>.bn-toggle-slot>.bn-block-content::after{content:${str(tags.join(" · "))};${PILL}}`);
    }
    for (const id of picked) rules.push(`${at(id)}>.bn-block{background:var(--pick);border-radius:4px}`);
    if (picked.length) rules.push(`.op-editor .bn-editor ::selection{background:transparent}`);
    return rules.join("\n");
  }, [content.blocks, filters, names, picked]);

  // ---------- Tagging ----------

  const setTag = (ids: string[], kind: TagKind, value: string | null) => {
    flush(); // a block you've just typed is saved before it's tagged
    const set = new Set(ids);
    update((c) => ({ ...c, blocks: c.blocks.map((b) => (set.has(b.id) ? { ...b, [kind]: value } : b)) }));
  };

  const tagItems = async (query: string): Promise<PickItem[]> => {
    const q = query.trim().toLowerCase();
    const c = contentRef.current;
    type Item = { kind: TagKind; id: string | null; name: string };
    const all: Item[] = [
      ...c.kits.map((k) => ({ kind: "kit" as const, id: k.id, name: k.name })),
      ...c.techniques.map((t) => ({ kind: "technique" as const, id: t.id, name: t.name })),
      ...consultants.map((p) => ({ kind: "consultant" as const, id: p.id, name: p.name })),
    ].filter((o) => !q || o.name.toLowerCase().includes(q));
    if (q && !all.some((o) => o.name.toLowerCase() === q)) for (const kind of ["kit", "technique", "consultant"] as TagKind[]) all.push({ kind, id: null, name: query.trim() });
    return all.slice(0, 12).map((o) => ({
      title: o.id ? o.name : `New “${o.name}”`,
      group: KIND_LABEL[o.kind],
      onItemClick: async () => {
        const blockId = editor.getTextCursorPosition().block.id;
        let id = o.id;
        if (!id && o.kind === "consultant") id = (await addConsultant(o.name))?.id ?? null;
        if (!id) {
          id = newId();
          if (o.kind === "kit") update((x) => ({ ...x, kits: [...x.kits, { id: id!, name: o.name, maker: "", url: "" }] }));
          if (o.kind === "technique") update((x) => ({ ...x, techniques: [...x.techniques, { id: id!, name: o.name }] }));
        }
        setTag([blockId], o.kind, id);
      },
    }));
  };

  // [[ links to another operation.
  const pageItems = async (query: string): Promise<PickItem[]> => {
    const q = query.trim().toLowerCase();
    return operations
      .filter((o) => o.id !== opId && (!q || o.name.toLowerCase().includes(q)))
      .slice(0, 10)
      .map((o) => ({
        title: o.name,
        group: "Operation",
        onItemClick: () => editor.insertInlineContent([{ type: "link", href: `/?op=${o.id}`, content: o.name }, " "] as never),
      }));
  };

  // ---------- Phone toolbar ----------

  useEffect(() => {
    const root = wrap.current;
    if (!root) return;
    const onIn = (e: FocusEvent) => (e.target as HTMLElement).closest(".bn-editor") && setFocused(true);
    const onOut = (e: FocusEvent) => {
      const to = e.relatedTarget as HTMLElement | null;
      if (!to?.closest(".kb-bar, .bn-editor")) setFocused(false);
    };
    root.addEventListener("focusin", onIn);
    root.addEventListener("focusout", onOut);
    return () => {
      root.removeEventListener("focusin", onIn);
      root.removeEventListener("focusout", onOut);
    };
  }, []);

  useEffect(() => {
    if (focused) document.body.dataset.editing = "";
    else delete document.body.dataset.editing;
    return () => {
      delete document.body.dataset.editing;
    };
  }, [focused]);

  const turnInto = (ids: string[], value: string) => {
    const [type, level] = value.split(":");
    for (const id of ids) editor.updateBlock(id, { type, props: level ? { level: Number(level) } : {} } as never);
  };

  const current = () => editor.getTextCursorPosition().block;

  // ---------- Block options sheet ----------

  const menuIds = menu ?? [];
  const menuBlock = menuIds.length ? (editor.getBlock(menuIds[0]) as unknown as BNBlock | undefined) : undefined;
  const menuTags: Block | undefined = menuIds.length ? content.blocks.find((b) => b.id === menuIds[0]) : undefined;
  const menuValue = menuBlock ? (menuBlock.type === "heading" ? `heading:${(menuBlock.props?.level as number) ?? 2}` : menuBlock.type) : "";
  const many = menuIds.length > 1;

  return (
    <div className="op-editor" ref={wrap}>
      <style>{css}</style>
      <BlockNoteView
        editor={editor}
        theme="light"
        sideMenu={false}
        onChange={onChange}
        onSelectionChange={() => setCursorType(editor.getTextCursorPosition().block.type)}
      >
        <SideMenuController
          sideMenu={(props) => (
            <SideMenu
              {...props}
              dragHandleMenu={() => (
                <DragHandleMenu>
                  <OptionsItem onOpen={(id) => h.openMenu(h.picked.includes(id) ? h.picked : [id])} />
                  <DuplicateItem />
                  <RemoveBlockItem>Delete</RemoveBlockItem>
                </DragHandleMenu>
              )}
            />
          )}
        />
        <SuggestionMenuController triggerCharacter="@" getItems={tagItems} suggestionMenuComponent={PickerMenu} onItemClick={(i: PickItem) => i.onItemClick()} />
        <SuggestionMenuController triggerCharacter="[[" getItems={pageItems} suggestionMenuComponent={PickerMenu} onItemClick={(i: PickItem) => i.onItemClick()} />
      </BlockNoteView>

      {focused && (
        <KeyboardBar
          onOutdent={() => editor.canUnnestBlock() && editor.unnestBlock()}
          onIndent={() => editor.canNestBlock() && editor.nestBlock()}
          onTag={() => editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@")}
          onType={(t) => {
            const b = current();
            turnInto([b.id], b.type === t ? "paragraph" : t);
            setCursorType(b.type === t ? "paragraph" : t);
          }}
          activeType={cursorType}
          onMenu={() => {
            const ids = targets(editor);
            (document.activeElement as HTMLElement | null)?.blur();
            h.openMenu(ids);
          }}
          onDone={() => {
            flush();
            (document.activeElement as HTMLElement | null)?.blur();
            setFocused(false);
          }}
        />
      )}

      {link !== null && (
        <Sheet title="Link" onClose={() => setLink(null)}>
          <input
            id="link-url"
            className="input"
            autoFocus
            inputMode="url"
            placeholder="Paste or type a link"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && link.trim()) {
                editor.createLink(/^[a-z]+:|^\//i.test(link.trim()) ? link.trim() : `https://${link.trim()}`);
                setLink(null);
                editor.focus();
              }
            }}
          />
          <p className="hint">Enter adds the link to the selected text.</p>
        </Sheet>
      )}

      {menuBlock && (
        <Sheet title={many ? `${menuIds.length} blocks` : "Block"} onClose={() => setMenu(null)}>
          <div className="sheet-row">
            <p className="label">Turn into</p>
            <Choice options={TURN_INTO} value={many ? "" : menuValue} onChange={(v) => turnInto(menuIds, v)} />
          </div>
          {!many && (
            <div className="sheet-row">
              <div className="chips">
                <button type="button" className="chip" onClick={() => editor.moveBlocksUp(menuBlock.id as never)}>
                  ↑ Move up
                </button>
                <button type="button" className="chip" onClick={() => editor.moveBlocksDown(menuBlock.id as never)}>
                  ↓ Move down
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    editor.setTextCursorPosition(menuBlock.id);
                    if (editor.canUnnestBlock()) editor.unnestBlock();
                  }}
                >
                  ⇤ Unindent
                </button>
                <button
                  type="button"
                  className="chip"
                  onClick={() => {
                    editor.setTextCursorPosition(menuBlock.id);
                    if (editor.canNestBlock()) editor.nestBlock();
                  }}
                >
                  Indent ⇥
                </button>
              </div>
            </div>
          )}
          <TagChoice kind="kit" all="Every kit" list={content.kits} value={many ? null : (menuTags?.kit ?? null)} onChange={(v) => setTag(menuIds, "kit", v)} />
          <TagChoice kind="technique" all="Every mode" list={content.techniques} value={many ? null : (menuTags?.technique ?? null)} onChange={(v) => setTag(menuIds, "technique", v)} />
          <TagChoice kind="consultant" all="Everyone" list={consultants} value={many ? null : (menuTags?.consultant ?? null)} onChange={(v) => setTag(menuIds, "consultant", v)} />
          {menuBlock.type === "toggleListItem" && <p className="hint">A tag on a part applies to everything inside it.</p>}
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                editor.removeBlocks(menuIds);
                h.setPicked([]);
                setMenu(null);
              }}
            >
              Delete{many ? ` ${menuIds.length} blocks` : menuBlock.children?.length ? " with what's inside" : ""}
            </button>
            <button
              type="button"
              className="mono-btn"
              data-boxed=""
              onClick={() => {
                duplicateBlocks(editor, menuIds);
                setMenu(null);
              }}
            >
              Duplicate
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

function TagChoice({ kind, all, list, value, onChange }: { kind: TagKind; all: string; list: { id: string; name: string }[]; value: string | null; onChange: (v: string | null) => void }) {
  if (!list.length) return null;
  return (
    <div className="sheet-row">
      <p className="label">Only for this {KIND_LABEL[kind].toLowerCase()}</p>
      <Choice options={[{ value: "", label: all }, ...list.map((x) => ({ value: x.id, label: x.name || "Unnamed" }))]} value={value ?? ""} onChange={(v) => onChange(v || null)} />
    </div>
  );
}

/** In the ⋮⋮ menu: our sheet with tags, turn into, move and indent. */
function OptionsItem({ onOpen }: { onOpen: (id: string) => void }) {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s) => s?.block });
  if (!block) return null;
  return (
    <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => onOpen(block.id)}>
      Tags, turn into, move…
    </Components.Generic.Menu.Item>
  );
}

function DuplicateItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s) => s?.block });
  if (!block) return null;
  return (
    <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => duplicateBlocks(editor as AnyEditor, [block.id])}>
      Duplicate
    </Components.Generic.Menu.Item>
  );
}

/** Above the phone keyboard: the keys a phone doesn't have. Tapping keeps the keyboard up. */
function KeyboardBar({
  onIndent,
  onOutdent,
  onType,
  onTag,
  onMenu,
  onDone,
  activeType,
}: {
  onIndent: () => void;
  onOutdent: () => void;
  onType: (t: string) => void;
  onTag: () => void;
  onMenu: () => void;
  onDone: () => void;
  activeType: string;
}) {
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
  const key = (label: string, aria: string, on: () => void, pressed?: boolean) => (
    <button type="button" className="kb-key" aria-label={aria} aria-pressed={pressed} onPointerDown={keep} onMouseDown={keep} onClick={on}>
      {label}
    </button>
  );
  return (
    <div className="kb-bar" style={{ bottom }}>
      {key("⇤", "Unindent", onOutdent)}
      {key("⇥", "Indent", onIndent)}
      {key("@", "Tag", onTag)}
      {key("▸", "Part", () => onType("toggleListItem"), activeType === "toggleListItem")}
      {key("•", "Bullet", () => onType("bulletListItem"), activeType === "bulletListItem")}
      {key("1.", "Numbered", () => onType("numberedListItem"), activeType === "numberedListItem")}
      {key("⋯", "More", onMenu)}
      <button type="button" className="kb-key kb-done" onPointerDown={keep} onMouseDown={keep} onClick={onDone}>
        Done
      </button>
    </div>
  );
}
