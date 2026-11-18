import { addFeedback, listFeedback } from "@/lib/data";
import type { Priority } from "@/lib/types";

export async function GET() {
  return Response.json({ feedback: await listFeedback() });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { text?: string; priority?: Priority } | null;
  const text = body?.text?.trim();
  if (!text) return Response.json({ error: "Nothing to add" }, { status: 400 });
  const priority = ["P1", "P2", "P3"].includes(body?.priority ?? "") ? body!.priority! : "P2";
  return Response.json({ item: await addFeedback(text.slice(0, 20_000), priority) });
}
