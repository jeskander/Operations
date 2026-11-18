/** Called while you're using the page; the middleware renews the session on the way through. */
export async function POST() {
  return Response.json({ ok: true });
}
