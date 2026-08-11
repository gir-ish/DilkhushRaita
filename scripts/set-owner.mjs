/**
 * Sets the OWNER account's email and password.
 *
 *   OWNER_EMAIL=you@example.com OWNER_PASSWORD='...' node scripts/set-owner.mjs
 *
 * Credentials come from the environment, never from a file in the repo, and
 * are never printed. Run it on whichever machine holds the database you mean
 * to change — the live one is the server, not your laptop.
 *
 * Existing owner? Its email and password are updated in place, so orders,
 * audit history and paired devices stay attached to the same account. Any PIN
 * is cleared and every paired device dropped: changing the password is exactly
 * when you want old tills to stop unlocking.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const email = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
const password = process.env.OWNER_PASSWORD ?? "";
const name = process.env.OWNER_NAME ?? "Owner";

if (!email || !password) {
  console.error("Set OWNER_EMAIL and OWNER_PASSWORD.\n" +
    "  OWNER_EMAIL=you@example.com OWNER_PASSWORD='secret' node scripts/set-owner.mjs");
  process.exit(1);
}
if (password.length < 8) {
  console.error("Refusing: password must be at least 8 characters.");
  process.exit(1);
}

const db = new PrismaClient();
try {
  const hash = await bcrypt.hash(password, 10);
  const existing = await db.user.findFirst({ where: { role: "OWNER" } });
  const clash = await db.user.findUnique({ where: { email } });

  if (clash && (!existing || clash.id !== existing.id)) {
    console.error(`Refusing: ${email} already belongs to a ${clash.role} account.`);
    process.exit(1);
  }

  if (existing) {
    await db.user.update({
      where: { id: existing.id },
      data: { email, name, passwordHash: hash, pinHash: null },
    });
    await db.staffDevice.deleteMany({ where: { userId: existing.id } });
    console.log(`Updated owner ${existing.id} → ${email}`);
    console.log("PIN cleared and all paired devices removed. Set a new PIN after signing in.");
  } else {
    const created = await db.user.create({
      data: { email, name, role: "OWNER", passwordHash: hash },
    });
    console.log(`Created owner ${created.id} → ${email}`);
  }
} finally {
  await db.$disconnect();
}
