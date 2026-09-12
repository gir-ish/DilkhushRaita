import { describe, expect, it } from "vitest";
import { BATCH_SIZE, batches, parseRecipients, planCampaign } from "@/lib/promo-sms";

/**
 * Campaigns spend money per recipient, and with first names in the greeting
 * each person can get a different message. These pin who is included, what
 * each receives, and what it all costs — before anything reaches the gateway.
 */

describe("reading a list of numbers", () => {
  it("takes them however they were written", () => {
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

  it("keeps a number written with spaces in one piece", () => {
    // "+91 98765 43210" is the ordinary way to write it here. Splitting on
    // whitespace turns one number into three unusable fragments.
    expect(parseRecipients("+91 98765 43210").numbers).toEqual(["+919876543210"]);
  });

  it("collapses duplicates rather than charging twice for them", () => {
    const r = parseRecipients("9876543210, 9876543210, +919876543210, 09876543210");
    expect(r.numbers).toHaveLength(1);
    expect(r.duplicates).toBe(3);
  });

  it("reports what it could not use instead of dropping it", () => {
    const r = parseRecipients("9876543210, 12345, hello, 5000000000");
    expect(r.numbers).toEqual(["+919876543210"]);
    expect(r.rejected.map((x) => x.raw)).toEqual(["12345", "hello", "5000000000"]);
  });

  it("refuses to go past the campaign ceiling", () => {
    const many = Array.from({ length: 60 }, (_, i) => `98765${String(i).padStart(5, "0")}`).join("\n");
    const r = parseRecipients(many, 50);
    expect(r.numbers).toHaveLength(50);
    expect(r.rejected).toHaveLength(10);
  });
});

describe("Website Promotion", () => {
  it("greets each customer by their own first name", () => {
    const plan = planCampaign("websitePromotion", [
      { phone: "+919000000001", name: "Rahul Kumar" },
      { phone: "+919000000002", name: "PRIYA SINGH" },
    ]);
    const messages = plan.groups.map((g) => g.message);
    expect(messages[0]).toMatch(/^Hi! Rahul, craving/);
    expect(messages[1]).toMatch(/^Hi! Priya, craving/);
  });

  it("uses 'Friend', never 'Customer', when there is no name", () => {
    const plan = planCampaign("websitePromotion", [{ phone: "+919000000001", name: null }]);
    expect(plan.groups[0].message).toMatch(/^Hi! Friend, craving/);
    expect(plan.groups[0].message).not.toContain("Customer");
  });

  it("groups people who get the same message, so it still goes out in batches", () => {
    // One gateway call per distinct message, not one per person.
    const plan = planCampaign("websitePromotion", [
      { phone: "+919000000001", name: "Rahul" },
      { phone: "+919000000002", name: "rahul sharma" },
      { phone: "+919000000003", name: null },
      { phone: "+919000000004", name: null },
    ]);
    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.map((g) => g.numbers.length)).toEqual([2, 2]);
    expect(plan.recipients).toBe(4);
  });
});

describe("the promotions switch", () => {
  it("leaves out anyone who turned promotions off, whichever template", () => {
    for (const t of ["websitePromotion", "customerOffer"] as const) {
      const plan = planCampaign(t, [
        { phone: "+919000000001", name: "Rahul", points: 40, optedOut: true },
        { phone: "+919000000002", name: "Priya", points: 40 },
      ]);
      expect(plan.recipients, t).toBe(1);
      expect(plan.skipped, t).toEqual([
        { phone: "+919000000001", why: "turned promotional messages off" },
      ]);
    }
  });
});

describe("Special Offer", () => {
  it("puts the coupon's name and code into the message, the same for everyone", () => {
    const plan = planCampaign(
      "specialOffer",
      [
        { phone: "+919000000001", name: "Rahul" },
        { phone: "+919000000002", name: "Priya" },
      ],
      { name: "₹100 welcome-back treat", code: "COMEBACK100" }
    );
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].message).toBe(
      "Rs.100 welcome-back treat is live at Dilkhush Raita Wala Dhaba! Use coupon COMEBACK100 to get a special discount. Order now: https://dilkhushraita.com/"
    );
  });

  it("will not build without a coupon", () => {
    expect(() => planCampaign("specialOffer", [{ phone: "+919000000001" }])).toThrow(/coupon/);
  });
});

describe("Points Reminder", () => {
  it("tells each customer the points they actually earned", () => {
    const plan = planCampaign("customerOffer", [
      { phone: "+919000000001", name: "Rahul", points: 45 },
      { phone: "+919000000002", name: "Priya", points: 120 },
    ]);
    expect(plan.groups.map((g) => g.message)).toEqual([
      "Hi Rahul, you earned 45 Dilkhush Points on your order! Use your points to save on your next order: https://dilkhushraita.com/",
      "Hi Priya, you earned 120 Dilkhush Points on your order! Use your points to save on your next order: https://dilkhushraita.com/",
    ]);
  });

  it("skips anyone with no points rather than telling them they earned none", () => {
    const plan = planCampaign("customerOffer", [
      { phone: "+919000000001", name: "Rahul", points: 0 },
      { phone: "+919000000002", name: "Priya", points: null },
      { phone: "+919000000003", name: "Aman", points: 30 },
    ]);
    expect(plan.recipients).toBe(1);
    expect(plan.skipped.map((s) => s.why)).toEqual([
      "has not earned any points",
      "has not earned any points",
    ]);
  });
});

describe("what it costs", () => {
  it("adds up per message, since messages can differ in length", () => {
    const plan = planCampaign("websitePromotion", [
      { phone: "+919000000001", name: "Rahul" }, // 1 credit
      { phone: "+919000000002", name: "Abcdefghijklmnopqrst" }, // 20 letters: 2 credits
    ]);
    expect(plan.credits).toBe(3);
  });
});

describe("batching", () => {
  it("splits so one failure cannot take the campaign with it", () => {
    const b = batches(Array.from({ length: 125 }, (_, i) => i), BATCH_SIZE);
    expect(b.map((x) => x.length)).toEqual([50, 50, 25]);
  });

  it("produces no empty request for an empty list", () => {
    expect(batches([])).toEqual([]);
  });
});
