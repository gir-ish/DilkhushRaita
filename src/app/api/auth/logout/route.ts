import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/session";
import { handler } from "@/lib/guard";

export const POST = handler(async () => {
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
});
