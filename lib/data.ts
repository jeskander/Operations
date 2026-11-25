import "server-only";
import { DEFAULT_SECTIONS, REGIONS, emptyContent, normalize } from "./content";
import { supabase } from "./supabase";
import type { Consultant, Feedback, Operation, OperationFields, Priority, Settings } from "./types";

type Row = { id: string; name: string; region: string; subtitle: string; content: unknown; updated_at: string };

const toOperation = (r: Row): Operation => ({
  id: r.id,
  name: r.name,
  region: r.region,
  subtitle: r.subtitle,
  content: normalize(r.content),
  updatedAt: r.updated_at,
});

const COLS = "id, name, region, subtitle, content, updated_at";

export async function listOperations(): Promise<Operation[]> {
  const { data, error } = await supabase().from("op_operations").select(COLS).order("name");
  if (error) throw new Error(error.message);
  return (data as Row[]).map(toOperation);
}

export async function getOperation(id: string): Promise<Operation | null> {
  const { data, error } = await supabase().from("op_operations").select(COLS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? toOperation(data as Row) : null;
}

export async function createOperation(name: string, region: string): Promise<Operation> {
  const { data, error } = await supabase()
    .from("op_operations")
    .insert({ name, region, content: emptyContent((await getSettings()).parts) })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return toOperation(data as Row);
}

/** Autosaves keep a revision at most this often; Claude's changes and undos always keep one. */
const AUTOSAVE_REVISION_MINUTES = 15;

async function lastRevisionAt(id: string): Promise<number> {
  const { data } = await supabase()
    .from("op_revisions")
    .select("created_at")
    .eq("operation_id", id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? new Date((data as { created_at: string }).created_at).getTime() : 0;
}

/** Save the page, keeping what it was before as a revision. */
export async function saveOperation(id: string, fields: OperationFields, source: string, note = ""): Promise<Operation> {
  const before = await getOperation(id);
  if (!before) throw new Error("Operation not found");
  const keep = source !== "auto" || Date.now() - (await lastRevisionAt(id)) > AUTOSAVE_REVISION_MINUTES * 60_000;
  if (keep) await supabase().from("op_revisions").insert({
    operation_id: id,
    name: before.name,
    region: before.region,
    subtitle: before.subtitle,
    content: before.content,
    source,
    note: note.slice(0, 2000),
  });
  const { data, error } = await supabase()
    .from("op_operations")
    .update({
      name: fields.name.trim() || before.name,
      region: fields.region.trim() || "Other",
      subtitle: fields.subtitle.trim(),
      content: normalize(fields.content),
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return toOperation(data as Row);
}

export async function deleteOperation(id: string) {
  const { error } = await supabase().from("op_operations").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listConsultants(): Promise<Consultant[]> {
  const { data, error } = await supabase().from("op_consultants").select("id, name").order("position").order("created_at");
  if (error) throw new Error(error.message);
  return data as Consultant[];
}

/** Replace the consultant list. Ids are kept so markers on steps still point at the same person. */
export async function saveConsultants(list: Consultant[]): Promise<Consultant[]> {
  const db = supabase();
  const existing = await listConsultants();
  const keep = new Set(list.map((c) => c.id));
  const gone = existing.filter((c) => !keep.has(c.id)).map((c) => c.id);
  if (gone.length) {
    const { error } = await db.from("op_consultants").delete().in("id", gone);
    if (error) throw new Error(error.message);
  }
  const known = new Set(existing.map((c) => c.id));
  for (const [i, c] of list.entries()) {
    const name = c.name.trim();
    if (!name) continue;
    const { error } = known.has(c.id)
      ? await db.from("op_consultants").update({ name, position: i }).eq("id", c.id)
      : await db.from("op_consultants").insert({ ...(isUuid(c.id) ? { id: c.id } : {}), name, position: i });
    if (error) throw new Error(error.message);
  }
  return listConsultants();
}

/** Add consultants Claude introduced, returning a map from its temporary ids to the saved ones. */
export async function addConsultants(list: Consultant[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (!list.length) return ids;
  const existing = await listConsultants();
  for (const c of list) {
    const same = existing.find((e) => e.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (same) {
      ids.set(c.id, same.id);
      continue;
    }
    const { data, error } = await supabase()
      .from("op_consultants")
      .insert({ name: c.name.trim(), position: existing.length + ids.size })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    ids.set(c.id, (data as { id: string }).id);
  }
  return ids;
}

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

// ---------- Feedback ----------

type FeedbackRow = { id: string; created_at: string; text: string; priority: Priority; done_at: string | null };
const toFeedback = (r: FeedbackRow): Feedback => ({ id: r.id, text: r.text, priority: r.priority, createdAt: r.created_at, doneAt: r.done_at });

export async function listFeedback(): Promise<Feedback[]> {
  const { data, error } = await supabase().from("op_feedback").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as FeedbackRow[]).map(toFeedback);
}

export async function addFeedback(text: string, priority: Priority): Promise<Feedback> {
  const { data, error } = await supabase().from("op_feedback").insert({ text, priority }).select("*").single();
  if (error) throw new Error(error.message);
  return toFeedback(data as FeedbackRow);
}

export async function updateFeedback(id: string, patch: { text?: string; priority?: Priority; done?: boolean }) {
  const row: Record<string, unknown> = {};
  if (patch.text !== undefined) row.text = patch.text;
  if (patch.priority) row.priority = patch.priority;
  if (patch.done !== undefined) row.done_at = patch.done ? new Date().toISOString() : null;
  const { error } = await supabase().from("op_feedback").update(row).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deleteFeedback(id: string) {
  const { error } = await supabase().from("op_feedback").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ---------- Settings ----------

export const DEFAULT_SETTINGS: Settings = { instructions: "", parts: DEFAULT_SECTIONS, groups: REGIONS, vocab: [] };

export async function getSettings(): Promise<Settings> {
  const { data, error } = await supabase().from("op_settings").select("key, value");
  if (error) throw new Error(error.message);
  const map = new Map((data as { key: string; value: unknown }[]).map((r) => [r.key, r.value]));
  const list = (v: unknown, fallback: string[]) => (Array.isArray(v) && v.length ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : fallback);
  return {
    instructions: typeof map.get("instructions") === "string" ? (map.get("instructions") as string) : "",
    parts: list(map.get("parts"), DEFAULT_SETTINGS.parts),
    groups: list(map.get("groups"), DEFAULT_SETTINGS.groups),
    vocab: list(map.get("vocab"), []),
  };
}

export async function saveSettings(s: Partial<Settings>): Promise<Settings> {
  const rows = Object.entries(s)
    .filter(([k]) => ["instructions", "parts", "groups", "vocab"].includes(k))
    .map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
  if (rows.length) {
    const { error } = await supabase().from("op_settings").upsert(rows);
    if (error) throw new Error(error.message);
  }
  return getSettings();
}
