/**
 * Clears the shop's trading history so the site can open as if for the first
 * time — every customer, order, bill, khata entry, point and OTP — while
 * leaving everything you set up in place: the menu, branches, staff logins,
 * coupons, loyalty tiers and every settings page.
 *
 *   node scripts/reset-data.mjs            # says what it would delete, deletes nothing
 *   node scripts/reset-data.mjs --yes      # actually deletes it
 *   node scripts/reset-data.mjs --yes --keep-audit   # ...but keeps the audit log
 *
 * Run it where the database is: on the server, from ~/public_html.
 *
 * There is no undo. Take a backup first — on cPanel that is
 * "MySQL Databases → phpMyAdmin → Export", or:
 *   mysqldump -u USER -p DBNAME > ~/dilkhush-backup-$(date +%F).sql
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const GO = process.argv.includes("--yes");
const KEEP_AUDIT = process.argv.includes("--keep-audit");

/**
 * Deleted in this order: children before parents, so a row is never left
 * pointing at something that has gone.
 */
const WIPE = [
  ["Order items", () => db.orderItem.deleteMany()],
  ["Payments", () => db.payment.deleteMany()],
  ["Refunds", () => db.refund.deleteMany()],
  ["Reviews", () => db.review.deleteMany()],
  ["Support tickets", () => db.supportTicket.deleteMany()],
  ["Coupon redemptions", () => db.couponRedemption.deleteMany()],
  ["Loyalty transactions", () => db.loyaltyTransaction.deleteMany()],
  ["Khata entries", () => db.khataEntry.deleteMany()],
  ["Orders & bills", () => db.order.deleteMany()],
  ["Cart items", () => db.cartItem.deleteMany()],
  ["Carts", () => db.cart.deleteMany()],
  ["Favourites", () => db.favourite.deleteMany()],
  ["Notifications", () => db.notification.deleteMany()],
  ["Login codes (OTP)", () => db.otpCode.deleteMany()],
  ["Customer points & tiers", () => db.customerProfile.deleteMany()],
  ["Customer totals", () => db.customerMetrics.deleteMany()],
  ["Saved addresses", () => db.address.deleteMany()],
  // Staff, managers and delivery agents keep their logins; only customers go.
  ["Customer accounts", () => db.user.deleteMany({ where: { role: "CUSTOMER" } })],
];

/** What each line above would remove, for the dry run and the summary. */
const COUNTS = [
  ["Order items", () => db.orderItem.count()],
  ["Payments", () => db.payment.count()],
  ["Refunds", () => db.refund.count()],
  ["Reviews", () => db.review.count()],
  ["Support tickets", () => db.supportTicket.count()],
  ["Coupon redemptions", () => db.couponRedemption.count()],
  ["Loyalty transactions", () => db.loyaltyTransaction.count()],
  ["Khata entries", () => db.khataEntry.count()],
  ["Orders & bills", () => db.order.count()],
  ["Cart items", () => db.cartItem.count()],
  ["Carts", () => db.cart.count()],
  ["Favourites", () => db.favourite.count()],
  ["Notifications", () => db.notification.count()],
  ["Login codes (OTP)", () => db.otpCode.count()],
  ["Customer points & tiers", () => db.customerProfile.count()],
  ["Customer totals", () => db.customerMetrics.count()],
  ["Saved addresses", () => db.address.count()],
  ["Customer accounts", () => db.user.count({ where: { role: "CUSTOMER" } })],
  ["Audit log", () => db.auditLog.count()],
];

const KEPT = [
  ["Branches", () => db.branch.count()],
  ["Menu categories", () => db.category.count()],
  ["Dishes", () => db.menuItem.count()],
  ["Portions", () => db.menuItemVariant.count()],
  ["Add-ons", () => db.addOn.count()],
  ["Branch prices & stock", () => db.branchMenuItem.count()],
  ["Coupons", () => db.coupon.count()],
  ["Loyalty tiers", () => db.loyaltyTier.count()],
  ["Staff logins", () => db.user.count({ where: { NOT: { role: "CUSTOMER" } } })],
  ["Delivery agents", () => db.deliveryAgent.count()],
];

const table = async (rows) => {
  for (const [label, count] of rows) console.log(`   ${label.padEnd(26)} ${await count()}`);
};

try {
  console.log(`\nDatabase: ${(process.env.DATABASE_URL ?? "").replace(/:[^:@/]*@/, ":***@")}\n`);
  console.log("WILL BE DELETED");
  await table(KEEP_AUDIT ? COUNTS.filter(([l]) => l !== "Audit log") : COUNTS);
  if (KEEP_AUDIT) console.log("   (audit log kept)");
  console.log("\nWILL BE KEPT");
  await table(KEPT);

  if (!GO) {
    console.log("\nDry run — nothing was deleted. Add --yes to go ahead (back up first).\n");
    process.exit(0);
  }

  console.log("\nDeleting…");
  for (const [label, run] of WIPE) {
    const { count } = await run();
    console.log(`   ${label.padEnd(26)} ${count} removed`);
  }
  if (!KEEP_AUDIT) {
    const { count } = await db.auditLog.deleteMany();
    console.log(`   ${"Audit log".padEnd(26)} ${count} removed`);
  }

  console.log("\nWhat is left");
  await table(KEPT);
  console.log("\nDone. The site is ready to open: the menu, prices, staff and settings are untouched.\n");
} catch (e) {
  console.error("\nFailed — nothing further was deleted:", e?.message ?? e);
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
