// Single-surgeon sign-in. A signed cookie lasts a year and renews each time the app is used,
// so the phone stays signed in. Signed with APP_PASSWORD: changing it signs every device out.
// Runs in Edge and Node.

export const SESSION_COOKIE = "op_session";
export const SESSION_DAYS = 365;
/** Renew the cookie once it's older than this. */
export const RENEW_DAYS = 1;

async function sign(password: string, issuedAt: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`operations-session-v1:${issuedAt}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueToken(password: string): Promise<string> {
  const now = Date.now();
  return `${now}.${await sign(password, now)}`;
}

/** The token's age in ms if it's valid, otherwise null. */
export async function tokenAge(password: string, token: string | undefined): Promise<number | null> {
  const [rawAt, sig] = (token ?? "").split(".");
  const issuedAt = Number(rawAt);
  if (!sig || !Number.isFinite(issuedAt)) return null;
  const age = Date.now() - issuedAt;
  if (age < 0 || age > SESSION_DAYS * 86_400_000) return null;
  const expected = await sign(password, issuedAt);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? age : null;
}

export const sessionCookie = (token: string) =>
  `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86_400}`;
