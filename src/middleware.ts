import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const STAFF = ["OWNER", "BRANCH_MANAGER", "KITCHEN", "CASHIER", "DELIVERY_MANAGER", "MARKETING"];

async function readSession(req: NextRequest) {
  const token = req.cookies.get("dk_session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(process.env.SESSION_SECRET)
    );
    return payload as { uid: string; role: string };
  } catch {
    return null;
  }
}

/*
 * Sending plain HTTP to HTTPS is deliberately NOT done here.
 *
 * Apache talks to Passenger over an ordinary local HTTP connection, so
 * x-forwarded-proto reads "http" on the inside even when the customer arrived
 * over TLS. Redirecting on that would bounce every request forever and take
 * the whole site down — measured, not guessed: with the check in place every
 * page of a production build answered 308 to itself.
 *
 * The redirect belongs one layer out, in .htaccess, where Apache's own %{HTTPS}
 * says what the customer actually used and no loop is possible. See
 * docs/DEPLOY_CPANEL.md.
 */

/**
 * Headers every response carries.
 *
 * The site had none of these, which left the dashboard framable by any page on
 * the internet — a hidden iframe plus a convincing overlay is enough to get an
 * owner to click "accept" or "delete" on something they cannot see.
 */
function harden(res: NextResponse): NextResponse {
  // Nothing in this app is meant to be embedded anywhere.
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Content-Security-Policy", "frame-ancestors 'none'");
  // Stops a browser second-guessing a declared content type — the defence that
  // turns a file uploaded as an image into an inert one rather than a script.
  res.headers.set("X-Content-Type-Options", "nosniff");
  // Order numbers and ids live in dashboard URLs; do not hand them to whatever
  // a staff member clicks through to next.
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(self), interest-cohort=()"
  );
  /*
   * Tell the browser to refuse plain HTTP here from now on. Browsers only act
   * on this when it arrives over TLS, so sending it always is safe.
   *
   * Six months, and deliberately WITHOUT includeSubDomains: that word would
   * cover every subdomain of the account too, and webmail or cPanel on one of
   * them without its own certificate would become unreachable for anyone who
   * had visited the shop. No `preload` either — that is close to irreversible.
   */
  res.headers.set("Strict-Transport-Security", "max-age=15552000");
  return res;
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login") {
    const session = await readSession(req);
    if (!session || !STAFF.includes(session.role)) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", pathname);
      return harden(NextResponse.redirect(url));
    }
  }

  if (pathname.startsWith("/account") || pathname.startsWith("/checkout")) {
    const session = await readSession(req);
    if (!session || session.role !== "CUSTOMER") {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return harden(NextResponse.redirect(url));
    }
  }

  return harden(NextResponse.next());
}

export const config = {
  // Everything except Next's own build output and the files served straight
  // from public/, so the headers land on pages and API responses alike.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
