import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OTP_TEMPLATE_ID, OTP_TEMPLATE_TEXT, composeOtpMessage, generateOtp, otpProvider } from "@/lib/otp";
import { OTP_EXPIRY_MINS, OTP_LENGTH } from "@/lib/constants";
import { creditsFor } from "@/lib/sms-templates";

/**
 * The STPL gateway is a general SMS API, not an OTP route: we compose the
 * message and hand over the code ourselves, so the request has to be exactly
 * right or the operator drops it silently. These pin the request shape and,
 * just as importantly, that a refusal is reported as one.
 */

const ENV = [
  "OTP_PROVIDER", "STPL_API_KEY", "STPL_SENDER_ID", "STPL_TEMPLATE_ID", "STPL_MESSAGE",
  "STPL_MESSAGE_FILE",
] as const;
const saved: Record<string, string | undefined> = {};

let calls: string[] = [];

function reply(body: unknown, status = 200, asText?: string) {
  vi.stubGlobal("fetch", (url: URL | string) => {
    calls.push(String(url));
    return Promise.resolve(
      new Response(asText ?? JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      })
    );
  });
}

/** The request the provider actually made, parsed back into parameters. */
function sent() {
  return new URL(calls[0]).searchParams;
}

beforeEach(() => {
  calls = [];
  for (const k of ENV) saved[k] = process.env[k];
  process.env.OTP_PROVIDER = "stpl";
  process.env.STPL_API_KEY = "test-key-not-real";
  process.env.STPL_SENDER_ID = "DKDHBA";
  delete process.env.STPL_TEMPLATE_ID;
  delete process.env.STPL_MESSAGE_FILE;
  // Left over from the old template setup; the provider must ignore it.
  process.env.STPL_MESSAGE = "Your code is {otp}. Do not share.";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("stpl provider", () => {
  it("is selected by OTP_PROVIDER", () => {
    expect(otpProvider().name).toBe("stpl");
  });

  it("survives the obvious misspelling of the vendor's name", () => {
    // STPL transposes readily, and a name that does not resolve used to fall
    // back to the console provider.
    process.env.OTP_PROVIDER = "sptl";
    expect(otpProvider().name).toBe("stpl");
  });

  it("refuses to send in production when the gateway name is unknown", async () => {
    const node = process.env.NODE_ENV;
    process.env.OTP_PROVIDER = "nonsense";
    try {
      // @ts-expect-error NODE_ENV is readonly in the types, writable at runtime
      process.env.NODE_ENV = "production";
      const p = otpProvider();
      const r = await p.send("+919876543210", "123456");
      /*
       * The old fallback reported success and printed the code to the log,
       * so a single typo told every customer to check a phone that would
       * never ring — and put the secret in a log file besides.
       */
      expect(r.ok).toBe(false);
      expect(r.devCode).toBeUndefined();
    } finally {
      // @ts-expect-error as above
      process.env.NODE_ENV = node;
    }
  });

  it("sends the documented parameters", async () => {
    reply({ status: true, code: "011", data: { messageid: "1" } });
    const r = await otpProvider().send("+919876543210", "123456");

    expect(r.ok).toBe(true);
    expect(calls[0].startsWith("https://smsfortius.org/V2/apikey.php?")).toBe(true);
    const p = sent();
    expect(p.get("senderid")).toBe("DKDHBA");
    expect(p.get("apikey")).toBe("test-key-not-real");
    expect(p.get("format")).toBe("JSON");
  });

  it("strips the + but keeps the country code", async () => {
    reply({ status: true, code: "011" });
    await otpProvider().send("+919876543210", "123456");
    // Documented as accepted with or without 91; the leading + is part of
    // neither form.
    expect(sent().get("number")).toBe("919876543210");
  });

  it("puts the code into the message, spaces as %20 and never +", async () => {
    /*
     * URLSearchParams writes a space as "+"; the gateway passed it through,
     * the operator compared "Your+Dilkhush+Raita..." against the template,
     * and dropped every message behind a "submitted successfully" reply.
     */
    reply({ status: "Success", code: "011" });
    await otpProvider().send("+919876543210", "4821");
    const raw = calls[0];
    const messageParam = raw.slice(raw.indexOf("&message=") + "&message=".length).split("&")[0];
    expect(messageParam).toContain("%20");
    expect(messageParam).not.toContain("+");
    expect(decodeURIComponent(messageParam)).toContain("OTP is 4821.");
  });

  it("sends the approved template, word for word, under its own ID", async () => {
    reply({ status: "Success", code: "011" });
    const r = await otpProvider().send("+919876543210", "4821");
    expect(r.ok).toBe(true);
    expect(sent().get("templateid")).toBe("1777178937435571947");
    expect(sent().get("message")).toBe(
      "Your Dilkhush Raita verification OTP is 4821. Do not share this OTP with anyone. Valid for 5 minutes. Visit https://dilkhushraita.com/"
    );
  });

  it("changes nothing but the two slots", () => {
    // The operator compares the fixed text around each {#var#}. Put the slots
    // back and what is left must be the registration, character for character.
    const msg = composeOtpMessage("4821", 5);
    expect(msg.replace("4821", "{#var#}").replace(" 5 ", "{#var#}")).toBe(OTP_TEMPLATE_TEXT);
  });

  it("matches the template on the STPL panel", () => {
    // 14-Sep-2026, row 9 of the panel's list.
    expect(OTP_TEMPLATE_ID).toBe("1777178937435571947");
    expect(OTP_TEMPLATE_TEXT).toBe(
      "Your Dilkhush Raita verification OTP is {#var#}. Do not share this OTP with anyone. Valid for{#var#}minutes. Visit https://dilkhushraita.com/"
    );
  });

  it("says the code lasts as long as it actually does", () => {
    expect(OTP_EXPIRY_MINS).toBe(5);
    expect(composeOtpMessage("4821")).toContain("Valid for 5 minutes.");
  });

  it("fits in one SMS credit", () => {
    const msg = composeOtpMessage("9999");
    expect(msg.length).toBeLessThanOrEqual(160);
    expect(creditsFor(msg)).toBe(1);
  });

  it("ignores the old wording and ID an older server .env still carries", async () => {
    // The previous template was configured through these. Left behind on a
    // server they must not put the new message under the old ID — the one
    // mismatch the operator drops.
    process.env.STPL_MESSAGE = "Dear Customer, your OTP for registration on Dilkhush Raita is{otp}.";
    process.env.STPL_TEMPLATE_ID = "1777178772255400845";
    reply({ status: "Success", code: "011" });
    await otpProvider().send("+919876543210", "4821");
    expect(sent().get("templateid")).toBe("1777178937435571947");
    expect(sent().get("message")).toMatch(/^Your Dilkhush Raita verification OTP is 4821\./);
  });

  it("makes four-digit codes, leading zeros and all", () => {
    expect(OTP_LENGTH).toBe(4);
    const codes = Array.from({ length: 3000 }, () => generateOtp());
    expect(codes.every((c) => /^\d{4}$/.test(c))).toBe(true);
    // Every value is possible, so some begin with 0 — and are kept that way.
    expect(codes.some((c) => c.startsWith("0"))).toBe(true);
  });

  it("omits apikey entirely when the account does not use one", async () => {
    // The docs call it conditional: some accounts authenticate by route.
    delete process.env.STPL_API_KEY;
    reply({ status: true, code: "011" });
    await otpProvider().send("+919876543210", "123456");
    expect(sent().has("apikey")).toBe(false);
  });

  it("accepts the reply the live gateway actually sends", async () => {
    /*
     * Captured from the real account on 2026-08-26. Worth pinning verbatim:
     * the published documentation shows `"status": true` as a boolean, and the
     * gateway in fact answers with the string "Success" and carries a
     * `description` field the docs do not mention at all. Reading `status`
     * literally would have rejected every message it successfully sent.
     */
    reply({
      status: "Success",
      code: "011",
      description: "Message submitted successfully",
      data: { messageid: "19351", totnumber: 1, totalcredit: 1 },
    });
    expect((await otpProvider().send("+919876543210", "123456")).ok).toBe(true);
  });

  it("accepts the other two shapes of status seen in the wild", async () => {
    for (const status of [true, "true"]) {
      calls = [];
      reply({ status, code: "011" });
      expect((await otpProvider().send("+919876543210", "123456")).ok).toBe(true);
    }
  });

  it("reports every documented failure as a failure", async () => {
    for (const code of ["001", "002", "004", "007", "008", "009", "010"]) {
      calls = [];
      reply({ status: false, code });
      const r = await otpProvider().send("+919876543210", "123456");
      expect(r.ok, `code ${code} must not count as sent`).toBe(false);
    }
  });

  it("does not treat an out-of-credit account as a delivered message", async () => {
    // The one most likely to happen in production, and the one that would be
    // worst to paper over: the customer would sit waiting for an SMS that the
    // gateway never even attempted.
    reply({ status: false, code: "008" });
    expect((await otpProvider().send("+919876543210", "123456")).ok).toBe(false);
  });

  it("fails on an HTML error page instead of throwing", async () => {
    reply(null, 200, "<html><body>Service unavailable</body></html>");
    expect((await otpProvider().send("+919876543210", "123456")).ok).toBe(false);
  });

  it("fails, rather than hangs, when the network breaks", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("ECONNRESET")));
    expect((await otpProvider().send("+919876543210", "123456")).ok).toBe(false);
  });

  it("refuses to send at all without a sender id", async () => {
    delete process.env.STPL_SENDER_ID;
    reply({ status: true, code: "011" });
    const r = await otpProvider().send("+919876543210", "123456");
    expect(r.ok).toBe(false);
    // Not merely reported as failed — no request was made, so no credit spent.
    expect(calls).toHaveLength(0);
  });

  it("never returns the code to the caller", async () => {
    // Only the dev console provider may do that; a real gateway handing the
    // OTP back would put it on the wire to the browser.
    reply({ status: true, code: "011" });
    const r = await otpProvider().send("+919876543210", "123456");
    expect(r.devCode).toBeUndefined();
  });
});
