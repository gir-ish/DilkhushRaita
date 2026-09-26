import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { cleanName, importContacts, looksFake, UNKNOWN_NAME } from "@/lib/contacts-csv";
import { normalizePhone } from "@/lib/utils";

/**
 * The contact book: numbers from uploaded phone-book exports, kept so a
 * campaign can reach people who have not ordered on the website yet.
 *
 * Every number is checked once, here, rather than at send time. A landline, a
 * foreign number or a half-typed one costs a credit to discover if it reaches
 * the gateway, and the gateway reports success either way — so the list that
 * gets sent to is the list that survived this.
 */

/** One upload cannot be bigger than this, whatever the file says. */
const MAX_PER_UPLOAD = 20_000;
/** …and the file itself has to be something a phone book could plausibly be. */
const MAX_BYTES = 8 * 1024 * 1024;
/** Kept per upload for the history — enough to see the shape of what failed. */
const REJECT_SAMPLE = 100;

export const GET = handler(async (req: Request) => {
  await requireStaff("MARKETING");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  const listId = url.searchParams.get("listId");
  const take = Math.min(Number(url.searchParams.get("take") ?? 100) || 100, 500);
  const skip = Math.max(Number(url.searchParams.get("skip") ?? 0) || 0, 0);

  const digits = q.replace(/\D/g, "");
  const where = {
    ...(listId ? { listId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q } },
            ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
          ],
        }
      : {}),
  };

  const [contacts, total, sendable, optedOut, lists] = await Promise.all([
    db.contact.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      skip,
      select: {
        id: true,
        phone: true,
        name: true,
        optedOut: true,
        createdAt: true,
        lastSentAt: true,
        list: { select: { id: true, filename: true } },
      },
    }),
    db.contact.count({ where }),
    db.contact.count({ where: { optedOut: false } }),
    db.contact.count({ where: { optedOut: true } }),
    db.contactList.findMany({ orderBy: { uploadedAt: "desc" }, take: 25 }),
  ]);

  return NextResponse.json({
    contacts,
    total,
    totals: { all: sendable + optedOut, sendable, optedOut },
    lists: lists.map((l) => ({
      ...l,
      rejectedSample: safeJson(l.rejectedJson),
      rejectedJson: undefined,
    })),
  });
});

function safeJson(raw: string): { raw: string; why: string }[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export const POST = handler(async (req: Request) => {
  const s = await requireStaff("MARKETING");

  /*
   * One number, typed in by hand — a customer who gives it over the counter,
   * or one missed by an export. The same check a file gets, and the same
   * refusal to hold the same number twice: the book is only worth trusting if
   * nothing can get in unchecked.
   */
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await req.json().catch(() => null);
    const phone = normalizePhone(String(body?.phone ?? ""));
    if (!phone)
      throw new HttpError(400, "That is not an Indian mobile number \u2014 ten digits starting 6 to 9.");
    if (looksFake(phone)) throw new HttpError(400, "That number is not a real one.");

    const already = await db.contact.findUnique({ where: { phone } });
    if (already)
      throw new HttpError(
        409,
        `${phone} is already in the contact book${already.name ? ` as ${already.name}` : ""}.`
      );

    const name = cleanName([String(body?.name ?? "")]) ?? UNKNOWN_NAME;
    const saved = await db.contact.create({ data: { phone, name } });
    await audit({ uid: s.uid, name: s.name }, "CONTACT_ADDED", "Contact", saved.id, { phone, name });
    return NextResponse.json({ ok: true, contact: { id: saved.id, phone, name } });
  }

  const form = await req.formData().catch(() => null);
  if (!form) throw new HttpError(400, "Send the CSV as a file upload.");
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a CSV file to upload.");
  if (file.size === 0) throw new HttpError(400, "That file is empty.");
  if (file.size > MAX_BYTES)
    throw new HttpError(413, `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 8MB.`);

  const text = await file.text();
  const parsed = importContacts(text, MAX_PER_UPLOAD);
  if (parsed.contacts.length === 0)
    throw new HttpError(
      400,
      parsed.rowsRead === 0
        ? "Nothing could be read from that file. Is it a CSV?"
        : `No valid Indian mobile numbers in ${parsed.rowsRead} rows.`
    );

  // What we already hold, so the upload can report what is genuinely new.
  const existing = await db.contact.findMany({
    where: { phone: { in: parsed.contacts.map((c) => c.phone) } },
    select: { id: true, phone: true, name: true },
  });
  const known = new Map(existing.map((c) => [c.phone, c]));

  const list = await db.contactList.create({
    data: {
      filename: file.name.slice(0, 120) || "contacts.csv",
      uploadedBy: s.name ?? null,
      rowsRead: parsed.rowsRead,
      rejected: parsed.rejected.length,
      duplicates: parsed.duplicates,
      rejectedJson: JSON.stringify(parsed.rejected.slice(0, REJECT_SAMPLE)),
    },
  });

  let added = 0;
  let updated = 0;
  const fresh: { phone: string; name: string; listId: string }[] = [];

  for (const c of parsed.contacts) {
    const had = known.get(c.phone);
    if (!had) {
      fresh.push({ phone: c.phone, name: c.name, listId: list.id });
      added++;
      continue;
    }
    // A number we already hold keeps its place and its history. The only
    // thing an upload may improve is a name we never had.
    const better = c.name !== UNKNOWN_NAME && (!had.name || had.name === UNKNOWN_NAME);
    if (better) {
      await db.contact.update({ where: { id: had.id }, data: { name: c.name } });
      updated++;
    }
  }

  // createMany in chunks: one statement per 500 rather than one per contact,
  // which for a three-thousand-line phone book is the difference between a
  // second and a minute.
  for (let i = 0; i < fresh.length; i += 500)
    await db.contact.createMany({ data: fresh.slice(i, i + 500) });

  await db.contactList.update({ where: { id: list.id }, data: { added, updated } });

  await audit({ uid: s.uid, name: s.name }, "CONTACTS_UPLOADED", "ContactList", list.id, {
    filename: list.filename,
    rowsRead: parsed.rowsRead,
    added,
    updated,
    duplicates: parsed.duplicates,
    rejected: parsed.rejected.length,
  });

  return NextResponse.json({
    ok: true,
    listId: list.id,
    filename: list.filename,
    rowsRead: parsed.rowsRead,
    valid: parsed.contacts.length,
    added,
    updated,
    alreadyHad: parsed.contacts.length - added,
    duplicates: parsed.duplicates,
    rejected: parsed.rejected.length,
    rejectedSample: parsed.rejected.slice(0, 20),
    nameless: parsed.contacts.filter((c) => c.name === UNKNOWN_NAME).length,
  });
});
