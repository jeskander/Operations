import { issueToken, sessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const password = process.env.APP_PASSWORD;
  if (!password) return Response.json({ error: "APP_PASSWORD isn't set on the server" }, { status: 500 });

  const body = (await req.json().catch(() => null)) as { password?: string } | null;
  if (body?.password !== password) return Response.json({ error: "Wrong password" }, { status: 401 });

  const res = Response.json({ ok: true });
  res.headers.append("Set-Cookie", sessionCookie(await issueToken(password)));
  return res;
}
