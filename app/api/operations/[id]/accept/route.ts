import { saveOperation } from "@/lib/data";
import type { Proposal } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

/** Save Claude's proposal. New consultants are already in the page's own list. */
export async function POST(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => null)) as { proposal?: Proposal; instruction?: string } | null;
  const p = body?.proposal;
  if (!p?.operation?.content) return Response.json({ error: "Nothing to save" }, { status: 400 });
  try {
    const operation = await saveOperation((await params).id, p.operation, "ai", body?.instruction ?? "");
    return Response.json({ operation });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
