import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/utils";
import { hashOtp, otpHashMatches } from "@/lib/otp";

/**
 * The `?next=` parameter on both login screens is attacker-writable, and what
 * reads it hands the value straight to a router. These are the shapes a browser
 * treats as "another site" — every one of them has to be refused, or a link
 * that starts on the real domain finishes on a copy of the login page.
 */
describe("safeNextPath — open redirect", () => {
  it("keeps ordinary same-site paths", () => {
    expect(safeNextPath("/account", "/fallback")).toBe("/account");
    expect(safeNextPath("/admin/orders?status=PLACED", "/fallback")).toBe(
      "/admin/orders?status=PLACED"
    );
    expect(safeNextPath("/orders/abc#top", "/fallback")).toBe("/orders/abc#top");
  });

  it("refuses an absolute URL to another origin", () => {
    expect(safeNextPath("https://evil.example/login", "/admin")).toBe("/admin");
    expect(safeNextPath("http://evil.example", "/admin")).toBe("/admin");
  });

  it("refuses a protocol-relative URL, which browsers read as another host", () => {
    expect(safeNextPath("//evil.example", "/admin")).toBe("/admin");
    expect(safeNextPath("//evil.example/admin/login", "/admin")).toBe("/admin");
  });

  it("refuses backslash forms, which browsers normalise to slashes", () => {
    // Built from a char code rather than written as an escape: a lone backslash
    // in a source literal is exactly the thing that gets lost in transit, and a
    // test that quietly checks "/evil.example" instead proves nothing.
    const BS = String.fromCharCode(92);
    expect(safeNextPath(`/${BS}evil.example`, "/admin")).toBe("/admin");
    expect(safeNextPath(`${BS}${BS}evil.example`, "/admin")).toBe("/admin");
    expect(safeNextPath(`/admin${BS}@evil.example`, "/admin")).toBe("/admin");
  });

  it("refuses script and data URLs", () => {
    expect(safeNextPath("javascript:alert(1)", "/admin")).toBe("/admin");
    expect(safeNextPath("data:text/html,<script>alert(1)</script>", "/admin")).toBe("/admin");
  });

  it("falls back rather than failing when nothing was supplied", () => {
    expect(safeNextPath(null, "/account")).toBe("/account");
    expect(safeNextPath(undefined, "/account")).toBe("/account");
    expect(safeNextPath("", "/account")).toBe("/account");
  });
});

describe("otpHashMatches", () => {
  it("accepts the hash of the code that was issued", () => {
    const h = hashOtp("+919000000001", "123456");
    expect(otpHashMatches(h, hashOtp("+919000000001", "123456"))).toBe(true);
  });

  it("rejects a different code, and the same code for a different number", () => {
    const h = hashOtp("+919000000001", "123456");
    expect(otpHashMatches(h, hashOtp("+919000000001", "123457"))).toBe(false);
    expect(otpHashMatches(h, hashOtp("+919000000002", "123456"))).toBe(false);
  });

  it("rejects rather than throwing when the stored value is the wrong length", () => {
    expect(otpHashMatches("", hashOtp("+919000000001", "123456"))).toBe(false);
    expect(otpHashMatches("abc", hashOtp("+919000000001", "123456"))).toBe(false);
  });
});
