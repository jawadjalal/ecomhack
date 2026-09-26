import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/oauth";

/** POST /api/auth/logout — forget the GitHub sign-in (the session lives only in its cookie). */
export function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
