import { deleteFeedback, updateFeedback } from "@/lib/data";
import type { Priority } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => null)) as { text?: string; priority?: Priority; done?: boolean } | null;
  if (!body) return Response.json({ error: "Nothing to change" }, { status: 400 });
  const patch = {
    text: typeof body.text === "string" ? body.text.slice(0, 20_000) : undefined,
    priority: ["P1", "P2", "P3"].includes(body.priority ?? "") ? body.priority : undefined,
    done: typeof body.done === "boolean" ? body.done : undefined,
  };
  await updateFeedback((await params).id, patch);
  return Response.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  await deleteFeedback((await params).id);
  return Response.json({ ok: true });
}
