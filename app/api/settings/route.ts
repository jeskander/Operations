import { getSettings, saveSettings } from "@/lib/data";
import type { Settings } from "@/lib/types";

export async function GET() {
  return Response.json({ settings: await getSettings() });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => null)) as Partial<Settings> | null;
  if (!body) return Response.json({ error: "Nothing to save" }, { status: 400 });
  const clean: Partial<Settings> = {};
  if (typeof body.instructions === "string") clean.instructions = body.instructions.slice(0, 10_000);
  const lines = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.trim()).filter(Boolean).slice(0, 40) : undefined);
  if (lines(body.parts)) clean.parts = lines(body.parts);
  if (lines(body.groups)) clean.groups = lines(body.groups);
  try {
    return Response.json({ settings: await saveSettings(clean) });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
}
