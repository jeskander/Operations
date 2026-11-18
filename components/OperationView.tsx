"use client";

import { visible } from "@/lib/content";
import type { Consultant, Filters, Item, Operation, Video } from "@/lib/types";
import { Inline, Markdown } from "./Markdown";

export type Tab = "steps" | "videos" | "links" | "optech" | "knowledge";

export const TABS: { id: Tab; label: string }[] = [
  { id: "steps", label: "Steps" },
  { id: "videos", label: "Videos" },
  { id: "links", label: "Links" },
  { id: "optech", label: "Op tech" },
  { id: "knowledge", label: "Knowledge" },
];

const host = (url: string) => {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    if (h.includes("youtu")) return "YouTube";
    if (h.includes("vumedi")) return "VuMedi";
    if (h.includes("aofoundation")) return "AO";
    return h;
  } catch {
    return "";
  }
};

type Props = {
  op: Operation;
  consultants: Consultant[];
  filters: Filters;
  tab: Tab;
};

/** The operation's sections, filtered by the chosen kit, technique and consultant. */
export function Panel({ op, consultants, filters, tab }: Props) {
  const c = op.content;
  if (tab === "steps") return <Steps op={op} consultants={consultants} filters={filters} />;

  if (tab === "videos") {
    if (!c.videos.length) return <Empty ask="find 3 good videos of this operation being performed" what="No videos yet." />;
    const full = c.videos.filter((v) => v.group === "full");
    const other = c.videos.filter((v) => v.group !== "full");
    return (
      <>
        {full.length > 0 && <VideoList label={other.length ? "Full operation" : null} videos={full} />}
        {other.length > 0 && <VideoList label="Other" videos={other} />}
      </>
    );
  }

  if (tab === "links") {
    if (!c.links.length) return <Empty ask="add the AO Surgery Reference page for this operation" what="No links yet." />;
    return (
      <ul className="list">
        {c.links.map((l) => (
          <li key={l.id}>
            <Row href={l.url} title={l.title} sub={l.note} meta={l.source || host(l.url)} />
          </li>
        ))}
      </ul>
    );
  }

  if (tab === "optech") {
    if (!c.kits.length) return <Empty ask="add the Attune kit with its op tech" what="No kits yet." />;
    return (
      <ul className="list">
        {c.kits.map((k) => (
          <li key={k.id}>
            <Row href={k.url} title={k.name} sub={k.maker} meta={k.url ? "Op tech ↗" : "No link"} />
          </li>
        ))}
      </ul>
    );
  }

  if (!c.questions.length) return <Empty ask="add 5 questions a consultant would ask during this case" what="No questions yet." />;
  return (
    <ul className="list">
      {c.questions.map((q) => (
        <li key={q.id}>
          <details className="q">
            <summary>
              <span className="q-mark">Q</span>
              <span className="q-text">
                <Inline>{q.q}</Inline>
              </span>
              <span className="chev" />
            </summary>
            <div className="q-body">
              <Markdown>{q.a || "_No answer yet._"}</Markdown>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Empty({ what, ask }: { what: string; ask: string }) {
  return (
    <p className="empty">
      {what} Ask below, e.g. <em>“{ask}”</em>, or tap Edit.
    </p>
  );
}

function Row({ href, title, sub, meta }: { href: string; title: string; sub: string; meta: string }) {
  const inner = (
    <>
      <span className="row-main">
        <span className="row-title">{title || href || "Untitled"}</span>
        {sub && <span className="row-sub">{sub}</span>}
      </span>
      {meta && <span className="row-meta">{meta}</span>}
    </>
  );
  return href ? (
    <a className="row" href={href} target="_blank" rel="noreferrer">
      {inner}
    </a>
  ) : (
    <div className="row">{inner}</div>
  );
}

function VideoList({ label, videos }: { label: string | null; videos: Video[] }) {
  return (
    <>
      {label && <p className="label sub-label">{label}</p>}
      <ul className="list">
        {videos.map((v) => (
          <li key={v.id}>
            <Row href={v.url} title={v.title} sub={v.note} meta={v.source || host(v.url)} />
          </li>
        ))}
      </ul>
    </>
  );
}

function Steps({ op, consultants, filters }: { op: Operation; consultants: Consultant[]; filters: Filters }) {
  const c = op.content;
  const sections = c.sections.map((s) => ({ ...s, shown: s.items.filter((i) => visible(i, filters)) }));
  const anyItems = c.sections.some((s) => s.items.length);
  if (!anyItems) return <Empty ask="draft the steps of this operation from my notes: …" what="No steps yet." />;

  const name = (list: { id: string; name: string }[], id: string | null) => (id ? list.find((x) => x.id === id)?.name : undefined);
  const tags = (it: Item) =>
    [
      !filters.kit && name(c.kits, it.kit),
      !filters.technique && name(c.techniques, it.technique),
      !filters.consultant && name(consultants, it.consultant),
    ].filter(Boolean) as string[];

  let n = 0;
  return (
    <ol className="list">
      {sections
        .filter((s) => s.shown.length)
        .map((s) => {
          n += 1;
          const counters: number[] = [];
          return (
            <li key={s.id}>
              <details className="step" open={n === 1}>
                <summary>
                  <span className="step-num">{String(n).padStart(2, "0")}</span>
                  <span className="step-title">{s.title}</span>
                  <span className="chev" />
                </summary>
                <div className="step-body">
                  <ul className="items">
                    {s.shown.map((it) => {
                      counters.length = it.depth + 1;
                      counters[it.depth] = (counters[it.depth] ?? 0) + 1;
                      return (
                        <li key={it.id} className="item" data-list={it.list} data-depth={it.depth}>
                          {it.list === "number" && <span className="item-n">{counters[it.depth]}.</span>}
                          <Inline>{it.text}</Inline>
                          {tags(it).map((t) => (
                            <span key={t} className="cond">
                              {t}
                            </span>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </details>
            </li>
          );
        })}
    </ol>
  );
}

/** How many of each section there are, for the tab counts. */
export function counts(op: Operation, filters: Filters): Record<Tab, number> {
  const c = op.content;
  return {
    steps: c.sections.filter((s) => s.items.some((i) => visible(i, filters))).length,
    videos: c.videos.length,
    links: c.links.length,
    optech: c.kits.length,
    knowledge: c.questions.length,
  };
}
