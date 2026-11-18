import "server-only";
import { emptyContent, normalize } from "./content";
import { supabase } from "./supabase";
import type { Consultant, Operation, OperationFields } from "./types";

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
    .insert({ name, region, content: emptyContent() })
    .select(COLS)
    .single();
  if (error) throw new Error(error.message);
  return toOperation(data as Row);
}

/** Save the page, keeping what it was before as a revision. */
export async function saveOperation(id: string, fields: OperationFields, source: string, note = ""): Promise<Operation> {
  const before = await getOperation(id);
  if (!before) throw new Error("Operation not found");
  await supabase().from("op_revisions").insert({
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
