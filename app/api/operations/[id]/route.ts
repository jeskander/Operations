import { deleteOperation, getOperation, saveOperation } from "@/lib/data";
import type { OperationFields } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const op = await getOperation((await params).id);
  return op ? Response.json({ operation: op }) : Response.json({ error: "Not found" }, { status: 404 });
}

export async function PUT(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => null)) as (OperationFields & { source?: string; note?: string }) | null;
  if (!body?.content || typeof body.name !== "string") return Response.json({ error: "Nothing to save" }, { status: 400 });
  try {
    const source = ["manual", "ai", "undo"].includes(body.source ?? "") ? body.source! : "manual";
    const op = await saveOperation((await params).id, body, source, body.note ?? "");
    return Response.json({ operation: op });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    await deleteOperation((await params).id);
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
