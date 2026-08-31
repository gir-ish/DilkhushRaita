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
  /*
   * Content Security Policy — the second line of defence for cross-site
   * scripting.
   *
   * What was here before was `frame-ancestors 'none'` and nothing else, which
   * is clickjacking cover only: it says where the page may be embedded and
   * nothing about what it may load, connect to, or submit to.
   *
   * WHY script-src STILL CARRIES 'unsafe-inline', which is the part a scanner
   * will flag:
   *
   * The strong form of this policy is a per-request nonce, and it was written,
   * built and measured here before being taken out again. Next renders seven
   * inline <script> blocks into every page — the hydration payload React needs
   * to take over from the server-rendered HTML — and a nonce only reaches them
   * on pages rendered per request. Half this site is prerendered at build time
   * (/, /cart, /checkout, /login), where there is no request to draw a nonce
   * from, so those blocks go out without one. The trap is that a nonce anywhere
   * in script-src makes every modern browser IGNORE 'unsafe-inline' — so the
   * nonce policy does not fall back, it blocks all seven, and the site loads as
   * blank HTML with no React at all. Verified against a production build, not
   * reasoned about: `curl` returned nonce-less inline scripts under a policy
   * carrying a nonce.
   *
   * Fixing it properly means `export const dynamic = "force-dynamic"` across
   * the app so every page is rendered per request. That is a real cost on a
   * shared cPanel host and a decision about the site, not a security patch, so
   * it is written up in the checklist rather than taken here.
   *
   * What this policy still buys, with inline script allowed:
   *   - object-src / base-uri close the two classic ways markup injection is
   *     turned back into script execution;
   *   - connect-src and form-action mean injected script cannot post the
   *     customer's card details or the owner's session anywhere off-origin,
   *     which removes the payoff from most XSS even when it runs;
   *   - script-src still bars loading a remote script from any host but ours
   *     and Razorpay's.
   */
  const csp = [
    "default-src 'self'",
    // Razorpay Checkout is injected at runtime by the checkout page.
    "script-src 'self' 'unsafe-inline' https://checkout.razorpay.com",
    // Tailwind and next/font both emit inline <style>.
    "style-src 'self' 'unsafe-inline'",
    // data: for inline SVG icons; blob: for locally previewed menu photos.
    "img-src 'self' data: blob: https://*.razorpay.com",
    "font-src 'self' data:",
    // Where a script may send data. This is the directive that limits what an
    // injected one could exfiltrate.
    "connect-src 'self' https://api.razorpay.com https://lumberjack.razorpay.com",
    // The Razorpay payment modal is an iframe; nothing else may be framed.
    "frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com",
    // Nothing in this app is meant to be embedded anywhere.
    "frame-ancestors 'none'",
    // Flash/Java-era embeds have no use here and are a known XSS vector.
    "object-src 'none'",
    // Stops injected <base> from re-pointing every relative script URL.
    "base-uri 'self'",
    // A planted form cannot post the customer's details to another origin.
    "form-action 'self'",
    /*
     * Production only.
     *
     * This tells the browser to re-request every subresource over HTTPS. In
     * production that costs nothing — everything is already TLS. In
     * development it is fatal the moment the site is opened on anything but
     * `localhost`: a phone (or a second machine) on the LAN loading
     * http://192.168.1.4:3000 has its CSS and JS upgraded to
     * https://192.168.1.4:3000, where no TLS listener exists, so every
     * stylesheet and script fails and the page renders as unstyled text.
     *
     * `localhost` is exempt from the upgrade because browsers already treat it
     * as a trustworthy origin — which is exactly why this looks fine on the
     * development machine and broken on the one device you wanted to test on.
     */
    ...(process.env.NODE_ENV === "production" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  res.headers.set("Content-Security-Policy", csp);

  // Kept alongside the CSP: frame-ancestors is the modern control, but this is
  // the one older browsers actually obey.
  res.headers.set("X-Frame-Options", "DENY");
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
   * Severs the window.opener link and keeps this page out of any other
   * origin's browsing-context group, so a popup or a page that opened us
   * cannot reach into this one.
   */
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-origin");
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
