import { NextResponse } from "next/server";
import { SESSION_COOKIE, signOut } from "@/lib/auth/oauth";

/** POST /api/auth/logout — forget the GitHub sign-in (token deleted server-side). */
export function POST(req: Request) {
  signOut(req);
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
