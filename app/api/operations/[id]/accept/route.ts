import { addConsultants, listConsultants, saveOperation } from "@/lib/data";
import type { Proposal } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** Save Claude's proposal: add any new consultants, point markers at their saved ids, then save the page. */
export async function POST(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => null)) as { proposal?: Proposal; instruction?: string } | null;
  const p = body?.proposal;
  if (!p?.operation?.content) return Response.json({ error: "Nothing to save" }, { status: 400 });
  try {
    const ids = await addConsultants(p.newConsultants ?? []);
    for (const b of p.operation.content.blocks) if (b.consultant && ids.has(b.consultant)) b.consultant = ids.get(b.consultant)!;
    const operation = await saveOperation((await params).id, p.operation, "ai", body?.instruction ?? "");
    return Response.json({ operation, consultants: await listConsultants() });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
