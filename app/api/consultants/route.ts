import { listConsultants, saveConsultants } from "@/lib/data";
import type { Consultant } from "@/lib/types";

export async function GET() {
  return Response.json({ consultants: await listConsultants() });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as { consultants?: Consultant[] } | null;
  if (!Array.isArray(body?.consultants)) return Response.json({ error: "Nothing to save" }, { status: 400 });
  try {
    return Response.json({ consultants: await saveConsultants(body.consultants) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
