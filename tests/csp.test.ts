import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "@/lib/csp";

/**
 * A CSP fails in the worst possible way: nothing throws, nothing logs on the
 * server, and a customer simply cannot pay. The first version of this policy
 * named checkout.razorpay.com and api.razorpay.com — the two hosts anyone would
 * guess — and every online payment broke, because the checkout pulls its bundle
 * from a third host and its assets from a fourth.
 *
 * The list below was taken from Razorpay's own checkout.js, not from memory.
 */

/** Every razorpay.com host referenced inside checkout.js, as of 2026-08-31. */
const RAZORPAY_HOSTS = [
  "api.razorpay.com",
  "api-dark.razorpay.com",
  "cdn.razorpay.com",
  "checkout.razorpay.com",
  "checkout-static-next.razorpay.com",
  "express.razorpay.com",
  "lumberjack.razorpay.com",
  "lumberjack-cx.razorpay.com",
  "lumberjack-metrics.razorpay.com",
];

function directive(csp: string, name: string): string {
  const found = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " "));
  if (!found) throw new Error(`no ${name} directive in policy`);
  return found;
}

/** Does this directive admit the host, whether named or covered by the wildcard? */
function admits(d: string, host: string): boolean {
  return d.includes(`https://${host}`) || d.includes("https://*.razorpay.com");
}

describe("payment gateway is reachable", () => {
  const csp = contentSecurityPolicy(true);

  it.each(["script-src", "connect-src", "frame-src"])(
    "%s admits every Razorpay host",
    (name) => {
      const d = directive(csp, name);
      for (const host of RAZORPAY_HOSTS)
        expect(admits(d, host), `${name} blocks ${host}`).toBe(true);
    }
  );

  it("allows the checkout bundle's own host", () => {
    // checkout-static-next is where the modern checkout actually loads from.
    // Blocking it is what broke payments, and it is not a name anyone guesses.
    expect(admits(directive(csp, "script-src"), "checkout-static-next.razorpay.com")).toBe(true);
  });

  it("lets card and netbanking authentication post outwards", () => {
    // form-action 'self' alone stops a 3-D Secure submission leaving the page.
    expect(directive(csp, "form-action")).toContain("razorpay.com");
  });

  it("permits the metrics beacon, which the script sends unconditionally", () => {
    expect(admits(directive(csp, "connect-src"), "lumberjack-metrics.razorpay.com")).toBe(true);
  });
});

describe("everything else stays shut", () => {
  const csp = contentSecurityPolicy(true);

  it("refuses to be framed", () => {
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("keeps the classic markup-to-script escapes closed", () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("does not open up to hosts beyond Razorpay", () => {
    // The wildcard is deliberately scoped to one vendor. A bare https:, or
    // another CDN creeping in, would give injected script somewhere to phone.
    for (const d of csp.split(";").map((x) => x.trim())) {
      const hosts = d.match(/https:\/\/[^\s;]+/g) ?? [];
      for (const h of hosts)
        expect(h.endsWith("razorpay.com"), `unexpected host in "${d}": ${h}`).toBe(true);
    }
  });

  it("still defaults to self", () => {
    expect(csp.startsWith("default-src 'self'")).toBe(true);
  });
});

describe("upgrade-insecure-requests", () => {
  it("is on in production", () => {
    expect(contentSecurityPolicy(true)).toContain("upgrade-insecure-requests");
  });

  it("is off in development", () => {
    /*
     * It would rewrite every asset URL to https on a LAN address that has no
     * TLS listener, so the site opened from a phone renders as unstyled text —
     * while looking perfect on localhost, which browsers exempt.
     */
    expect(contentSecurityPolicy(false)).not.toContain("upgrade-insecure-requests");
  });
});
