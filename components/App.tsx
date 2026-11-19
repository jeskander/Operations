"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { IDLE_MS } from "@/lib/auth";
import { matchLine, newId, searchText } from "@/lib/content";
import type { Consultant, Feedback, Filters, Operation, OperationFields, Priority, Proposal, Settings } from "@/lib/types";
import AskBar from "./AskBar";
import FeedbackView from "./FeedbackView";
import SettingsView from "./SettingsView";
import OperationPage, { type Tab } from "./OperationPage";
import ProposalSheet from "./ProposalSheet";
import ClaudeBubble, { type ChatMsg } from "./ClaudeBubble";
import SimplePage, { NoteProposalSheet } from "./SimplePage";
import type { Version } from "./VersionSwitch";

const NO_FILTERS: Filters = { kit: "", technique: "", consultant: "" };

const readFilters = (id: string): Filters => {
  try {
    return { ...NO_FILTERS, ...JSON.parse(localStorage.getItem(`op-filters-${id}`) ?? "{}") };
  } catch {
    return NO_FILTERS;
  }
};
const writeFilters = (id: string, f: Filters) => {
  try {
    localStorage.setItem(`op-filters-${id}`, JSON.stringify(f));
  } catch {}
};

const fieldsOf = (op: Operation): OperationFields => ({ name: op.name, region: op.region, subtitle: op.subtitle, content: op.content });

const SAVE_DELAY_MS = 700;
const UNDO_LIMIT = 60;

type View = { kind: "op"; id: string } | { kind: "feedback" } | { kind: "settings" } | null;

const viewFromUrl = (): View => {
  const q = new URLSearchParams(window.location.search);
  if (q.get("op")) return { kind: "op", id: q.get("op")! };
  if (q.has("feedback")) return { kind: "feedback" };
  if (q.has("settings")) return { kind: "settings" };
  return null;
};

const urlOf = (v: View) => (!v ? "/" : v.kind === "op" ? `/?op=${v.id}` : `/?${v.kind}`);

/** "feedback: …" in any Claude bar adds to the feedback list instead. */
const asFeedback = (text: string) => text.match(/^\s*(?:add\s+)?feedback\s*[:\-–]\s*([\s\S]+)/i)?.[1]?.trim() ?? null;

/** Ping the server at most this often while you're using the page, so reading keeps it unlocked. */
const PING_MS = 60_000;

export default function App() {
  const [ops, setOpsState] = useState<Operation[] | null>(null);
  const opsRef = useRef<Operation[] | null>(null);
  const setOps = (next: Operation[] | null) => {
    opsRef.current = next;
    setOpsState(next);
  };
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const consultantsRef = useRef<Consultant[]>([]);
  consultantsRef.current = consultants;
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("steps");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [ai, setAi] = useState<{ busy: boolean; note: string | null; error: boolean; where: "home" | "op" }>({
    busy: false,
    note: null,
    error: false,
    where: "op",
  });
  const [chatOpen, setChatOpen] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const chatRef = useRef<ChatMsg[]>([]);
  chatRef.current = chat;
  const [proposal, setProposal] = useState<{ opId: string; instruction: string; proposal: Proposal } | null>(null);
  const [noteProposal, setNoteProposal] = useState<{ opId: string; instruction: string; summary: string[]; html: string; before: string } | null>(null);
  // Simple (one note) or full (steps, tabs, tags). Kept per device; simple unless switched.
  // Simple (one note), Notion-style or Classic (the full page with either steps editor). Kept per device.
  const [mode, setModeState] = useState<Version>("notion");
  useEffect(() => {
    try {
      const saved = localStorage.getItem("op-version");
      if (saved === "classic" || saved === "simple") setModeState(saved);
    } catch {}
  }, []);
  const setMode = (m: Version) => {
    setModeState(m);
    try {
      localStorage.setItem("op-version", m);
    } catch {}
  };
  const [accepting, setAccepting] = useState(false);
  const [toast, setToast] = useState<{ text: string; undoId?: string } | null>(null);
  const [creating, setCreating] = useState<{ name: string; region: string } | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [, bump] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const undo = useRef(new Map<string, OperationFields[]>());
  const [settings, setSettings] = useState<Settings>({ instructions: "", parts: [], groups: [] });
  const [feedback, setFeedback] = useState<Feedback[] | null>(null);

  // ---------- Load ----------

  const load = useCallback(
    () =>
      api<{ operations: Operation[]; consultants: Consultant[] }>("/api/operations")
        .then((r) => {
          setOps(r.operations);
          setConsultants(r.consultants);
          setLoadError(null);
        })
        .catch((e: Error) => setLoadError(e.message)),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    load();
    api<{ settings: Settings }>("/api/settings")
      .then((r) => setSettings(r.settings))
      .catch(() => {});
    setView(viewFromUrl());
    const onPop = () => setView(viewFromUrl());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

  const op = view?.kind === "op" ? (ops?.find((o) => o.id === view.id) ?? null) : null;

  useEffect(() => {
    if (view?.kind === "feedback" && !feedback)
      api<{ feedback: Feedback[] }>("/api/feedback")
        .then((r) => setFeedback(r.feedback))
        .catch((e: Error) => setToast({ text: e.message }));
  }, [view?.kind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (op) setFilters(readFilters(op.id));
  }, [op?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const go = (next: View) => {
    const url = urlOf(next);
    if (url !== window.location.pathname + window.location.search) window.history.pushState(null, "", url);
    setView(next);
    setTab("steps");
    setSaveState("idle");
    mainRef.current?.scrollTo(0, 0);
  };

  const back = () => {
    if (window.history.length > 1) window.history.back();
    else go(null);
  };

  const replaceOp = (o: Operation) => {
    const list = opsRef.current ?? [];
    setOps(list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [...list, o]);
  };

  // ---------- Notion's app-wide keys ----------

  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.dataset.theme === "dark"), []);
  const setTheme = (on: boolean) => {
    setDark(on);
    document.documentElement.dataset.theme = on ? "dark" : "light";
    try {
      localStorage.setItem("op-theme", on ? "dark" : "light");
    } catch {}
  };

  const focusSearch = () => {
    setSidebarHidden(false);
    if (window.matchMedia("(max-width: 820px)").matches) go(null);
    requestAnimationFrame(() => {
      const el = document.getElementById("search") as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  };

  const keysRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keysRef.current = (e: KeyboardEvent) => {
    if (e.defaultPrevented || !(e.metaKey || e.ctrlKey)) return;
    const k = e.key.toLowerCase();
    const inEditor = !!(e.target as HTMLElement | null)?.closest?.(".bn-editor");
    if ((k === "p" || (k === "k" && !inEditor)) && !e.altKey) {
      e.preventDefault();
      focusSearch();
    } else if (k === "[" || k === "]") {
      e.preventDefault();
      if (k === "[") window.history.back();
      else window.history.forward();
    } else if (k === "\\") {
      e.preventDefault();
      setSidebarHidden((v) => !v);
    } else if (k === "l" && e.shiftKey) {
      e.preventDefault();
      setTheme(!dark);
    } else if (k === "n" && !e.shiftKey) {
      // Browsers may keep Cmd+N for a new window; where they let it through, it starts a new operation.
      e.preventDefault();
      setSidebarHidden(false);
      go(null);
      setCreating({ name: "", region: settings.groups[0] ?? "Other" });
    }
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keysRef.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  // ---------- Locking after 10 minutes without use ----------

  const lastUse = useRef(Date.now());
  const lastPing = useRef(Date.now());
  const locking = useRef(false);

  const lock = useCallback(async () => {
    if (locking.current) return;
    locking.current = true;
    for (const id of [...timers.current.keys()]) {
      clearTimeout(timers.current.get(id));
      await saveNowRef.current?.(id, true);
    }
    await fetch("/api/logout", { method: "POST", keepalive: true }).catch(() => {});
    window.location.replace("/login");
  }, []);

  useEffect(() => {
    const used = () => {
      const now = Date.now();
      if (now - lastUse.current > IDLE_MS) return lock(); // came back to it too late
      lastUse.current = now;
      if (now - lastPing.current > PING_MS) {
        lastPing.current = now;
        fetch("/api/ping", { method: "POST" }).then((r) => {
          if (r.status === 401) lock();
        }, () => {});
      }
    };
    const check = () => {
      if (Date.now() - lastUse.current > IDLE_MS) lock();
    };
    const onVisible = () => document.visibilityState === "visible" && check();
    const events = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;
    for (const e of events) window.addEventListener(e, used, { capture: true, passive: true });
    document.addEventListener("visibilitychange", onVisible);
    const t = setInterval(check, 15_000);
    return () => {
      for (const e of events) window.removeEventListener(e, used, { capture: true });
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(t);
    };
  }, [lock]);

  // ---------- Saving: every change saves itself shortly after ----------

  const saveNow = useCallback(async (id: string, keepalive = false) => {
    timers.current.delete(id);
    const cur = opsRef.current?.find((o) => o.id === id);
    if (!cur) return;
    try {
      const res = await fetch(`/api/operations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fieldsOf(cur), source: "auto" }),
        keepalive,
      });
      if (res.status === 401) window.location.href = "/login";
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "Couldn't save");
      if (!timers.current.size) setSaveState("saved");
    } catch (e) {
      setSaveState("error");
      setToast({ text: `Not saved: ${(e as Error).message}` });
    }
  }, []);

  const saveNowRef = useRef(saveNow);
  saveNowRef.current = saveNow;

  const scheduleSave = (id: string) => {
    clearTimeout(timers.current.get(id));
    setSaveState("saving");
    timers.current.set(
      id,
      setTimeout(() => saveNow(id), SAVE_DELAY_MS),
    );
  };

  useEffect(() => {
    const flush = () => {
      for (const id of [...timers.current.keys()]) {
        clearTimeout(timers.current.get(id));
        saveNow(id, true);
      }
    };
    const onHide = () => document.visibilityState === "hidden" && flush();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flush);
    };
  }, [saveNow]);

  const pushUndo = (o: Operation) => {
    const stack = undo.current.get(o.id) ?? [];
    stack.push(fieldsOf(o));
    if (stack.length > UNDO_LIMIT) stack.shift();
    undo.current.set(o.id, stack);
    bump((n) => n + 1);
  };

  const change = (id: string, next: OperationFields | ((f: OperationFields) => OperationFields)) => {
    const cur = opsRef.current?.find((o) => o.id === id);
    if (!cur) return;
    const fields = typeof next === "function" ? next(fieldsOf(cur)) : next;
    if (JSON.stringify(fields) === JSON.stringify(fieldsOf(cur))) return;
    pushUndo(cur);
    replaceOp({ ...cur, ...fields });
    scheduleSave(id);
  };

  const undoLast = (id: string) => {
    const stack = undo.current.get(id);
    const prev = stack?.pop();
    const cur = opsRef.current?.find((o) => o.id === id);
    if (!prev || !cur) return;
    bump((n) => n + 1);
    replaceOp({ ...cur, ...prev });
    scheduleSave(id);
  };

  // ---------- List ----------

  const groups = useMemo(() => {
    if (!ops) return [];
    const q = query.trim().toLowerCase();
    const shown = q ? ops.filter((o) => q.split(/\s+/).every((w) => searchText(o).includes(w))) : ops;
    const byRegion = new Map<string, Operation[]>();
    for (const o of [...shown].sort((a, b) => a.name.localeCompare(b.name))) byRegion.set(o.region, [...(byRegion.get(o.region) ?? []), o]);
    const order = (r: string) => (settings.groups.indexOf(r) === -1 ? 99 : settings.groups.indexOf(r));
    return [...byRegion.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [ops, query, settings.groups]);

  const create = async () => {
    if (!creating?.name.trim()) return;
    try {
      const r = await api<{ operation: Operation }>("/api/operations", { method: "POST", body: creating });
      replaceOp(r.operation);
      setCreating(null);
      go({ kind: "op", id: r.operation.id });
    } catch (e) {
      setToast({ text: (e as Error).message });
    }
  };

  // ---------- Claude ----------

  const proposeNote = async (target: Operation, instruction: string) => {
    if (timers.current.has(target.id)) await saveNow(target.id); // Claude works from what's saved
    setAi({ busy: true, note: "Claude is working on it…", error: false, where: "op" });
    try {
      const r = await api<{ proposal: { summary: string[]; html: string; before: string } }>(`/api/operations/${target.id}/note-ai`, {
        method: "POST",
        body: { instruction },
      });
      setNoteProposal({ opId: target.id, instruction, ...r.proposal });
      setAi({ busy: false, note: null, error: false, where: "op" });
    } catch (e) {
      setAi({ busy: false, note: (e as Error).message, error: true, where: "op" });
    }
  };

  const acceptNote = () => {
    if (!noteProposal) return;
    const { opId, html } = noteProposal;
    change(opId, (f) => ({ ...f, content: { ...f.content, note: html } }));
    setNoteProposal(null);
    setToast({ text: "Saved", undoId: opId });
  };

  const propose = async (target: Operation, instruction: string) => {
    if (mode === "simple") return proposeNote(target, instruction);
    if (timers.current.has(target.id)) await saveNow(target.id); // Claude works from what's saved
    setAi({ busy: true, note: "Claude is working on it…", error: false, where: "op" });
    try {
      const r = await api<{ proposal: Proposal }>(`/api/operations/${target.id}/ai`, { method: "POST", body: { instruction } });
      setProposal({ opId: target.id, instruction, proposal: r.proposal });
      setAi({ busy: false, note: null, error: false, where: "op" });
    } catch (e) {
      setAi({ busy: false, note: (e as Error).message, error: true, where: "op" });
    }
  };

  /** From the home screen: find the operation, open it, then make the change there. */
  // ---------- Feedback ----------

  const addFeedback = async (text: string, priority: Priority = "P2") => {
    try {
      const r = await api<{ item: Feedback }>("/api/feedback", { method: "POST", body: { text, priority } });
      setFeedback((f) => (f ? [r.item, ...f] : f));
      setToast({ text: "Added to feedback" });
    } catch (e) {
      setToast({ text: (e as Error).message });
    }
  };
  const updateFeedback = (id: string, patch: { priority?: Priority; done?: boolean; text?: string }) => {
    setFeedback((f) =>
      f?.map((x) =>
        x.id === id
          ? { ...x, ...(patch.text !== undefined ? { text: patch.text } : {}), ...(patch.priority ? { priority: patch.priority } : {}), ...(patch.done !== undefined ? { doneAt: patch.done ? new Date().toISOString() : null } : {}) }
          : x,
      ) ?? null,
    );
    api(`/api/feedback/${id}`, { method: "PATCH", body: patch }).catch((e: Error) => setToast({ text: e.message }));
  };
  const deleteFeedback = (id: string) => {
    setFeedback((f) => f?.filter((x) => x.id !== id) ?? null);
    api(`/api/feedback/${id}`, { method: "DELETE" }).catch((e: Error) => setToast({ text: e.message }));
  };

  const fileFromHome = async (text: string) => {
    const fb = asFeedback(text);
    if (fb) {
      setChatOpen(false);
      return addFeedback(fb);
    }
    setAi({ busy: true, note: "Thinking…", error: false, where: "home" });
    try {
      const earlier = chatRef.current;
      const context = earlier.slice(-6).map((m) => `${m.role === "user" ? "Surgeon" : "Claude"}: ${m.content}`).join("\n");
      const r = await api<{ intent: "learning" | "question"; relevantIds: string[]; operationId: string | null; newName: string | null; region: string | null }>(
        "/api/route-learning",
        { method: "POST", body: { text, context } },
      );
      if (r.intent === "question") {
        const history = [...earlier, { role: "user" as const, content: text }];
        setChat(history);
        setAi({ busy: true, note: "Reading your notes…", error: false, where: "home" });
        const a = await api<{ answer: string; sources: { id: string; name: string }[] }>("/api/ask", {
          method: "POST",
          body: { history: history.map(({ role, content }) => ({ role, content })), opIds: r.relevantIds },
        });
        setChat([...history, { role: "assistant", content: a.answer, sources: a.sources }]);
        setAi({ busy: false, note: null, error: false, where: "home" });
        return;
      }
      setAi({ busy: true, note: "Finding the operation…", error: false, where: "home" });
      let target = opsRef.current?.find((o) => o.id === r.operationId) ?? null;
      if (!target) {
        if (!r.newName) throw new Error("Couldn't tell which operation this is about. Open it and add it there.");
        const made = await api<{ operation: Operation }>("/api/operations", { method: "POST", body: { name: r.newName, region: r.region ?? "Other" } });
        target = made.operation;
        replaceOp(target);
      }
      setChatOpen(false);
      go({ kind: "op", id: target.id });
      await propose(target, text);
    } catch (e) {
      setAi({ busy: false, note: (e as Error).message, error: true, where: "home" });
    }
  };

  const accept = async () => {
    if (!proposal) return;
    const before = opsRef.current?.find((o) => o.id === proposal.opId);
    setAccepting(true);
    try {
      const r = await api<{ operation: Operation; consultants: Consultant[] }>(`/api/operations/${proposal.opId}/accept`, {
        method: "POST",
        body: { proposal: proposal.proposal, instruction: proposal.instruction },
      });
      if (before) pushUndo(before);
      replaceOp(r.operation);
      setConsultants(r.consultants);
      setProposal(null);
      setToast({ text: "Saved", undoId: proposal.opId });
    } catch (e) {
      setToast({ text: (e as Error).message });
    } finally {
      setAccepting(false);
    }
  };

  // ---------- Consultants (shared by every operation) ----------

  const putConsultants = async (list: Consultant[]) => {
    const r = await api<{ consultants: Consultant[] }>("/api/consultants", { method: "PUT", body: { consultants: list } });
    setConsultants(r.consultants);
    return r.consultants;
  };

  const addConsultant = async (name: string) => {
    try {
      const saved = await putConsultants([...consultantsRef.current, { id: newId(), name }]);
      return saved.find((c) => c.name === name && !consultantsRef.current.some((o) => o.id === c.id)) ?? saved[saved.length - 1] ?? null;
    } catch (e) {
      setToast({ text: (e as Error).message });
      return null;
    }
  };

  const renameConsultant = (id: string, name: string) =>
    putConsultants(consultantsRef.current.map((c) => (c.id === id ? { ...c, name } : c))).catch((e: Error) => setToast({ text: e.message }));

  const removeConsultant = (id: string) =>
    putConsultants(consultantsRef.current.filter((c) => c.id !== id)).catch((e: Error) => setToast({ text: e.message }));

  // ---------- Other ----------

  const remove = async () => {
    if (!op) return;
    clearTimeout(timers.current.get(op.id));
    timers.current.delete(op.id);
    try {
      await api(`/api/operations/${op.id}`, { method: "DELETE" });
      setOps(opsRef.current?.filter((o) => o.id !== op.id) ?? null);
      setToast({ text: `Deleted ${op.name}` });
      go(null);
    } catch (e) {
      setToast({ text: (e as Error).message });
    }
  };

  const setFilter = (k: keyof Filters, v: string) => {
    if (!op) return;
    setFilters((f) => {
      const next = { ...f, [k]: v };
      writeFilters(op.id, next);
      return next;
    });
  };

  const saveSettings = async (s: Settings) => {
    const r = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: s });
    setSettings(r.settings);
  };

  const opsList = useMemo(() => (ops ?? []).map((o) => ({ id: o.id, name: o.name })), [ops]);

  const proposalOp = proposal ? ops?.find((o) => o.id === proposal.opId) : null;

  return (
    <div className="shell" data-view={view ? "op" : "list"} data-sidebar={sidebarHidden ? "hidden" : undefined}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="wordmark">Operations</span>
        </div>
        <input id="search" className="search" type="search" placeholder="Search everything" value={query} onChange={(e) => setQuery(e.target.value)} />
        {creating ? (
          <form
            className="new-op-form"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input id="new-name" className="input" placeholder="Operation name" autoFocus value={creating.name} onChange={(e) => setCreating({ ...creating, name: e.target.value })} />
            <select id="new-region" className="select" value={creating.region} onChange={(e) => setCreating({ ...creating, region: e.target.value })}>
              {settings.groups.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <div className="new-op-actions">
              <button type="button" className="mono-btn" onClick={() => setCreating(null)}>
                Cancel
              </button>
              <button className="mono-btn" data-primary="" disabled={!creating.name.trim()}>
                Create
              </button>
            </div>
          </form>
        ) : (
          <button className="new-op" onClick={() => setCreating({ name: query.trim(), region: settings.groups[0] ?? "Other" })}>
            <span className="plus">+</span> New operation
          </button>
        )}

        <nav className="groups">
          {!ops && !loadError && <p className="empty-list reading">Loading…</p>}
          {loadError && <p className="empty-list">{loadError}</p>}
          {ops && !groups.length && <p className="empty-list">{query ? "Nothing matches." : "No operations yet."}</p>}
          {groups.map(([region, list]) => (
            <div key={region} className="group">
              <p className="label">{region}</p>
              {list.map((o) => {
                const hit = query.trim() ? matchLine(o, query.trim()) : null;
                return (
                  <button key={o.id} className="op-row" aria-current={view?.kind === "op" && view.id === o.id ? true : undefined} onClick={() => go({ kind: "op", id: o.id })}>
                    <span className="op-name">{o.name}</span>
                    {(hit || o.subtitle) && <span className="op-sub">{hit ?? o.subtitle}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <button className="mono-btn" aria-current={view?.kind === "feedback" || undefined} onClick={() => go({ kind: "feedback" })}>
            Feedback
          </button>
          <button className="mono-btn" aria-current={view?.kind === "settings" || undefined} onClick={() => go({ kind: "settings" })}>
            Settings
          </button>
          <button className="mono-btn" onClick={lock}>
            Lock
          </button>
        </div>
      </aside>

      <main className="main" ref={mainRef}>
        {view?.kind === "feedback" && <FeedbackView items={feedback} onAdd={addFeedback} onUpdate={updateFeedback} onDelete={deleteFeedback} onBack={back} />}

        {view?.kind === "settings" && (
          <SettingsView
            key={JSON.stringify(settings) + consultants.length}
            settings={settings}
            consultants={consultants}
            onSave={saveSettings}
            onSaveConsultants={async (list) => {
              await putConsultants(list);
            }}
            onLock={lock}
            onBack={back}
            dark={dark}
            onDark={setTheme}
            mode={mode}
            onMode={setMode}
          />
        )}

        {view?.kind === "op" && !op && (
          <div className="home">
            <div>
              <button className="back" onClick={back}>
                ← Operations
              </button>
              <p className={ops ? "" : "reading"}>{ops ? "This operation isn't here any more." : "Loading…"}</p>
            </div>
          </div>
        )}

        {!view && <div className="home">Choose an operation, or add a learning and Claude will file it.</div>}

        {op && mode === "simple" && (
          <SimplePage
            op={op}
            consultants={consultants}
            groups={settings.groups}
            change={(next) => change(op.id, next)}
            saveState={saveState}
            canUndo={!!undo.current.get(op.id)?.length}
            onUndo={() => undoLast(op.id)}
            onDelete={remove}
            onBack={back}
            version={mode}
            onVersion={setMode}
          />
        )}

        {op && (
          <>
            {mode !== "simple" && (
            <OperationPage
              op={op}
              groups={settings.groups}
              operations={opsList}
              onSearch={focusSearch}
              version={mode}
              onVersion={setMode}
              consultants={consultants}
              filters={filters}
              setFilter={setFilter}
              tab={tab}
              setTab={setTab}
              change={(next) => change(op.id, next)}
              saveState={saveState}
              canUndo={!!undo.current.get(op.id)?.length}
              onUndo={() => undoLast(op.id)}
              onDelete={remove}
              onBack={back}
              addConsultant={addConsultant}
              renameConsultant={renameConsultant}
              removeConsultant={removeConsultant}
            />
            )}
            <AskBar
              placeholder="Ask Claude to add or change something…"
              busy={ai.busy && ai.where === "op"}
              note={ai.where === "op" ? ai.note : null}
              error={ai.error}
              onSend={(text) => {
                const fb = asFeedback(text);
                if (fb) addFeedback(fb);
                else propose(op, text);
              }}
            />
          </>
        )}
      </main>

      {!proposal && !noteProposal && (
        <ClaudeBubble
          open={chatOpen}
          onOpen={() => setChatOpen(true)}
          onClose={() => setChatOpen(false)}
          aboveAsk={view?.kind === "op"}
          busy={ai.busy && ai.where === "home"}
          note={ai.where === "home" ? ai.note : null}
          error={ai.error}
          onSend={fileFromHome}
          chat={chat}
          onClear={() => setChat([])}
          onOpenOp={(id) => {
            setChatOpen(false);
            go({ kind: "op", id });
          }}
        />
      )}
      {noteProposal && (
        <NoteProposalSheet
          instruction={noteProposal.instruction}
          summary={noteProposal.summary}
          before={noteProposal.before}
          after={noteProposal.html}
          onAccept={acceptNote}
          onDiscard={() => setNoteProposal(null)}
        />
      )}

      {proposal && proposalOp && (
        <ProposalSheet
          op={proposalOp}
          consultants={consultants}
          instruction={proposal.instruction}
          proposal={proposal.proposal}
          busy={accepting}
          onAccept={accept}
          onDiscard={() => setProposal(null)}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          <span>{toast.text}</span>
          {toast.undoId && (
            <button
              className="mono-btn"
              onClick={() => {
                undoLast(toast.undoId!);
                setToast({ text: "Undone" });
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}
