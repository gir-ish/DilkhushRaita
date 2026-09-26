import { describe, expect, it } from "vitest";
import { cleanName, importContacts, looksFake, parseCsv, UNKNOWN_NAME } from "@/lib/contacts-csv";

describe("parseCsv", () => {
  it("reads quoted fields, doubled quotes and embedded newlines", () => {
    const rows = parseCsv('a,"b,c","say ""hi"""\n1,"two\nlines",3\r\nx,y,z');
    expect(rows).toEqual([
      ["a", "b,c", 'say "hi"'],
      ["1", "two\nlines", "3"],
      ["x", "y", "z"],
    ]);
  });

  it("drops a leading BOM so the first header still matches", () => {
    expect(parseCsv("﻿First Name,Phone\nAsha,9876543210")[0][0]).toBe("First Name");
  });

  it("ignores blank lines", () => {
    expect(parseCsv("a\n\n\nb")).toEqual([["a"], ["b"]]);
  });
});

describe("cleanName", () => {
  it("joins the parts it is given", () => {
    expect(cleanName(["Asha", "", "Verma"])).toBe("Asha Verma");
  });

  it("drops a part that is really a phone number", () => {
    expect(cleanName(["+91 72065 11023", "", "Naveen Korea"])).toBe("Naveen Korea");
  });

  it("refuses a first word with fewer than two letters", () => {
    // A phone book full of "E4 Ka 26" and "413 Piller Number" would otherwise
    // send "Hi! E" and "Hi! Piller".
    expect(cleanName(["E4 Ka 26"])).toBeNull();
    expect(cleanName(["413 Piller Number"])).toBeNull();
    expect(cleanName(["5 Roti"])).toBeNull();
  });

  it("keeps a real name that happens to contain digits later", () => {
    expect(cleanName(["Prithvi Raj1"])).toBe("Prithvi Raj1");
  });

  it("is null for nothing at all", () => {
    expect(cleanName(["", undefined, "  "])).toBeNull();
  });
});

describe("looksFake", () => {
  it("rejects a number typed to fill a box", () => {
    expect(looksFake("+919999999999")).toBe(true);
    expect(looksFake("+916666666666")).toBe(true);
    expect(looksFake("+919876543210")).toBe(true);
  });

  it("accepts an ordinary number", () => {
    expect(looksFake("+919253171637")).toBe(false);
    expect(looksFake("+917206511023")).toBe(false);
  });
});

describe("importContacts", () => {
  it("reads a Google Contacts export", () => {
    const csv = [
      "First Name,Middle Name,Last Name,Labels,Phone 1 - Label,Phone 1 - Value",
      "+91 72065 11023,,Naveen Korea,* myContacts,Other,+91 72065 11023",
      ",,,* myContacts,Mobile,+91 83760 00047",
    ].join("\n");
    const r = importContacts(csv);
    expect(r.rowsRead).toBe(2);
    expect(r.contacts).toEqual([
      { phone: "+917206511023", name: "Naveen Korea" },
      { phone: "+918376000047", name: UNKNOWN_NAME },
    ]);
  });

  it("reads a plain two-column list", () => {
    const r = importContacts("Name,Mobile\nAsha,9876543211\nRavi,09812345678");
    expect(r.contacts).toEqual([
      { phone: "+919876543211", name: "Asha" },
      { phone: "+919812345678", name: "Ravi" },
    ]);
  });

  it("reads a bare column of numbers, with no header at all", () => {
    const r = importContacts("9812345678\n9823456789");
    expect(r.contacts.map((c) => c.phone)).toEqual(["+919812345678", "+919823456789"]);
    expect(r.contacts.every((c) => c.name === UNKNOWN_NAME)).toBe(true);
  });

  it("keeps one of each number, and the better name", () => {
    const r = importContacts(
      ["Name,Phone", ",9812345678", "Asha,9812345678", "Asha,+919812345678"].join("\n")
    );
    expect(r.contacts).toEqual([{ phone: "+919812345678", name: "Asha" }]);
    expect(r.duplicates).toBe(2);
  });

  it("leaves out what cannot be texted, and says why", () => {
    const r = importContacts(
      [
        "Name,Phone",
        "Landline,01146057477",
        "Toll free,1800 117 800",
        "Abroad,+442086387868",
        "Short,931589365",
        "Fake,9999999999",
        "Good,9812345678",
      ].join("\n")
    );
    expect(r.contacts).toEqual([{ phone: "+919812345678", name: "Good" }]);
    expect(r.rejected).toHaveLength(5);
    expect(r.rejected.find((x) => x.raw === "9999999999")?.why).toBe("not a real number");
    expect(r.rejected.find((x) => x.raw === "931589365")?.why).toBe("too short for a mobile number");
  });

  it("does not complain about empty cells in a wide export", () => {
    const r = importContacts("First Name,Notes,Phone 1 - Value\nAsha,,9812345678");
    expect(r.rejected).toHaveLength(0);
  });

  it("splits several numbers held in one cell", () => {
    const r = importContacts("Name,Phone\nAsha,+919812345678 ::: +919823456789");
    expect(r.contacts.map((c) => c.phone)).toEqual(["+919812345678", "+919823456789"]);
    expect(r.contacts.every((c) => c.name === "Asha")).toBe(true);
  });

  it("stops at the limit rather than reading a whole database", () => {
    const rows = ["Name,Phone"];
    for (let i = 0; i < 20; i++) rows.push(`P${i},98123456${String(i).padStart(2, "0")}`);
    const r = importContacts(rows.join("\n"), 5);
    expect(r.contacts).toHaveLength(5);
    expect(r.rejected.filter((x) => x.why.includes("limit"))).toHaveLength(15);
  });

  it("is empty for an empty file", () => {
    expect(importContacts("").contacts).toEqual([]);
  });
});
