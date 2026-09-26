import { describe, expect, it } from "vitest";
import {
  categoryLabel,
  daysOfMonth,
  istDayKeyOf,
  istDayStart,
  istMonthKey,
  istMonthRange,
  summarise,
  toCsv,
  type ExpenseLike,
} from "@/lib/expenses";

const on = (day: string, over: Partial<ExpenseLike> = {}): ExpenseLike => ({
  date: istDayStart(day)!,
  category: "GROCERIES",
  payee: null,
  amount: 100,
  paidBy: "CASH",
  unpaid: false,
  branchId: null,
  ...over,
});

describe("Indian days", () => {
  it("starts a day at midnight in Delhi, not in London", () => {
    // 2026-09-24T00:00+05:30 is 2026-09-23T18:30Z.
    expect(istDayStart("2026-09-24")!.toISOString()).toBe("2026-09-23T18:30:00.000Z");
  });

  it("files half past midnight in Delhi under that date", () => {
    // 19:30Z is 01:00 the next morning in India.
    expect(istDayKeyOf(new Date("2026-09-23T19:30:00Z"))).toBe("2026-09-24");
  });

  it("refuses a date that is not one", () => {
    expect(istDayStart("24-09-2026")).toBeNull();
    expect(istDayStart("")).toBeNull();
  });

  it("covers a whole month, and only that month", () => {
    const r = istMonthRange("2026-09")!;
    expect(r.start.toISOString()).toBe("2026-08-31T18:30:00.000Z");
    expect(r.end.toISOString()).toBe("2026-09-30T18:30:00.000Z");
  });

  it("rolls December into the next January", () => {
    expect(istMonthRange("2026-12")!.end.toISOString()).toBe("2026-12-31T18:30:00.000Z");
  });

  it("refuses a month that is not one", () => {
    expect(istMonthRange("2026-13")).toBeNull();
    expect(istMonthRange("2026")).toBeNull();
  });

  it("lists every day of the month", () => {
    expect(daysOfMonth("2026-02")).toHaveLength(28);
    expect(daysOfMonth("2026-09")).toHaveLength(30);
    expect(daysOfMonth("2026-09")[0]).toBe("2026-09-01");
    expect(daysOfMonth("2026-09").at(-1)).toBe("2026-09-30");
  });

  it("gives a month key for a moment", () => {
    expect(istMonthKey(new Date("2026-09-23T19:30:00Z"))).toBe("2026-09");
  });
});

describe("summarise", () => {
  const rows: ExpenseLike[] = [
    on("2026-09-01", { category: "GROCERIES", amount: 1200 }),
    on("2026-09-01", { category: "VEGETABLES", amount: 800, branchId: "rohini" }),
    on("2026-09-02", { category: "HELPER", payee: "Ramesh", amount: 500, paidBy: "UPI" }),
    on("2026-09-02", { category: "HELPER", payee: "Ramesh", amount: 500 }),
    on("2026-09-02", { category: "HELPER", payee: "Suresh", amount: 700 }),
    on("2026-09-03", { category: "GAS", amount: 1100, unpaid: true, branchId: "nsp" }),
  ];
  const s = summarise(rows);

  it("adds up what went out", () => {
    expect(s.total).toBe(4800);
  });

  it("separates what is still owed to a supplier", () => {
    expect(s.unpaid).toBe(1100);
    expect(s.paid).toBe(3700);
  });

  it("ranks where the money went, biggest first", () => {
    expect(s.byCategory[0]).toEqual({ key: "HELPER", amount: 1700, count: 3 });
    expect(s.byCategory.map((c) => c.key)).toEqual(["HELPER", "GROCERIES", "GAS", "VEGETABLES"]);
  });

  it("answers what each helper was paid", () => {
    expect(s.byPayee).toEqual([
      { payee: "Ramesh", amount: 1000, count: 2 },
      { payee: "Suresh", amount: 700, count: 1 },
    ]);
  });

  it("counts a supplier's name under its category, not as a helper", () => {
    const withSupplier = summarise([
      ...rows,
      on("2026-09-04", { category: "GROCERIES", payee: "Sharma Dairy", amount: 300 }),
    ]);
    expect(withSupplier.byPayee.map((p) => p.payee)).toEqual(["Ramesh", "Suresh"]);
  });

  it("splits by restaurant, with shared costs under 'both'", () => {
    expect(s.byBranch).toEqual({ both: 2900, rohini: 800, nsp: 1100 });
  });

  it("splits by how it was paid", () => {
    expect(s.byPaidBy).toEqual({ CASH: 4300, UPI: 500 });
  });

  it("totals each day", () => {
    expect(s.byDay).toEqual({ "2026-09-01": 2000, "2026-09-02": 1700, "2026-09-03": 1100 });
  });

  it("is all zeroes for an empty book", () => {
    const empty = summarise([]);
    expect(empty).toMatchObject({ total: 0, paid: 0, unpaid: 0, byCategory: [], byPayee: [] });
  });

  it("does not drift on repeated fractions", () => {
    const pennies = summarise([
      on("2026-09-01", { amount: 10.1 }),
      on("2026-09-01", { amount: 20.2 }),
      on("2026-09-01", { amount: 0.7 }),
    ]);
    expect(pennies.total).toBe(31);
    expect(pennies.byDay["2026-09-01"]).toBe(31);
  });
});

describe("categoryLabel", () => {
  it("names a category", () => {
    expect(categoryLabel("HELPER")).toBe("🧑‍🍳 Helper / staff wages");
  });

  it("falls back to whatever was stored", () => {
    expect(categoryLabel("MYSTERY")).toBe("MYSTERY");
  });
});

describe("toCsv", () => {
  it("writes a row a spreadsheet can read", () => {
    const csv = toCsv([
      {
        ...on("2026-09-02", { category: "HELPER", payee: "Ramesh", amount: 500, paidBy: "UPI" }),
        note: null,
        branchName: "Rohini",
      },
    ]);
    const [head, row] = csv.split("\n");
    expect(head).toBe("Date,Branch,Category,Paid to,Note,Amount,Paid by,Status");
    expect(row).toBe("2026-09-02,Rohini,Helper / staff wages,Ramesh,,500.00,UPI,Paid");
  });

  it("quotes a note that contains a comma", () => {
    const csv = toCsv([
      { ...on("2026-09-02"), note: 'onions, 20kg — "best" rate', branchName: "Both" },
    ]);
    expect(csv.split("\n")[1]).toContain('"onions, 20kg — ""best"" rate"');
  });

  it("marks what has not been paid for yet", () => {
    const csv = toCsv([{ ...on("2026-09-03", { unpaid: true }), note: null, branchName: "NSP" }]);
    expect(csv.split("\n")[1].endsWith(",UNPAID")).toBe(true);
  });
});
