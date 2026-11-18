export const maxDuration = 15;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

function sourceOf(url: URL): string {
  const h = url.hostname.replace(/^www\./, "");
  if (h.includes("youtu")) return "YouTube";
  if (h.includes("vumedi")) return "VuMedi";
  if (h.includes("aofoundation")) return "AO";
  if (h.includes("orthobullets")) return "Orthobullets";
  return h;
}

/** The title of a pasted link, so adding a video or link only needs the URL. */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(raw);
    if (!/^https?:$/.test(url.protocol)) throw new Error();
  } catch {
    return Response.json({ error: "Not a link" }, { status: 400 });
  }
  const source = sourceOf(url);
  const signal = AbortSignal.timeout(6000);
  try {
    if (source === "YouTube") {
      const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url.toString())}`, { signal });
      if (r.ok) {
        const j = (await r.json()) as { title?: string; author_name?: string };
        return Response.json({ title: j.title ?? "", source, author: j.author_name ?? "" });
      }
    }
    const r = await fetch(url, { signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; OperationsApp/1.0)" }, redirect: "follow" });
    const html = (await r.text()).slice(0, 300_000);
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
    const title = og?.[1] ?? html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ?? "";
    return Response.json({ title: decode(title), source, author: "" });
  } catch {
    return Response.json({ title: "", source, author: "" });
  }
}
