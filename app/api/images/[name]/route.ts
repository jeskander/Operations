import { supabase } from "@/lib/supabase";

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[\w-]+\.(jpeg|png|gif|webp|heic)$/.test(name)) return new Response("Not found", { status: 404 });
  const { data, error } = await supabase().storage.from("operations").download(name);
  if (error || !data) return new Response("Not found", { status: 404 });
  return new Response(data, { headers: { "Content-Type": data.type || "image/jpeg", "Cache-Control": "no-store" } });
}
