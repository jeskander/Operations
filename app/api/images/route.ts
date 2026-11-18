import { supabase } from "@/lib/supabase";

export const maxDuration = 30;

const TYPES: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/heic": "heic" };

/** Upload a photo for a step. Stored privately; served only to a signed-in session. */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "No image" }, { status: 400 });
  const ext = TYPES[file.type];
  if (!ext) return Response.json({ error: "Use a JPEG, PNG, GIF, WebP or HEIC image" }, { status: 400 });
  if (file.size > 15 * 1024 * 1024) return Response.json({ error: "Images can be up to 15 MB" }, { status: 400 });
  const name = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase().storage.from("operations").upload(name, Buffer.from(await file.arrayBuffer()), { contentType: file.type });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ url: `/api/images/${name}` });
}
