import { correctTranscript } from "@/lib/claude";
import { getSettings, listOperations } from "@/lib/data";
import { ORTHO_TERMS, transcriptionPrompt } from "@/lib/vocab";

export const maxDuration = 120;

const MODEL = process.env.TRANSCRIBE_MODEL || "gpt-4o-transcribe";

/**
 * Speech to text for dictated debriefs, in two passes:
 * 1. OpenAI's transcription model, steered with T&O vocabulary and this notebook's own words.
 * 2. Claude corrects any surgical terms it still misheard, changing nothing else.
 * The audio is passed straight through and never stored.
 */
export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI dictation isn't set up: add OPENAI_API_KEY in Vercel." }, { status: 500 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || !audio.size) return Response.json({ error: "No audio" }, { status: 400 });
  const currentId = form?.get("currentId");

  let own: string[] = [];
  let names: string[] = [];
  try {
    const [ops, settings] = await Promise.all([listOperations(), getSettings()]);
    const cur = ops.find((o) => o.id === currentId);
    own = [
      ...settings.vocab,
      ...(cur ? [...cur.content.kits.map((k) => k.name), ...cur.content.techniques.map((t) => t.name), ...cur.content.consultants.map((c) => c.name)] : []),
      ...ops.flatMap((o) => o.content.consultants.map((c) => c.name)),
    ];
    names = ops.map((o) => o.name);
  } catch {
    // Transcribe with the built-in vocabulary rather than fail.
  }
  own = [...new Set(own.map((w) => w.trim()).filter(Boolean))];

  const out = new FormData();
  out.append("file", audio, (audio as File).name || "dictation.webm");
  out.append("model", MODEL);
  out.append("language", "en");
  out.append("prompt", transcriptionPrompt(own));
  out.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: out,
  });
  const body = (await res.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;
  if (!res.ok) return Response.json({ error: body?.error?.message ?? `Transcription failed (${res.status})` }, { status: 502 });
  const raw = body?.text ?? "";

  try {
    return Response.json({ text: await correctTranscript(raw, [...own, ...ORTHO_TERMS, ...names]) });
  } catch {
    return Response.json({ text: raw });
  }
}
