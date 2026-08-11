/**
 * Staff account maintenance: list, reset passwords, block.
 *
 * The seed ships every staff login with a password printed in the README, so a
 * live install starts with credentials the whole internet can read. This is how
 * you take them back.
 *
 *   node scripts/staff-passwords.mjs --list
 *       Show every staff account. Changes nothing.
 *
 *   node scripts/staff-passwords.mjs --reset-all
 *       Give every non-owner staff account a new random password and print the
 *       list ONCE. Save it before you close the terminal — the passwords are
 *       stored hashed and cannot be read back.
 *
 *   node scripts/staff-passwords.mjs --email kitchen.rohini@dilkhush.test --password 'chosen'
 *       Set one account's password yourself.
 *
 *   node scripts/staff-passwords.mjs --block marketing@dilkhush.test
 *   node scripts/staff-passwords.mjs --unblock marketing@dilkhush.test
 *       Refuse / restore sign-in for an account you are not using. Better than
 *       deleting: their audit history and past orders stay intact.
 *
 * The owner is deliberately left out of --reset-all; use scripts/set-owner.mjs,
 * which also clears the PIN and unpairs devices.
 */
import { createRequire } from "node:module";
import { randomInt } from "node:crypto";
const require = createRequire(import.meta.url);
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const STAFF_ROLES = ["OWNER", "BRANCH_MANAGER", "KITCHEN", "CASHIER", "DELIVERY_MANAGER", "MARKETING"];

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? null : argv[i + 1] ?? true;
};

/** Readable but not guessable: no ambiguous characters to mis-transcribe. */
function newPassword() {
  const words = ["tawa", "dhaba", "raita", "tandoor", "paneer", "masala", "kadhai", "lassi"];
  const sym = "!@#$%&*";
  return (
    words[randomInt(words.length)] +
    "-" +
    words[randomInt(words.length)] +
    "-" +
    String(randomInt(1000, 9999)) +
    sym[randomInt(sym.length)]
  );
}

const db = new PrismaClient();
try {
  const all = await db.user.findMany({
    where: { role: { in: STAFF_ROLES } },
    select: { id: true, email: true, name: true, role: true, blocked: true },
    orderBy: { role: "asc" },
  });

  if (flag("list") || argv.length === 0) {
    console.log("\nStaff accounts:\n");
    for (const u of all)
      console.log(
        `  ${u.blocked ? "🚫" : "  "} ${(u.email ?? "—").padEnd(34)} ${u.role.padEnd(17)} ${u.name ?? ""}`
      );
    console.log(
      argv.length === 0
        ? "\nNothing changed. Pass --reset-all, --email/--password, --block or --unblock.\n"
        : ""
    );
    process.exit(0);
  }

  const block = flag("block");
  const unblock = flag("unblock");
  if (typeof block === "string" || typeof unblock === "string") {
    const email = String(block || unblock).toLowerCase();
    const user = all.find((u) => u.email?.toLowerCase() === email);
    if (!user) { console.error(`No staff account for ${email}`); process.exit(1); }
    await db.user.update({ where: { id: user.id }, data: { blocked: !!block } });
    console.log(`${block ? "Blocked" : "Unblocked"} ${email}`);
    process.exit(0);
  }

  const one = flag("email");
  if (typeof one === "string") {
    const password = flag("password");
    if (typeof password !== "string" || password.length < 8) {
      console.error("Pass --password with at least 8 characters.");
      process.exit(1);
    }
    const user = all.find((u) => u.email?.toLowerCase() === one.toLowerCase());
    if (!user) { console.error(`No staff account for ${one}`); process.exit(1); }
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`Password updated for ${user.email}`);
    process.exit(0);
  }

  if (flag("reset-all")) {
    const targets = all.filter((u) => u.role !== "OWNER");
    if (targets.length === 0) { console.log("No non-owner staff accounts found."); process.exit(0); }

    const issued = [];
    for (const u of targets) {
      const password = newPassword();
      await db.user.update({
        where: { id: u.id },
        data: { passwordHash: await bcrypt.hash(password, 10) },
      });
      issued.push([u.email, u.role, password]);
    }

    console.log("\n  NEW STAFF PASSWORDS — shown once, stored hashed.");
    console.log("  Write these down now, then clear your terminal history.\n");
    for (const [email, role, password] of issued)
      console.log(`  ${String(email).padEnd(34)} ${role.padEnd(17)} ${password}`);
    console.log("\n  The owner account was not touched — use scripts/set-owner.mjs for that.\n");
    process.exit(0);
  }

  console.error("Unknown options. See the comment at the top of this file.");
  process.exit(1);
} finally {
  await db.$disconnect();
}
