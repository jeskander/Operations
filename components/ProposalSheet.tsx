"use client";

import type { Consultant, Content, Operation, Proposal } from "@/lib/types";

type Line = { kind: "add" | "del"; text: string };
type Group = { title: string; lines: Line[] };

/** What Claude's version adds and removes, grouped by where it is on the page. */
function diff(before: Operation, after: Proposal, consultants: Consultant[]): Group[] {
  const groups: Group[] = [];
  const a = before.content;
  const b = after.operation.content;
  const people = [...consultants, ...after.newConsultants];
  const named = (c: Content, it: { kit: string | null; technique: string | null; consultant: string | null }) =>
    [c.kits.find((k) => k.id === it.kit)?.name, c.techniques.find((t) => t.id === it.technique)?.name, people.find((p) => p.id === it.consultant)?.name]
      .filter(Boolean)
      .map((n) => ` @${n}`)
      .join("");

  const compare = (title: string, oldLines: string[], newLines: string[]) => {
    const oldSet = new Set(oldLines);
    const newSet = new Set(newLines);
    const lines: Line[] = [
      ...oldLines.filter((l) => !newSet.has(l)).map((text) => ({ kind: "del" as const, text })),
      ...newLines.filter((l) => !oldSet.has(l)).map((text) => ({ kind: "add" as const, text })),
    ];
    if (lines.length) groups.push({ title, lines });
  };

  // Steps: each block under the part it sits in; a block that moved part shows as removed and added.
  const byPart = (c: Content) => {
    const parts = new Map<string, string[]>();
    let part = "Steps";
    for (const blk of c.blocks) {
      if (blk.depth === 0) part = blk.type === "toggle" || blk.type === "heading" ? blk.text || "Untitled part" : "Steps";
      const line = `${"  ".repeat(blk.depth)}${blk.text}${named(c, blk)}`;
      parts.set(part, [...(parts.get(part) ?? []), line]);
    }
    return parts;
  };
  const pa = byPart(a);
  const pb = byPart(b);
  for (const t of [...new Set([...pb.keys(), ...pa.keys()])]) compare(t, pa.get(t) ?? [], pb.get(t) ?? []);
  compare("Videos", a.videos.map((v) => `${v.title} · ${v.url}`), b.videos.map((v) => `${v.title} · ${v.url}`));
  compare("Links", a.links.map((l) => `${l.title} · ${l.url}`), b.links.map((l) => `${l.title} · ${l.url}`));
  compare("Kits", a.kits.map((k) => `${k.name}${k.url ? ` · ${k.url}` : ""}`), b.kits.map((k) => `${k.name}${k.url ? ` · ${k.url}` : ""}`));
  compare("Techniques", a.techniques.map((t) => t.name), b.techniques.map((t) => t.name));
  compare("Knowledge", a.questions.map((q) => `${q.q} — ${q.a}`), b.questions.map((q) => `${q.q} — ${q.a}`));
  compare("Name", [before.name, before.subtitle].filter(Boolean), [after.operation.name, after.operation.subtitle].filter(Boolean));
  if (after.newConsultants.length) compare("New consultants", [], after.newConsultants.map((c) => c.name));
  return groups;
}

type Props = {
  op: Operation;
  consultants: Consultant[];
  instruction: string;
  proposal: Proposal;
  busy: boolean;
  onAccept: () => void;
  onDiscard: () => void;
};

/** Claude's change, shown before anything is saved. */
export default function ProposalSheet({ op, consultants, instruction, proposal, busy, onAccept, onDiscard }: Props) {
  const groups = diff(op, proposal, consultants);
  return (
    <div className="proposal" role="dialog" aria-modal="true" aria-label="Claude's change">
      <div className="proposal-card">
        <p className="label">Claude&rsquo;s change</p>
        <p className="proposal-asked">“{instruction}”</p>
        {proposal.summary.length > 0 && (
          <ul className="summary-list">
            {proposal.summary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
        {groups.length ? (
          <div className="diff">
            {groups.map((g) => (
              <div key={g.title} className="diff-group">
                <p className="label">{g.title}</p>
                {g.lines.map((l, i) => (
                  <div key={i} className="diff-line" data-kind={l.kind}>
                    <span className="diff-sign">{l.kind === "add" ? "+" : "−"}</span>
                    <span>{l.text}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="hint">Nothing on the page changes.</p>
        )}
        <div className="proposal-actions">
          <button type="button" className="mono-btn" onClick={onDiscard} disabled={busy}>
            {groups.length ? "Discard" : "Close"}
          </button>
          {groups.length > 0 && (
            <button type="button" className="mono-btn" data-primary="" onClick={onAccept} disabled={busy}>
              {busy ? "Saving…" : "Accept"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
