"use client";

import "@blocknote/mantine/style.css";
import { BlockNoteSchema, createExtension, createHeadingBlockSpec, defaultBlockSpecs } from "@blocknote/core";
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
} from "@blocknote/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { visibleBlocks } from "@/lib/blocks";
import { fromBN, shape, toBN, type BNBlock } from "@/lib/bn";
import { newId } from "@/lib/content";
import type { Block, BlockType, Consultant, Content, Filters } from "@/lib/types";
import Sheet, { Choice } from "./Sheet";

type Update = (next: Content | ((c: Content) => Content)) => void;
type TagKind = "kit" | "technique" | "consultant";
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

/** As in Notion, "> " starts a toggle (a part). BlockNote would make a quote; '" ' still does. */
const toggleShortcut = createExtension({
  key: "notionToggleShortcut",
  runsBefore: ["quote"],
  inputRules: [{ find: /^>\s$/, replace: () => ({ type: "toggleListItem", props: {} }) }],
});

const TURN_INTO: { value: string; label: string; props?: Record<string, unknown> }[] = [
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
  "align-self:center;margin-left:.5rem;padding:0 .45rem;border-radius:999px;background:var(--paper-2);font-family:var(--mono);font-size:.64rem;font-weight:400;font-style:normal;letter-spacing:.06em;color:var(--graphite);white-space:nowrap;pointer-events:none;flex:none";

const stripIds = (b: BNBlock): Omit<BNBlock, "id"> => ({ type: b.type, props: b.props, content: b.content, children: (b.children ?? []).map((c) => stripIds(c) as BNBlock) });

type Props = {
  opId: string;
  content: Content;
  consultants: Consultant[];
  filters: Filters;
  update: Update;
  addConsultant: (name: string) => Promise<Consultant | null>;
};

export default function BlockEditor({ opId, content, consultants, filters, update, addConsultant }: Props) {
  const contentRef = useRef(content);
  contentRef.current = content;
  const lastShape = useRef(shape(content.blocks));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [cursorType, setCursorType] = useState("");
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
      extensions: [toggleShortcut],
      placeholders: { default: "Type / for blocks, > for a part, @ to tag", emptyDocument: "Type / for blocks, > for a part, @ to tag" },
    },
    [opId],
  );

  // ---------- Saving: the editor's document back into the page ----------

  const tagsOf = useCallback((id: string) => contentRef.current.blocks.find((b) => b.id === id), []);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const flat = fromBN(editor.document as unknown as BNBlock[], tagsOf);
    const s = shape(flat);
    if (s === lastShape.current) return;
    lastShape.current = s;
    update((c) => ({ ...c, blocks: flat }));
  }, [editor, tagsOf, update]);

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

  // ---------- Tags and filters, drawn onto the editor's blocks ----------

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const k of content.kits) m.set(`kit:${k.id}`, k.name);
    for (const t of content.techniques) m.set(`technique:${t.id}`, t.name);
    for (const c of consultants) m.set(`consultant:${c.id}`, c.name);
    return m;
  }, [content.kits, content.techniques, consultants]);

  // Drawn with a stylesheet keyed by block id: the editor redraws anything that edits its own HTML.
  const tagCss = useMemo(() => {
    const blocks = content.blocks;
    const shownIds = new Set(visibleBlocks(blocks, filters, new Set()).map((b) => b.id));
    const str = (v: string) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
    const rules: string[] = [];
    for (const b of blocks) {
      const sel = `.op-editor .bn-block-outer[data-id="${b.id.replace(/["\\]/g, "")}"]`;
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
        rules.push(
          `${sel}>.bn-block>.bn-block-content::after,${sel}>.bn-block>.bn-toggle-wrapper>.bn-toggle-slot>.bn-block-content::after{content:${str(tags.join(" · "))};${PILL}}`,
        );
    }
    return rules.join("\n");
  }, [content.blocks, filters, names]);

  // ---------- Tagging ----------

  const setTag = (id: string, kind: TagKind, value: string | null) => {
    flush(); // a block you've just typed is saved before it's tagged
    update((c) => ({ ...c, blocks: c.blocks.map((b) => (b.id === id ? { ...b, [kind]: value } : b)) }));
  };

  const tagItems = async (query: string) => {
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
      title: o.id ? o.name : `New ${KIND_LABEL[o.kind].toLowerCase()} “${o.name}”`,
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
        setTag(blockId, o.kind, id);
      },
    }));
  };

  // ---------- Phone toolbar ----------

  useEffect(() => {
    const root = editor.domElement;
    if (!root) return;
    const onIn = () => setFocused(true);
    const onOut = (e: FocusEvent) => {
      const to = e.relatedTarget as HTMLElement | null;
      if (!to?.closest(".kb-bar")) setFocused(false);
    };
    root.addEventListener("focusin", onIn);
    root.addEventListener("focusout", onOut);
    return () => {
      root.removeEventListener("focusin", onIn);
      root.removeEventListener("focusout", onOut);
    };
  }, [editor, editor.domElement]);

  useEffect(() => {
    if (focused) document.body.dataset.editing = "";
    else delete document.body.dataset.editing;
    return () => {
      delete document.body.dataset.editing;
    };
  }, [focused]);

  const turnInto = (id: string, value: string) => {
    const [type, level] = value.split(":");
    editor.updateBlock(id, { type, props: level ? { level: Number(level) } : {} } as never);
  };

  const current = () => editor.getTextCursorPosition().block;

  // ---------- Block options sheet ----------

  const menuBlock = menu ? (editor.getBlock(menu) as unknown as BNBlock | undefined) : undefined;
  const menuTags: Block | undefined = menu ? content.blocks.find((b) => b.id === menu) : undefined;
  const menuValue = menuBlock ? (menuBlock.type === "heading" ? `heading:${(menuBlock.props?.level as number) ?? 2}` : menuBlock.type) : "";

  return (
    <div className="op-editor" ref={wrap}>
      <style>{tagCss}</style>
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
                  <OptionsItem onOpen={setMenu} />
                  <DuplicateItem />
                  <RemoveBlockItem>Delete</RemoveBlockItem>
                </DragHandleMenu>
              )}
            />
          )}
        />
        <SuggestionMenuController triggerCharacter="@" getItems={tagItems} />
      </BlockNoteView>

      {focused && (
        <KeyboardBar
          onOutdent={() => editor.canUnnestBlock() && editor.unnestBlock()}
          onIndent={() => editor.canNestBlock() && editor.nestBlock()}
          onTag={() => editor.getExtension(SuggestionMenu)?.openSuggestionMenu("@")}
          onType={(t) => {
            const b = current();
            turnInto(b.id, b.type === t ? "paragraph" : t);
            setCursorType(b.type === t ? "paragraph" : t);
          }}
          activeType={cursorType}
          onMenu={() => {
            const id = current().id;
            flush();
            (document.activeElement as HTMLElement | null)?.blur();
            setMenu(id);
          }}
          onDone={() => {
            flush();
            (document.activeElement as HTMLElement | null)?.blur();
            setFocused(false);
          }}
        />
      )}

      {menuBlock && (
        <Sheet title="Block" onClose={() => setMenu(null)}>
          <div className="sheet-row">
            <p className="label">Turn into</p>
            <Choice options={TURN_INTO.map((t) => ({ value: t.value, label: t.label }))} value={menuValue} onChange={(v) => turnInto(menuBlock.id, v)} />
          </div>
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
          <TagChoice kind="kit" all="Every kit" list={content.kits} value={menuTags?.kit ?? null} onChange={(v) => setTag(menuBlock.id, "kit", v)} />
          <TagChoice kind="technique" all="Every mode" list={content.techniques} value={menuTags?.technique ?? null} onChange={(v) => setTag(menuBlock.id, "technique", v)} />
          <TagChoice kind="consultant" all="Everyone" list={consultants} value={menuTags?.consultant ?? null} onChange={(v) => setTag(menuBlock.id, "consultant", v)} />
          {menuBlock.type === "toggleListItem" && <p className="hint">A tag on a part applies to everything inside it.</p>}
          <div className="sheet-actions">
            <button
              type="button"
              className="mono-btn"
              data-danger=""
              onClick={() => {
                editor.removeBlocks([menuBlock.id]);
                setMenu(null);
              }}
            >
              Delete{menuBlock.children?.length ? " with what's inside" : ""}
            </button>
            <button
              type="button"
              className="mono-btn"
              data-boxed=""
              onClick={() => {
                editor.insertBlocks([stripIds(menuBlock) as never], menuBlock.id, "after");
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
    <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => editor.insertBlocks([stripIds(block as unknown as BNBlock) as never], block.id, "after")}>
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

export type { BlockType };
