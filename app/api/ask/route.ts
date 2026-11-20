import { answerQuestion, describeError, type ChatTurn } from "@/lib/claude";
import { listOperations } from "@/lib/data";

export const maxDuration = 300;

/** Answer a question using the relevant operation pages. Changes nothing. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { history?: ChatTurn[]; opIds?: string[]; currentId?: string | null } | null;
  const history = (body?.history ?? []).filter(
    (t) => (t?.role === "user" || t?.role === "assistant") && typeof t.content === "string" && t.content.trim(),
  );
  if (!history.length || history[history.length - 1].role !== "user") return Response.json({ error: "Ask something" }, { status: 400 });
  try {
    const ops = await listOperations();
    const ids = new Set([...(body?.currentId ? [body.currentId] : []), ...(body?.opIds ?? [])]);
    const viewing = ops.find((o) => o.id === body?.currentId)?.name ?? null;
    const pages = ops.filter((o) => ids.has(o.id));
    const answer = await answerQuestion(history, pages, ops.map((o) => o.name), viewing);
    return Response.json({ answer, sources: pages.map((p) => ({ id: p.id, name: p.name })) });
  } catch (err) {
    return Response.json({ error: describeError(err) }, { status: 502 });
  }
}
