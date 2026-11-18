import { describeError, proposeNote } from "@/lib/claude";
import { getOperation, getSettings, listConsultants } from "@/lib/data";
import { cleanNote, contentToNote } from "@/lib/note";

export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/** Claude's version of the note with the instruction applied. Nothing is saved until it's accepted. */
export async function POST(req: Request, { params }: Ctx) {
  const body = (await req.json().catch(() => null)) as { instruction?: string } | null;
  const instruction = body?.instruction?.trim();
  if (!instruction) return Response.json({ error: "Say what to add or change" }, { status: 400 });
  const [op, consultants, settings] = await Promise.all([getOperation((await params).id), listConsultants(), getSettings()]);
  if (!op) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const note = op.content.note || contentToNote(op.content, consultants);
    const r = await proposeNote(note, op.name, instruction, settings.instructions);
    return Response.json({ proposal: { summary: r.summary, html: cleanNote(r.html), before: note } });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
