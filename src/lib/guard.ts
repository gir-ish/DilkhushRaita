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
  const user = await db.user.findUnique({
    where: { id: s.uid },
    select: { blocked: true, role: true },
  });
  if (!user) throw new HttpError(401, "Please sign in to continue");
  if (user.blocked) throw new HttpError(403, "This account is blocked. Contact support.");
  // The cookie says CUSTOMER; the database is what decides. A customer promoted
  // to staff must not keep reaching customer routes on an old cookie either.
  if (user.role !== "CUSTOMER") throw new HttpError(401, "Please sign in again");
  return s;
}

/**
 * Staff guard. Pass allowed roles; OWNER always passes.
 *
 * The role and the blocked flag are re-read from the database on every call,
 * NOT taken from the cookie.
 *
 * The session is a signed JWT that is valid for twelve hours and carries the
 * role it was minted with. Trusting that field meant blocking a staff member
 * did nothing until it expired: the account was gone from the dashboard, the
 * owner had every reason to believe access was revoked, and the browser that
 * was already signed in kept placing refunds and reading customer numbers for
 * the rest of the working day. Demotions had the same hole — moving someone
 * from BRANCH_MANAGER to KITCHEN left them a manager until their cookie ran
 * out. Blocking someone has to take effect on their next request, so the check
 * has to happen on the request.
 */
export async function requireStaff(...roles: Role[]): Promise<SessionPayload> {
  const s = await getSession();
  if (!s || !STAFF_ROLES.includes(s.role)) throw new HttpError(401, "Staff sign-in required");

  const user = await db.user.findUnique({
    where: { id: s.uid },
    select: { blocked: true, role: true, name: true },
  });
  if (!user) throw new HttpError(401, "Staff sign-in required");
  if (user.blocked) throw new HttpError(403, "This account has been disabled.");

  const role = user.role as Role;
  if (!STAFF_ROLES.includes(role)) throw new HttpError(403, "This account is no longer staff");

  if (role !== "OWNER" && roles.length > 0 && !roles.includes(role))
    throw new HttpError(403, "You do not have permission for this action");

  // Hand back the live role, so everything downstream — branch scoping, the
  // per-action role checks inside the order routes — sees the current one.
  return { ...s, role, name: user.name ?? s.name };
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
