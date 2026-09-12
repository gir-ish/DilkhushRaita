import { describe, expect, it } from "vitest";
import {
  NAME_FALLBACK,
  SMS_TEMPLATES,
  cleanSlot,
  creditsFor,
  fillTemplate,
  firstName,
  type TemplateKey,
} from "@/lib/sms-templates";

/**
 * Every registered template, checked against the DLT registration file
 * character for character.
 *
 * An operator drops a message whose fixed text differs from its registration —
 * after the credit is spent, while the gateway still reports success. So a
 * wording change here that was not made on the portal first is a campaign that
 * silently never arrives. These tests are what stops a well-meant tidy-up.
 */

/** Copied from dilkhush_dlt_templates.txt as registered. */
const REGISTERED: Record<TemplateKey, { id: string; reference: string; text: string }> = {
  orderConfirmed: {
    id: "1777178765679680261",
    reference: "11-14P1NMT8KP8CJ",
    text: "Hi {#var#}, your order {#var#} is confirmed by Dilkhush Raita Wala Dhaba. We are preparing it fresh. Track: https://dilkhushraita.com/",
  },
  orderConfirmedHello: {
    id: "1777178765626391293",
    reference: "11-14PDAMT8KDT61",
    text: "Hello {#var#}, your order {#var#} is confirmed by Dilkhush Raita Wala Dhaba. We are preparing it fresh. Track: https://dilkhushraita.com/",
  },
  orderDispatched: {
    id: "1777178765631197871",
    reference: "11-14P1NMT8KEU96",
    text: "Hello {#var#}, your order {#var#} is on the way from Dilkhush Raita Wala Dhaba. Get ready to enjoy! Track: https://dilkhushraita.com/",
  },
  orderDelivered: {
    id: "1777178765635892877",
    reference: "11-14P1NMT8KFUHC",
    text: "Hello {#var#}, your order {#var#} has been delivered. Thank you for choosing Dilkhush Raita Wala Dhaba. Visit: https://dilkhushraita.com/",
  },
  customerOffer: {
    id: "1777178765640634307",
    reference: "11-14P1NMT8KGV2F",
    text: "Hi {#var#}, you earned {#var#} Dilkhush Points on your order! Use your points to save on your next order: https://dilkhushraita.com/",
  },
  specialOffer: {
    id: "1777178765644561700",
    reference: "11-14OFUMT8KHPDE",
    text: "{#var#} is live at Dilkhush Raita Wala Dhaba! Use coupon {#var#} to get a special discount. Order now: https://dilkhushraita.com/",
  },
  websitePromotion: {
    id: "1777178765648170151",
    reference: "11-14OFUMT8KIH7Q",
    text: "Hi! {#var#}, craving real dhaba flavours? Dilkhush Raita Wala Dhaba is live! Explore our tasty menu & order fresh food now: https://dilkhushraita.com/",
  },
};

describe("the catalog matches what is registered", () => {
  it.each(Object.keys(REGISTERED) as TemplateKey[])("%s", (key) => {
    const t = SMS_TEMPLATES[key];
    expect(t.id).toBe(REGISTERED[key].id);
    expect(t.reference).toBe(REGISTERED[key].reference);
    expect(t.text).toBe(REGISTERED[key].text);
  });

  it("holds every registration and nothing else", () => {
    expect(Object.keys(SMS_TEMPLATES).sort()).toEqual(Object.keys(REGISTERED).sort());
  });

  it("uses the confirmation the shop chose", () => {
    // Two confirmations are registered; the "Hi" one was picked to send.
    expect(SMS_TEMPLATES.orderConfirmed.id).toBe("1777178765679680261");
  });

  it("describes one slot per {#var#}", () => {
    for (const t of Object.values(SMS_TEMPLATES))
      expect(t.slots.length, t.name).toBe((t.text.match(/\{#var#\}/g) ?? []).length);
  });

  it("has only plain GSM-7 in the fixed text", () => {
    // One character outside that alphabet forces UCS-2: 70 characters a
    // credit instead of 160, for every recipient.
    for (const t of Object.values(SMS_TEMPLATES))
      expect([...t.text].filter((c) => c.charCodeAt(0) > 126), t.name).toEqual([]);
  });

  it("keeps order updates transactional and offers promotional", () => {
    // The category decides whether a Do Not Disturb number receives it and
    // whether the customer's promotions switch applies.
    for (const k of ["orderConfirmed", "orderDispatched", "orderDelivered"] as const)
      expect(SMS_TEMPLATES[k].category).toBe("transactional");
    for (const k of ["websitePromotion", "specialOffer", "customerOffer"] as const)
      expect(SMS_TEMPLATES[k].category).toBe("promotional");
  });
});

describe("filling a template", () => {
  it("fills the slots in order", () => {
    expect(fillTemplate("orderConfirmed", ["Rahul", "DKHEH0F0JJ"])).toBe(
      "Hi Rahul, your order DKHEH0F0JJ is confirmed by Dilkhush Raita Wala Dhaba. We are preparing it fresh. Track: https://dilkhushraita.com/"
    );
    expect(fillTemplate("specialOffer", ["Diwali Dhamaka", "DIWALI50"])).toBe(
      "Diwali Dhamaka is live at Dilkhush Raita Wala Dhaba! Use coupon DIWALI50 to get a special discount. Order now: https://dilkhushraita.com/"
    );
    expect(fillTemplate("websitePromotion", ["Priya"])).toBe(
      "Hi! Priya, craving real dhaba flavours? Dilkhush Raita Wala Dhaba is live! Explore our tasty menu & order fresh food now: https://dilkhushraita.com/"
    );
  });

  it("refuses the wrong number of values", () => {
    expect(() => fillTemplate("orderConfirmed", ["Rahul"])).toThrow(/2 value/);
    expect(() => fillTemplate("websitePromotion", ["Priya", "extra"])).toThrow(/1 value/);
  });

  it("refuses a value that is empty once cleaned", () => {
    // An empty slot changes the fixed text around it, so the operator would
    // drop the message after it was paid for.
    expect(() => fillTemplate("websitePromotion", ["🎉🎉"])).toThrow(/empty/);
  });

  it("never leaves a slot unfilled", () => {
    const m = fillTemplate("customerOffer", ["Aman", "45"]);
    expect(m).not.toContain("{#var#}");
    expect(m).toContain("you earned 45 Dilkhush Points");
  });
});

describe("cleaning what goes into a slot", () => {
  it("spells the rupee sign out rather than losing it", () => {
    // Real coupon names in the shop's data carry it: "20% off on ₹499+".
    expect(cleanSlot("20% off on ₹499+")).toBe("20% off on Rs.499+");
    expect(cleanSlot("₹100 welcome-back treat")).toBe("Rs.100 welcome-back treat");
  });

  it("strips anything outside GSM-7, and braces that could pose as a slot", () => {
    expect(cleanSlot("Rahul 🎉")).toBe("Rahul");
    expect(cleanSlot("{#var#}")).toBe("#var#");
  });

  it("holds a slot to thirty characters", () => {
    expect(cleanSlot("x".repeat(50))).toHaveLength(30);
  });
});

describe("first names", () => {
  it("takes only the first name", () => {
    expect(firstName("Rahul Kumar Sharma")).toBe("Rahul");
  });

  it("cases it like a greeting", () => {
    expect(firstName("RAHUL")).toBe("Rahul");
    expect(firstName("priya")).toBe("Priya");
  });

  it("returns nothing when there is nothing usable, so the caller falls back", () => {
    expect(firstName(null)).toBeNull();
    expect(firstName("")).toBeNull();
    expect(firstName("राहुल")).toBeNull(); // Devanagari cannot go through GSM-7
    expect(firstName("123")).toBeNull();
  });

  it("falls back to a greeting, not to 'Customer'", () => {
    expect(NAME_FALLBACK).toBe("Friend");
    expect(NAME_FALLBACK).not.toBe("Customer");
  });
});

describe("what each message costs", () => {
  it("keeps every template in one credit with ordinary values", () => {
    const realistic: Record<TemplateKey, string[]> = {
      orderConfirmed: ["Rahul", "DKHEH0F0JJ"],
      orderConfirmedHello: ["Rahul", "DKHEH0F0JJ"],
      orderDispatched: ["Rahul", "DKHEH0F0JJ"],
      orderDelivered: ["Rahul", "DKHEH0F0JJ"],
      customerOffer: ["Rahul", "120"],
      specialOffer: ["Rs.100 welcome-back treat", "COMEBACK100"],
      websitePromotion: ["Rahul"],
    };
    for (const [k, v] of Object.entries(realistic)) {
      const m = fillTemplate(k as TemplateKey, v);
      expect(creditsFor(m), `${k}: ${m.length} chars`).toBe(1);
    }
  });

  it("goes to two credits for a long first name on the promotion, and says so", () => {
    // The Website Promotion has seventeen characters of room. The preview
    // counts this per message rather than assuming one credit each.
    expect(creditsFor(fillTemplate("websitePromotion", ["Abcdefghijklmnopq"]))).toBe(1);
    expect(creditsFor(fillTemplate("websitePromotion", ["Abcdefghijklmnopqr"]))).toBe(2);
  });
});
