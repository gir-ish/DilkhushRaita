import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { db } from "./db";
import { getSession, type SessionPayload } from "./session";
import { STAFF_ROLES, type Role } from "./constants";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function jsonError(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** Wraps a route handler with uniform error handling. */
export function handler<T extends unknown[]>(
  fn: (...args: T) => Promise<Response>
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof HttpError) return jsonError(e.status, e.message);
      // A schema failure is the caller sending bad input, not a server fault.
      // Without this every invalid request became an opaque 500, which hides
      // real faults in the logs and tells the user nothing useful.
      if (e instanceof ZodError) {
        const first = e.issues[0];
        const field = first?.path.filter((p) => typeof p !== "number").join(".");
        return jsonError(
          400,
          first ? (field ? `${field}: ${first.message}` : first.message) : "Invalid request"
        );
      }
      console.error("[api]", e);
      return jsonError(500, "Something went wrong. Please try again.");
    }
  };
}

export async function requireCustomer(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s || s.role !== "CUSTOMER") throw new HttpError(401, "Please sign in to continue");
  const user = await db.user.findUnique({ where: { id: s.uid }, select: { blocked: true } });
  if (!user) throw new HttpError(401, "Please sign in to continue");
  if (user.blocked) throw new HttpError(403, "This account is blocked. Contact support.");
  return s;
}

/** Staff guard. Pass allowed roles; OWNER always passes. */
export async function requireStaff(...roles: Role[]): Promise<SessionPayload> {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) throw new HttpError(401, "Staff sign-in required");
  if (s.role !== "OWNER" && roles.length > 0 && !roles.includes(s.role))
    throw new HttpError(403, "You do not have permission for this action");
  return s;
}

/** Branch scoping: OWNER sees all; others only their assigned branches. */
export async function allowedBranchIds(s: SessionPayload): Promise<string[] | null> {
  if (s.role === "OWNER") return null; // null = all branches
  const rows = await db.staffBranchAssignment.findMany({
    where: { userId: s.uid },
    select: { branchId: true },
  });
  return rows.map((r) => r.branchId);
}
