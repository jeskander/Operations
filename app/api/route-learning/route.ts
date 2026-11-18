import { describeError, routeLearning } from "@/lib/claude";
import { listOperations } from "@/lib/data";

export const maxDuration = 60;

/** Which operation a note from the home screen belongs to. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text) return Response.json({ error: "Nothing to file" }, { status: 400 });
  try {
    const ops = (await listOperations()).map((o) => ({ id: o.id, name: o.name }));
    return Response.json(await routeLearning(text, ops));
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
