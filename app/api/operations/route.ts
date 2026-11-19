import { createOperation, listOperations } from "@/lib/data";

export async function GET() {
  try {
    const operations = await listOperations();
    return Response.json({ operations });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: string; region?: string } | null;
  const name = body?.name?.trim();
  if (!name) return Response.json({ error: "Give the operation a name" }, { status: 400 });
  try {
    return Response.json({ operation: await createOperation(name, body?.region?.trim() || "Other") });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
