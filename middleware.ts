import { NextResponse, type NextRequest } from "next/server";
import { RENEW_DAYS, SESSION_COOKIE, issueToken, sessionCookie, tokenAge } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/api/login" || pathname === "/login") return NextResponse.next();

  const password = process.env.APP_PASSWORD;
  const age = password ? await tokenAge(password, req.cookies.get(SESSION_COOKIE)?.value) : null;
  if (age === null) {
    return pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Signed out" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", req.url));
  }

  const res = NextResponse.next();
  if (age > RENEW_DAYS * 86_400_000) res.headers.append("Set-Cookie", sessionCookie(await issueToken(password!)));
  return res;
}

export const config = {
  // The manifest and icons stay public so the app can be installed from the sign-in page.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-icon.png).*)"],
};
