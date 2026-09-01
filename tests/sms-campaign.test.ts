import { describe, expect, it } from "vitest";
import {
  batches,
  creditsFor,
  parseRecipients,
  promoIsSendable,
  renderPromo,
} from "@/lib/sms-campaign";

/**
 * A campaign is the one button in the dashboard that spends money per press,
 * and the amount is not obvious from looking at the list. Everything here
 * protects the balance: what counts as a valid number, what a message costs,
 * and what must never reach the gateway.
 */

describe("reading a pasted list", () => {
  it("takes numbers however they were written", () => {
    const { numbers } = parseRecipients(`
      9876543210
      +91 98123 45678, 919000000001
      09000000002;9000000003
    `);
    expect(numbers).toEqual([
      "+919876543210",
      "+919812345678",
      "+919000000001",
      "+919000000002",
      "+919000000003",
    ]);
  });

  it("collapses duplicates instead of charging twice for them", () => {
    // The same number twice is a spreadsheet artefact, not a decision — and
    // sending twice costs twice while annoying once.
    const r = parseRecipients("9876543210, 9876543210, +919876543210, 09876543210");
    expect(r.numbers).toHaveLength(1);
    expect(r.duplicates).toBe(3);
  });

  it("reports what it could not use, rather than dropping it silently", () => {
    const r = parseRecipients("9876543210, 12345, hello, 5000000000");
    expect(r.numbers).toEqual(["+919876543210"]);
    expect(r.rejected.map((x) => x.raw)).toEqual(["12345", "hello", "5000000000"]);
  });

  it("refuses to go past the campaign ceiling", () => {
    const many = Array.from({ length: 60 }, (_, i) => `98765${String(i).padStart(5, "0")}`).join("\n");
    const r = parseRecipients(many, 50);
    expect(r.numbers).toHaveLength(50);
    expect(r.rejected.length).toBe(10);
  });
});

describe("what a message costs", () => {
  it("is one credit up to 160 characters", () => {
    expect(creditsFor("a".repeat(1))).toBe(1);
    expect(creditsFor("a".repeat(160))).toBe(1);
  });

  it("is two the moment it goes over, which is the trap", () => {
    // 161 characters doubles the bill for the whole campaign. Worth seeing
    // before pressing send, not after.
    expect(creditsFor("a".repeat(161))).toBe(2);
    expect(creditsFor("a".repeat(306))).toBe(2);
    expect(creditsFor("a".repeat(307))).toBe(3);
  });
});

describe("what may reach the gateway", () => {
  it("refuses a message with an unfilled DLT slot", () => {
    // It would be charged for and then dropped for not matching its template,
    // and whoever received it would read "{#var#}".
    const v = promoIsSendable("Dear {#var#}, visit us");
    expect(v.ok).toBe(false);
  });

  it("refuses characters the printer of last resort cannot carry", () => {
    // Emoji and Devanagari are not in the gateway's code page; they arrive as
    // mojibake, and the altered text no longer matches the template.
    expect(promoIsSendable("Order now 🎉").ok).toBe(false);
    expect(promoIsSendable("Save ₹100 today").ok).toBe(false);
  });

  it("refuses an empty message", () => {
    expect(promoIsSendable("   ").ok).toBe(false);
  });

  it("accepts plain approved wording", () => {
    expect(promoIsSendable("Dear Customer, order online at dilkhushraita.com").ok).toBe(true);
  });
});

describe("filling the template", () => {
  it("resolves every slot to something", () => {
    // A blank where a word belongs changes the fixed text around it, which is
    // what the operator matches on.
    expect(renderPromo("Dear {#var#}, order now")).toBe("Dear Customer, order now");
    expect(renderPromo("Dear {name}, order now")).toBe("Dear Customer, order now");
  });

  it("strips anything unsendable out of a supplied greeting", () => {
    expect(renderPromo("Dear {name}!", "Girish 🎉")).toBe("Dear Girish !");
  });

  it("falls back rather than leave a gap", () => {
    expect(renderPromo("Dear {name}!", "   ")).toBe("Dear Customer!");
  });
});

describe("batching", () => {
  it("splits the list so one failure cannot take the campaign with it", () => {
    const b = batches(Array.from({ length: 125 }, (_, i) => i), 50);
    expect(b.map((x) => x.length)).toEqual([50, 50, 25]);
  });

  it("handles an empty list without producing an empty request", () => {
    expect(batches([], 50)).toEqual([]);
  });
});
