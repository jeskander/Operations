"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { REGIONS, matchLine, newId, searchText } from "@/lib/content";
import type { Consultant, Filters, Operation, OperationFields, Proposal } from "@/lib/types";
import AskBar from "./AskBar";
import { EditBar, EditHead, EditPanel, fromDraft, toDraft, type Draft } from "./Editor";
import { Panel, TABS, counts, type Tab } from "./OperationView";
import ProposalSheet from "./ProposalSheet";

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

type View = { kind: "op"; id: string } | { kind: "consultants" } | null;

const viewFromUrl = (): View => {
  const p = new URLSearchParams(window.location.search);
  if (p.get("op")) return { kind: "op", id: p.get("op")! };
  if (p.has("consultants")) return { kind: "consultants" };
  return null;
};

export default function App() {
  const [ops, setOps] = useState<Operation[] | null>(null);
  const [consultants, setConsultants] = useState<Consultant[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("steps");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [ai, setAi] = useState<{ busy: boolean; note: string | null; error: boolean; where: "home" | "op" }>({
    busy: false,
    note: null,
    error: false,
    where: "op",
  });
  const [proposal, setProposal] = useState<{ opId: string; instruction: string; proposal: Proposal } | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: { id: string; fields: OperationFields } } | null>(null);
  const [creating, setCreating] = useState<{ name: string; region: string } | null>(null);
  const mainRef = useRef<HTMLElement>(null);

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
    [],
  );

  useEffect(() => {
    load();
    setView(viewFromUrl());
    const onPop = () => {
      setView(viewFromUrl());
      setDraft(null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

  const op = view?.kind === "op" ? (ops?.find((o) => o.id === view.id) ?? null) : null;

  useEffect(() => {
    if (op) setFilters(readFilters(op.id));
  }, [op?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const go = (next: View) => {
    const url = next?.kind === "op" ? `/?op=${next.id}` : next?.kind === "consultants" ? "/?consultants" : "/";
    if (url !== window.location.pathname + window.location.search) window.history.pushState(null, "", url);
    setView(next);
    setDraft(null);
    setTab("steps");
    mainRef.current?.scrollTo(0, 0);
  };

  const back = () => {
    if (window.history.length > 1) window.history.back();
    else go(null);
  };

  const replaceOp = (o: Operation) => setOps((list) => (list ? (list.some((x) => x.id === o.id) ? list.map((x) => (x.id === o.id ? o : x)) : [...list, o]) : [o]));

  // ---------- List ----------

  const groups = useMemo(() => {
    if (!ops) return [];
    const q = query.trim().toLowerCase();
    const shown = q ? ops.filter((o) => q.split(/\s+/).every((w) => searchText(o).includes(w))) : ops;
    const byRegion = new Map<string, Operation[]>();
    for (const o of shown) byRegion.set(o.region, [...(byRegion.get(o.region) ?? []), o]);
    const order = (r: string) => (REGIONS.indexOf(r) === -1 ? 99 : REGIONS.indexOf(r));
    return [...byRegion.entries()].sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
  }, [ops, query]);

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

  const propose = async (target: Operation, instruction: string) => {
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
  const fileFromHome = async (text: string) => {
    setAi({ busy: true, note: "Finding the operation…", error: false, where: "home" });
    try {
      const r = await api<{ operationId: string | null; newName: string | null; region: string | null }>("/api/route-learning", {
        method: "POST",
        body: { text },
      });
      let target = ops?.find((o) => o.id === r.operationId) ?? null;
      if (!target) {
        if (!r.newName) throw new Error("Couldn't tell which operation this is about. Open it and add it there.");
        const made = await api<{ operation: Operation }>("/api/operations", { method: "POST", body: { name: r.newName, region: r.region ?? "Other" } });
        target = made.operation;
        replaceOp(target);
      }
      go({ kind: "op", id: target.id });
      await propose(target, text);
    } catch (e) {
      setAi({ busy: false, note: (e as Error).message, error: true, where: "home" });
    }
  };

  const accept = async () => {
    if (!proposal) return;
    const before = ops?.find((o) => o.id === proposal.opId);
    setAccepting(true);
    try {
      const r = await api<{ operation: Operation; consultants: Consultant[] }>(`/api/operations/${proposal.opId}/accept`, {
        method: "POST",
        body: { proposal: proposal.proposal, instruction: proposal.instruction },
      });
      replaceOp(r.operation);
      setConsultants(r.consultants);
      setProposal(null);
      setToast({ text: "Saved", undo: before ? { id: before.id, fields: fieldsOf(before) } : undefined });
    } catch (e) {
      setToast({ text: (e as Error).message });
    } finally {
      setAccepting(false);
    }
  };

  // ---------- Saving by hand ----------

  const save = async () => {
    if (!op || !draft) return;
    setSaving(true);
    try {
      const r = await api<{ operation: Operation }>(`/api/operations/${op.id}`, {
        method: "PUT",
        body: { ...fromDraft(draft, op, consultants), source: "manual" },
      });
      replaceOp(r.operation);
      setDraft(null);
      setToast({ text: "Saved", undo: { id: op.id, fields: fieldsOf(op) } });
    } catch (e) {
      setToast({ text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const undo = async () => {
    const u = toast?.undo;
    if (!u) return;
    setToast(null);
    try {
      const r = await api<{ operation: Operation }>(`/api/operations/${u.id}`, { method: "PUT", body: { ...u.fields, source: "undo" } });
      replaceOp(r.operation);
      setToast({ text: "Undone" });
    } catch (e) {
      setToast({ text: (e as Error).message });
    }
  };

  const remove = async () => {
    if (!op) return;
    setSaving(true);
    try {
      await api(`/api/operations/${op.id}`, { method: "DELETE" });
      setOps((list) => list?.filter((o) => o.id !== op.id) ?? null);
      setToast({ text: `Deleted ${op.name}` });
      go(null);
    } catch (e) {
      setToast({ text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const setFilter = (k: keyof Filters, v: string) => {
    if (!op) return;
    const next = { ...filters, [k]: v };
    setFilters(next);
    writeFilters(op.id, next);
  };

  const signOut = async () => {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  };

  // ---------- Render ----------

  const usedConsultants = op
    ? consultants.filter((c) => op.content.sections.some((s) => s.items.some((i) => i.consultant === c.id)))
    : [];
  const n = op ? counts(op, filters) : null;
  const proposalOp = proposal ? ops?.find((o) => o.id === proposal.opId) : null;

  return (
    <div className="shell" data-view={view ? "op" : "list"}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <span className="wordmark">Operations</span>
        </div>
        <input
          id="search"
          className="search"
          type="search"
          placeholder="Search everything"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {creating ? (
          <form
            className="new-op-form"
            onSubmit={(e) => {
              e.preventDefault();
              create();
            }}
          >
            <input
              id="new-name"
              className="input"
              placeholder="Operation name"
              autoFocus
              value={creating.name}
              onChange={(e) => setCreating({ ...creating, name: e.target.value })}
            />
            <select id="new-region" className="select" value={creating.region} onChange={(e) => setCreating({ ...creating, region: e.target.value })}>
              {REGIONS.map((r) => (
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
          <button className="new-op" onClick={() => setCreating({ name: query.trim(), region: "Knee" })}>
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
                  <button
                    key={o.id}
                    className="op-row"
                    aria-current={view?.kind === "op" && view.id === o.id ? true : undefined}
                    onClick={() => go({ kind: "op", id: o.id })}
                  >
                    <span className="op-name">{o.name}</span>
                    {(hit || o.subtitle) && <span className="op-sub">{hit ?? o.subtitle}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <AskBar
          placeholder="Add a learning to any operation…"
          busy={ai.busy && ai.where === "home"}
          note={ai.where === "home" ? ai.note : null}
          error={ai.error}
          onSend={fileFromHome}
        />
        <div className="sidebar-foot">
          <button className="mono-btn" onClick={() => go({ kind: "consultants" })}>
            Consultants
          </button>
          <button className="mono-btn" onClick={signOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main" ref={mainRef}>
        {view?.kind === "consultants" && <Consultants consultants={consultants} onBack={back} onSaved={(c) => {
          setConsultants(c);
          setToast({ text: "Saved" });
        }} />}

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

        {op && n && (
          <>
            <header className="topbar">
              {draft ? (
                <div className="topbar-primary">
                  <button className="back" onClick={() => setDraft(null)}>
                    ← Stop editing
                  </button>
                  <EditHead draft={draft} set={setDraft} />
                </div>
              ) : (
                <>
                  <div className="topbar-primary">
                    <button className="back" onClick={back}>
                      ← Operations
                    </button>
                    <h1 className="name">{op.name}</h1>
                    {op.subtitle && <p className="subtitle">{op.subtitle}</p>}
                  </div>
                  <div className="topbar-actions">
                    <button className="mono-btn" data-boxed="" onClick={() => setDraft(toDraft(op, consultants))}>
                      Edit
                    </button>
                  </div>
                  {(op.content.kits.length > 0 || op.content.techniques.length > 0 || usedConsultants.length > 0) && (
                    <dl className="filters">
                      {op.content.kits.length > 0 && (
                        <FilterSelect label="Kit" all="All kits" value={filters.kit} options={op.content.kits} onChange={(v) => setFilter("kit", v)} />
                      )}
                      {op.content.techniques.length > 0 && (
                        <FilterSelect
                          label="Technique"
                          all="Both"
                          value={filters.technique}
                          options={op.content.techniques}
                          onChange={(v) => setFilter("technique", v)}
                        />
                      )}
                      {usedConsultants.length > 0 && (
                        <FilterSelect
                          label="Consultant"
                          all="Anyone"
                          value={filters.consultant}
                          options={usedConsultants}
                          onChange={(v) => setFilter("consultant", v)}
                        />
                      )}
                    </dl>
                  )}
                </>
              )}
              <nav className="tabs" role="tablist">
                {TABS.map((t) => (
                  <button key={t.id} className="tab" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                    {t.label}
                    {n[t.id] > 0 && <span className="tab-count">{n[t.id]}</span>}
                  </button>
                ))}
              </nav>
            </header>

            <section className="panel">
              {draft ? (
                <EditPanel draft={draft} set={setDraft} tab={tab} consultants={consultants} />
              ) : (
                <Panel op={op} consultants={consultants} filters={filters} tab={tab} />
              )}
            </section>

            {draft ? (
              <EditBar busy={saving} onSave={save} onCancel={() => setDraft(null)} onDelete={remove} />
            ) : (
              <AskBar
                placeholder="Add or change something…"
                busy={ai.busy && ai.where === "op"}
                note={ai.where === "op" ? ai.note : null}
                error={ai.error}
                onSend={(text) => propose(op, text)}
              />
            )}
          </>
        )}
      </main>

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
          {toast.undo && (
            <button className="mono-btn" onClick={undo}>
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  all,
  value,
  options,
  onChange,
}: {
  label: string;
  all: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (v: string) => void;
}) {
  const valid = options.some((o) => o.id === value) ? value : "";
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd>
        <select aria-label={label} value={valid} data-any={valid ? undefined : ""} onChange={(e) => onChange(e.target.value)}>
          <option value="">{all}</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </dd>
    </div>
  );
}

function Consultants({ consultants, onBack, onSaved }: { consultants: Consultant[]; onBack: () => void; onSaved: (c: Consultant[]) => void }) {
  const [list, setList] = useState(consultants);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ consultants: Consultant[] }>("/api/consultants", { method: "PUT", body: { consultants: list.filter((c) => c.name.trim()) } });
      setList(r.consultants);
      onSaved(r.consultants);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="topbar">
        <div className="topbar-primary">
          <button className="back" onClick={onBack}>
            ← Operations
          </button>
          <h1 className="page-title">Consultants</h1>
          <p className="subtitle">Mark a step for one consultant and it shows only when you choose them.</p>
        </div>
      </header>
      <section className="panel">
        {list.map((c, i) => (
          <div key={c.id} className="edit-block">
            <div className="edit-row">
              <input
                id={`c-${c.id}`}
                className="input"
                value={c.name}
                placeholder="e.g. Mr Smith"
                onChange={(e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
              <button className="mono-btn" aria-label="Remove" onClick={() => setList(list.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          </div>
        ))}
        <button className="mono-btn add-btn" data-boxed="" onClick={() => setList([...list, { id: newId(), name: "" }])}>
          + Consultant
        </button>
        {error && <p className="hint">{error}</p>}
      </section>
      <div className="edit-bar">
        <div />
        <div>
          <button className="mono-btn" data-primary="" onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}
