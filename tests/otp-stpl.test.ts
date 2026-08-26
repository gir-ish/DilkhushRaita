import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { otpProvider } from "@/lib/otp";

/**
 * The STPL gateway is a general SMS API, not an OTP route: we compose the
 * message and hand over the code ourselves, so the request has to be exactly
 * right or the operator drops it silently. These pin the request shape and,
 * just as importantly, that a refusal is reported as one.
 */

const ENV = [
  "OTP_PROVIDER", "STPL_API_KEY", "STPL_SENDER_ID", "STPL_TEMPLATE_ID", "STPL_MESSAGE",
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
  delete process.env.STPL_MESSAGE;
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

  it("puts the code into the message and encodes it", async () => {
    reply({ status: true, code: "011" });
    await otpProvider().send("+919876543210", "654321");
    const msg = sent().get("message") ?? "";
    expect(msg).toContain("654321");
    // Spaces must survive as spaces once decoded — a raw space in the query
    // string is what breaks these gateways.
    expect(msg).toContain(" ");
    expect(calls[0]).not.toContain(" ");
  });

  it("uses the operator-approved wording when one is configured", async () => {
    // Indian operators match every message against the registered DLT template
    // and bin anything that differs, so this override is the normal case.
    process.env.STPL_MESSAGE = "Your DilKhush code is {otp}. Do not share.";
    reply({ status: true, code: "011" });
    await otpProvider().send("+919876543210", "111222");
    expect(sent().get("message")).toBe("Your DilKhush code is 111222. Do not share.");
  });

  it("sends DilKhush's real approved template with the code in place", async () => {
    // The wording registered as template 1777178772255400845. Note "is{otp}"
    // with no space — that is how it was approved, so that is how it must go
    // out.
    process.env.STPL_MESSAGE =
      "Dear Customer, your OTP for registration on Dilkhush Raita is{otp}. " +
      "This OTP is valid for 10 minutes. Please do not share it with anyone. " +
      "Visit https://dilkhushraita.com/";
    reply({ status: "Success", code: "011" });
    const r = await otpProvider().send("+919876543210", "482913");

    expect(r.ok).toBe(true);
    expect(sent().get("message")).toBe(
      "Dear Customer, your OTP for registration on Dilkhush Raita is482913. " +
        "This OTP is valid for 10 minutes. Please do not share it with anyone. " +
        "Visit https://dilkhushraita.com/"
    );
  });

  it("fills a lone DLT {#var#} slot with the code", async () => {
    process.env.STPL_MESSAGE = "Your code is {#var#}. Do not share.";
    reply({ status: true, code: "011" });
    await otpProvider().send("+919876543210", "778899");
    expect(sent().get("message")).toBe("Your code is 778899. Do not share.");
  });

  it("refuses rather than mail an unfilled placeholder", async () => {
    /*
     * The DLT template carries two {#var#} slots — a greeting and the code —
     * and only its author knows which is which. Sending it raw would put a
     * literal "{#var#}" in front of a customer, and the operator would drop it
     * for not matching the template regardless: a wasted credit and a confused
     * reader.
     */
    process.env.STPL_MESSAGE =
      "Dear {#var#}, your OTP for registration on Dilkhush Raita is{#var#}.";
    reply({ status: true, code: "011" });
    const r = await otpProvider().send("+919876543210", "123456");

    expect(r.ok).toBe(false);
    expect(calls).toHaveLength(0); // no credit spent
  });

  it("sends templateid only when one is set", async () => {
    reply({ status: true, code: "011" });
    await otpProvider().send("+919876543210", "123456");
    expect(sent().has("templateid")).toBe(false);

    calls = [];
    process.env.STPL_TEMPLATE_ID = "1207161234567890";
    reply({ status: true, code: "011" });
    await otpProvider().send("+919876543210", "123456");
    expect(sent().get("templateid")).toBe("1207161234567890");
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
