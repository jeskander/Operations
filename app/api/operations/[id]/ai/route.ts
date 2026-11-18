import { describeError, proposeEdit } from "@/lib/claude";
import { getOperation, getSettings, listConsultants } from "@/lib/data";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** Claude's version of the page with the instruction applied. Nothing is saved until it's accepted. */
export async function POST(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => null)) as { instruction?: string } | null;
  const instruction = body?.instruction?.trim();
  if (!instruction) return Response.json({ error: "Say what to add or change" }, { status: 400 });
  const [op, consultants, settings] = await Promise.all([getOperation((await params).id), listConsultants(), getSettings()]);
  if (!op) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    return Response.json({ proposal: await proposeEdit(op, consultants, instruction, settings.instructions) });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
