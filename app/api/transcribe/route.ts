import { listOperations } from "@/lib/data";

export const maxDuration = 120;

const MODEL = process.env.TRANSCRIBE_MODEL || "gpt-4o-transcribe";

/**
 * Speech to text for dictated debriefs, using OpenAI's transcription model. The prompt carries
 * this notebook's own words (operations, kits, modes, consultants) so implant names and eponyms
 * come out right. The audio is passed straight through and never stored.
 */
export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ error: "AI dictation isn't set up: add OPENAI_API_KEY in Vercel." }, { status: 500 });

  const form = await req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || !audio.size) return Response.json({ error: "No audio" }, { status: 400 });
  const currentId = form?.get("currentId");

  let vocab = "";
  try {
    const ops = await listOperations();
    const cur = ops.find((o) => o.id === currentId);
    const words = [
      ...(cur ? [...cur.content.kits.map((k) => k.name), ...cur.content.techniques.map((t) => t.name), ...cur.content.consultants.map((c) => c.name)] : []),
      ...ops.map((o) => o.name),
    ];
    vocab = [...new Set(words.filter(Boolean))].join(", ");
  } catch {
    // Transcribe without the vocabulary rather than fail.
  }

  const prompt = `A UK trauma and orthopaedic surgeon dictating learning points after an operation. British spelling. Use proper punctuation and sentences. Terms that may come up: ${vocab}, Bristow, Hohmann, Cobb, Mayo's, K-wire, Vicryl, Monocryl, TXA, II, DHS, TKR, THR, ORIF, AO, Mako, Attune, GMK Sphere, Oxford, tip–apex distance.`.slice(0, 3000);

  const out = new FormData();
  out.append("file", audio, (audio as File).name || "dictation.webm");
  out.append("model", MODEL);
  out.append("language", "en");
  out.append("prompt", prompt);
  out.append("response_format", "json");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: out,
  });
  const body = (await res.json().catch(() => null)) as { text?: string; error?: { message?: string } } | null;
  if (!res.ok) return Response.json({ error: body?.error?.message ?? `Transcription failed (${res.status})` }, { status: 502 });
  return Response.json({ text: body?.text ?? "" });
}
