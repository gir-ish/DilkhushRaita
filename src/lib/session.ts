import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { STAFF_ROLES, type Role } from "./constants";

const COOKIE = "dk_session";

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ chars)");
  return new TextEncoder().encode(s);
}

/**
 * Secure-cookie flag. Defaults to true in production (HTTPS required).
 * COOKIE_SECURE="false" allows testing a production build over plain HTTP
 * (e.g. from a phone on the LAN). Never set "false" on a real deployment.
 */
function cookieSecure() {
  const v = process.env.COOKIE_SECURE;
  if (v === "true") return true;
  if (v === "false") return false;
  return process.env.NODE_ENV === "production";
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
