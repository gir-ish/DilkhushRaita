import { normalizePhone } from "./utils";

/**
 * Turning an exported phone book into a list worth texting.
 *
 * A contacts export is not a mailing list. It holds landlines, foreign
 * numbers, half-typed numbers, the same person saved three times, shop
 * numbers with no name and rows whose "name" is just the number again. Every
 * one of those costs a credit to discover at send time, so they are found
 * here instead — once, on upload, with a reason attached.
 *
 * Deliberately format-agnostic: a Google Contacts export, a two-column list
 * out of a spreadsheet and a bare column of numbers all arrive at the same
 * place. Where the headers say nothing useful, every cell is tried as a
 * number, which is the only thing that always works.
 */

export interface ParsedContact {
  /** +91XXXXXXXXXX */
  phone: string;
  /** Their name, or "Customer" when the export did not carry one. */
  name: string;
}

export interface ContactImport {
  contacts: ParsedContact[];
  /** Data rows read, excluding the header. */
  rowsRead: number;
  /** Numbers that appeared more than once in this file. */
  duplicates: number;
  rejected: { raw: string; why: string }[];
}

/** What a contact is called when the export did not say. */
export const UNKNOWN_NAME = "Customer";

/* ------------------------------------------------------------------ CSV */

/**
 * RFC 4180, as far as any spreadsheet actually writes it: quoted fields,
 * doubled quotes inside them, and newlines that only end a row when they are
 * not inside quotes.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // A BOM is invisible and would otherwise become part of the first header,
  // so "﻿First Name" never matches "First Name".
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      // \r\n is one break, not two.
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/* -------------------------------------------------------------- columns */

const PHONE_HEADER =
  /^(phone|mobile|mob|cell|contact\s*(no|number)|whatsapp|number|msisdn)\b|phone\s*\d*\s*-\s*value$/i;
const NAME_HEADER = /^(first|middle|last|full|contact|customer|display)?\s*name$|^name$|^file as$/i;

/** Does this row look like column titles rather than the first contact? */
function isHeader(row: string[]): boolean {
  const named = row.filter((c) => PHONE_HEADER.test(c.trim()) || NAME_HEADER.test(c.trim()));
  return named.length > 0 && row.every((c) => normalizePhone(c) === null);
}

/* ----------------------------------------------------------------- name */

/** Digits, spaces and punctuation only — a "name" that is really a number. */
const PHONE_LIKE = /^[\d\s+()\-.]{6,}$/;

/**
 * A usable name, or null.
 *
 * The first word has to carry two letters or more. Phone books are full of
 * entries like "E4 Ka 26" and "H17 272 Master", and greeting somebody as
 * "Hi! E" is worse than not using their name at all.
 */
export function cleanName(parts: (string | undefined)[]): string | null {
  const words = parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p && !PHONE_LIKE.test(p))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return null;
  const firstWord = words.split(" ")[0].replace(/[^A-Za-z]/g, "");
  if (firstWord.length < 2) return null;
  return words.slice(0, 60);
}

/* --------------------------------------------------------------- number */

/** 9999999999, 1234567890 — typed to fill a box, never answered by anyone. */
export function looksFake(phone: string): boolean {
  const ten = phone.replace(/^\+91/, "");
  if (/^(\d)\1{9}$/.test(ten)) return true;
  const ascending = "0123456789012345678";
  const descending = "9876543210987654321";
  return ascending.includes(ten) || descending.includes(ten);
}

/** Google writes several values into one cell separated by " ::: ". */
function splitValues(cell: string): string[] {
  return cell
    .split(/:::|[;/|]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/* --------------------------------------------------------------- import */

export function importContacts(text: string, max = 20_000): ContactImport {
  const rows = parseCsv(text);
  const empty: ContactImport = { contacts: [], rowsRead: 0, duplicates: 0, rejected: [] };
  if (rows.length === 0) return empty;

  const header = isHeader(rows[0]) ? rows[0].map((h) => h.trim()) : null;
  const body = header ? rows.slice(1) : rows;

  const phoneCols: number[] = [];
  const nameCols: number[] = [];
  if (header) {
    header.forEach((h, i) => {
      if (PHONE_HEADER.test(h)) phoneCols.push(i);
      else if (NAME_HEADER.test(h)) nameCols.push(i);
    });
  }

  const byPhone = new Map<string, ParsedContact>();
  const rejected: { raw: string; why: string }[] = [];
  let duplicates = 0;
  let rowsRead = 0;

  for (const row of body) {
    rowsRead++;
    // Named columns when the header gave us some, every cell when it did not:
    // a file that is one bare column of numbers is still a contact list.
    const cells = phoneCols.length > 0 ? phoneCols.map((i) => row[i] ?? "") : row;
    const name = cleanName(nameCols.length > 0 ? nameCols.map((i) => row[i]) : row);

    for (const cell of cells) {
      for (const value of splitValues(cell)) {
        const phone = normalizePhone(value);
        if (!phone) {
          // Only complain about things that were trying to be a number. In a
          // 34-column export, most empty cells are not.
          const digits = value.replace(/\D/g, "");
          if (digits.length >= 6)
            rejected.push({
              raw: value.slice(0, 24),
              why:
                digits.length < 10
                  ? "too short for a mobile number"
                  : digits.length > 12
                    ? "too long — a foreign or mistyped number"
                    : "not an Indian mobile number",
            });
          continue;
        }
        if (looksFake(phone)) {
          rejected.push({ raw: value.slice(0, 24), why: "not a real number" });
          continue;
        }

        const existing = byPhone.get(phone);
        if (existing) {
          duplicates++;
          // Keep the better record: a name beats no name.
          if (existing.name === UNKNOWN_NAME && name) existing.name = name;
          continue;
        }
        if (byPhone.size >= max) {
          rejected.push({ raw: value.slice(0, 24), why: `over the ${max} limit for one upload` });
          continue;
        }
        byPhone.set(phone, { phone, name: name ?? UNKNOWN_NAME });
      }
    }
  }

  return { contacts: [...byPhone.values()], rowsRead, duplicates, rejected };
}
