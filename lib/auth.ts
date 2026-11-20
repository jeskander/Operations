// Single-surgeon sign-in. It stays unlocked until you press Lock (or go a year without opening it).
// The cookie holds only a signed timestamp of the last use, never the password, and is renewed as
// you use the app. Signed with APP_PASSWORD: changing it signs every device out.
// Runs in Edge and Node.

export const SESSION_COOKIE = "op_session";
const MAX_AGE_S = 365 * 24 * 60 * 60;
const MAX_AGE_MS = MAX_AGE_S * 1000;
/** Renew the cookie once it's older than this. */
const RENEW_MS = 24 * 60 * 60 * 1000;

async function sign(password: string, at: number): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(password), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`operations-session-v2:${at}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function issueToken(password: string): Promise<string> {
  const now = Date.now();
  return `${now}.${await sign(password, now)}`;
}

/** The token's age in ms if it's valid and recent enough, otherwise null. */
export async function tokenAge(password: string, token: string | undefined): Promise<number | null> {
  const [rawAt, sig] = (token ?? "").split(".");
  const at = Number(rawAt);
  if (!sig || !Number.isFinite(at)) return null;
  const age = Date.now() - at;
  if (age < 0 || age > MAX_AGE_MS) return null;
  const expected = await sign(password, at);
  if (expected.length !== sig.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0 ? age : null;
}

export const needsRenewal = (age: number) => age > RENEW_MS;

export const sessionCookie = (token: string) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE_S}`;
export const clearCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
