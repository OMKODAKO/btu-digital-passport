import { NextResponse } from "next/server";

/** Rejects cross-site form posts: the Origin header, when present, must match this host. */
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** 303 redirect with a relative Location, so it stays on whatever host the user is on. */
export function redirect(location: string): NextResponse {
  return new NextResponse(null, { status: 303, headers: { Location: location } });
}
