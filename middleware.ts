import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, clearCookie, issueToken, needsRenewal, sessionCookie, tokenAge } from "@/lib/auth";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/api/login") return NextResponse.next();
  if (pathname === "/login") {
    // Reaching the sign-in page signs out.
    const res = NextResponse.next();
    res.headers.append("Set-Cookie", clearCookie);
    res.headers.set("Cache-Control", "no-store");
    return res;
  }

  const password = process.env.APP_PASSWORD;
  const age = password ? await tokenAge(password, req.cookies.get(SESSION_COOKIE)?.value) : null;
  if (age === null) {
    const res = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "Locked" }, { status: 401 })
      : NextResponse.redirect(new URL("/login", req.url));
    res.headers.append("Set-Cookie", clearCookie);
    return res;
  }

  const res = NextResponse.next();
  if (needsRenewal(age)) res.headers.append("Set-Cookie", sessionCookie(await issueToken(password!)));
  // Never keep a copy of a page or its data to show without the password.
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export const config = {
  // The manifest and icons stay public so the app can be installed from the sign-in page.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon.svg|icon-192.png|icon-512.png|apple-icon.png).*)"],
};
