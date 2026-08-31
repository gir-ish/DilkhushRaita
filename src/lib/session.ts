import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { STAFF_ROLES, type Role } from "./constants";

const COOKIE = "dk_session";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

/** Secure-cookie flag. Always true in production; see below. */
function cookieSecure() {
  const v = process.env.COOKIE_SECURE;
  /*
   * "false" is a local-testing affordance — it lets a production build be
   * opened over plain HTTP from a phone on the LAN. In production it means the
   * browser will send the session cookie over unencrypted HTTP, where anyone
   * sharing the network can read it and become that user. The same .env gets
   * copied from a laptop to the server, so the setting travels with it. Ignore
   * it there and say so.
   */
  if (process.env.NODE_ENV === "production") {
    if (v === "false")
      console.error(
        '[cookie] COOKIE_SECURE="false" is IGNORED in production — it would send ' +
          "session cookies over plain HTTP. Remove it from the server's .env."
      );
    return true;
  }
  if (v === "true") return true;
  if (v === "false") return false;
  return false;
}

export interface SessionPayload {
  uid: string;
  role: Role;
  name?: string;
  phone?: string;
}

export async function createSessionCookie(payload: SessionPayload) {
  const isStaff = STAFF_ROLES.includes(payload.role);
  const maxAge = isStaff ? 60 * 60 * 12 : 60 * 60 * 24 * 30; // staff 12h, customers 30d
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + maxAge)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax", // also our CSRF defence for state-changing same-site APIs
    secure: cookieSecure(),
    path: "/",
    maxAge,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSession(): Promise<SessionPayload | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = COOKIE;
