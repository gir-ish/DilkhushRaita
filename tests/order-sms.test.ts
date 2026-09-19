import { describe, expect, it } from "vitest";
import { orderSmsFor, type OrderForSms } from "@/lib/order-sms";

/**
 * Which order update goes out, on which template, to whom — decided without a
 * database or a gateway, so nothing here sends a message.
 */

const order = (over: Partial<OrderForSms> = {}): OrderForSms => ({
  orderNumber: "DKHEH0F0JJ",
  type: "DELIVERY",
  userName: "Rahul Kumar",
  contactName: null,
  phone: "+919253171637",
  ...over,
});

describe("order confirmation", () => {
  it("goes out on the template on the STPL panel, with the first name and order number", () => {
    const r = orderSmsFor("confirmed", order());
    expect(r).toEqual({
      templateId: "1777178980273698516",
      phone: "+919253171637",
      message:
        "Hi Rahul, your order DKHEH0F0JJ is confirmed by Dilkhush Raita Wala Dhaba. We are preparing it fresh. Visit: https://dilkhushraita.com/",
    });
  });

  it("is sent for pickup orders too — they are confirmed like any other", () => {
    expect("message" in orderSmsFor("confirmed", order({ type: "PICKUP" }))).toBe(true);
  });
});

describe("order on its way", () => {
  it("uses the dispatch template", () => {
    const r = orderSmsFor("dispatched", order());
    expect("templateId" in r && r.templateId).toBe("1777178980269575871");
    expect("message" in r && r.message).toMatch(/^Hello Rahul, your order DKHEH0F0JJ is on the way/);
  });
});

describe("order delivered", () => {
  it("uses the delivery template", () => {
    const r = orderSmsFor("delivered", order());
    expect("templateId" in r && r.templateId).toBe("1777178964812942753");
    expect("message" in r && r.message).toMatch(/^Hello Rahul, your order DKHEH0F0JJ has been delivered/);
  });

  it("is not sent for pickup or dine-in — nothing was delivered by a rider", () => {
    expect(orderSmsFor("delivered", order({ type: "PICKUP" }))).toEqual({
      skip: "not sent for pickup orders",
    });
    expect(orderSmsFor("delivered", order({ type: "DINE_IN" }))).toEqual({
      skip: "not sent for dine_in orders",
    });
  });
});

describe("names", () => {
  it("falls back to the delivery contact's name, then to 'Friend'", () => {
    const viaContact = orderSmsFor("confirmed", order({ userName: null, contactName: "Priya Singh" }));
    expect("message" in viaContact && viaContact.message).toMatch(/^Hi Priya,/);

    const none = orderSmsFor("confirmed", order({ userName: null, contactName: null }));
    expect("message" in none && none.message).toMatch(/^Hi Friend,/);
  });
});

describe("no number", () => {
  it("sends nothing", () => {
    expect(orderSmsFor("confirmed", order({ phone: null }))).toEqual({
      skip: "no phone number on the order",
    });
  });
});
