import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { buildQuote } from "@/lib/quote";
import { computeTotals } from "@/lib/pricing";
import { TAB_CLOSED_STATUSES } from "@/lib/constants";
import type { SessionPayload } from "@/lib/session";
import { onOrderDelivered } from "@/lib/order-effects";
import { KHATA_METHODS, ON_KHATA, chargeToKhata } from "@/lib/khata";
import { COUNTER_LIMITS } from "@/lib/order-limits";

/** Loads an open tab and checks the caller is allowed to touch it. */
async function loadOpenTab(id: string, session: SessionPayload) {
  const order = await db.order.findUnique({ where: { id }, include: { items: true, branch: true } });
  if (!order) throw new HttpError(404, "Tab not found");
  if (order.type !== "DINE_IN") throw new HttpError(400, "That order is not a dine-in tab");
  if (order.paymentStatus === "PAID") throw new HttpError(409, "That tab is already settled");
  // Billed to khata: the tab is closed, what is owed now lives on the khata.
  if (order.paymentStatus !== "PENDING") throw new HttpError(409, "That tab is already billed");
  // DELIVERED is intentionally not a blocker: served but unpaid is still open.
  if (TAB_CLOSED_STATUSES.includes(order.status as never))
    throw new HttpError(409, `That tab is already ${order.status.toLowerCase()}`);

  const scope = await allowedBranchIds(session);
  if (scope && !scope.includes(order.branchId))
    throw new HttpError(403, "That tab belongs to a different branch");
  return order;
}

const AddBody = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string(),
        variantId: z.string().nullish(),
        addOnIds: z.array(z.string()).max(10).optional(),
        qty: z.number().int().min(1).max(999),
        instructions: z.string().max(300).nullish(),
      })
    )
    .min(1)
    .max(200),
});

/**
 * Adds another round to an open dine-in tab.
 *
 * Existing lines keep their original snapshot prices — a menu price change
 * halfway through a meal must not silently re-price what the customer already
 * ate. Only the new round is quoted at today's prices, then the bill is
 * recomputed over everything so tax and packaging stay correct (packaging is
 * charged once, not per round).
 */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("BRANCH_MANAGER", "CASHIER");
    const body = AddBody.parse(await req.json());
    const order = await loadOpenTab(id, s);

    const quote = await buildQuote(
      { branchId: order.branchId, orderType: "DINE_IN", items: body.items, autoOffers: false },
      order.userId,
      false,
      COUNTER_LIMITS
    );

    const nextRound = Math.max(...order.items.map((i) => i.round), 0) + 1;

    const updated = await db.$transaction(async (tx) => {
      for (const line of quote.lines) {
        const res = await tx.branchMenuItem.updateMany({
          where: {
            branchId: order.branchId,
            menuItemId: line.menuItemId,
            stockQty: { gte: line.qty },
          },
          data: { stockQty: { decrement: line.qty } },
        });
        if (res.count === 0) {
          const bi = await tx.branchMenuItem.findUnique({
            where: { branchId_menuItemId: { branchId: order.branchId, menuItemId: line.menuItemId } },
          });
          if (bi && bi.stockQty !== -1)
            throw new HttpError(409, `${line.name} is out of stock`);
        }
      }

      await tx.orderItem.createMany({
        data: quote.lines.map((l) => ({
          orderId: order.id,
          menuItemId: l.menuItemId,
          nameSnapshot: l.name,
          variantName: l.variantName,
          addOnsJson: JSON.stringify(l.addOns.map((a) => ({ name: a.name, price: a.price }))),
          unitPrice: l.unitPrice,
          qty: l.qty,
          lineTotal: l.lineTotal,
          instructions: l.instructions,
          round: nextRound,
        })),
      });

      const allItems = await tx.orderItem.findMany({ where: { orderId: order.id } });
      const totals = computeTotals({
        lines: allItems.map((i) => ({ unitPrice: i.unitPrice, qty: i.qty })),
        cfg: order.branch,
        orderType: "DINE_IN",
        distanceKm: null,
        discount: order.discount,
      });

      return tx.order.update({
        where: { id: order.id },
        data: {
          subtotal: totals.subtotal,
          packagingFee: totals.packagingFee,
          tax: totals.tax,
          total: totals.total,
          // The table has ordered again, so there is food to cook — put it back
          // in front of the kitchen even if the previous round was marked READY.
          ...(["READY", "DELIVERED"].includes(order.status)
            ? { status: "ACCEPTED", readyAt: null, deliveredAt: null }
            : {}),
        },
      });
    });

    await db.payment.updateMany({
      where: { orderId: order.id },
      data: { amount: updated.total },
    });

    await audit({ uid: s.uid, name: s.name }, "TAB_ROUND_ADDED", "Order", order.id, {
      round: nextRound,
      newTotal: updated.total,
    });

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      round: nextRound,
      total: updated.total,
      warnings: quote.warnings,
    });
  }
);

const SettleBody = z.object({
  // KHATA: the customer leaves without paying in full; the bill goes on their khata.
  paymentMethod: z.enum(["CASH", "ONLINE", "KHATA"]).default("CASH"),
  paidNow: z.number().min(0).max(10_000_000).optional(),
  paidNowMethod: z.enum(KHATA_METHODS).optional(),
  // A discount given while billing the table.
  discount: z
    .object({
      type: z.enum(["FLAT", "PERCENT"]),
      value: z.number().min(0).max(100000),
      reason: z.string().max(120).nullish(),
    })
    .nullish(),
});

/** Settles the tab — the customer is leaving, and has paid or put it on khata. */
export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("BRANCH_MANAGER", "CASHIER");
    const body = SettleBody.parse(await req.json());
    const order = await loadOpenTab(id, s);

    if (order.items.length === 0) throw new HttpError(400, "This tab has no items");
    const khata = body.paymentMethod === "KHATA";
    const status = khata ? ON_KHATA : "PAID";

    /*
     * A discount given at the table, applied to the bill as it stands.
     *
     * Worked out from the items rather than the running total, so it cannot
     * compound with a discount already on the tab, and never more than the
     * food itself.
     */
    let total = order.total;
    let totals: ReturnType<typeof computeTotals> | null = null;
    if (body.discount && body.discount.value > 0) {
      const subtotal = order.items.reduce((n, i) => n + i.lineTotal, 0);
      const raw =
        body.discount.type === "PERCENT" ? (subtotal * Math.min(body.discount.value, 100)) / 100 : body.discount.value;
      const amount = Math.round(Math.min(raw, subtotal) * 100) / 100;
      totals = computeTotals({
        lines: order.items.map((i) => ({ unitPrice: i.unitPrice, qty: i.qty })),
        cfg: order.branch,
        orderType: "DINE_IN",
        distanceKm: null,
        discount: amount,
      });
      total = totals.total;
    }

    await db.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: order.id },
        data: {
          paymentStatus: status,
          paymentMethod: khata ? "KHATA" : body.paymentMethod === "CASH" ? "COD" : "ONLINE",
          // Billing is the end of the meal: the food has been served.
          status: "DELIVERED",
          deliveredAt: new Date(),
          ...(totals
            ? { discount: totals.discount, subtotal: totals.subtotal, tax: totals.tax, total: totals.total }
            : {}),
        },
      });
      await tx.payment.updateMany({
        where: { orderId: order.id },
        data: {
          status,
          method: khata ? "KHATA" : body.paymentMethod === "CASH" ? "CASH" : "ONLINE",
          amount: total,
        },
      });
      if (khata)
        await chargeToKhata(tx, {
          userId: order.userId,
          orderId: order.id,
          branchId: order.branchId,
          amount: total,
          paidNow: body.paidNow,
          paidNowMethod: body.paidNowMethod,
          staff: { uid: s.uid, name: s.name },
        });
    });

    // Same side effects as any delivered order: loyalty points, customer metrics.
    await onOrderDelivered(order.id);

    await audit({ uid: s.uid, name: s.name }, khata ? "TAB_TO_KHATA" : "TAB_SETTLED", "Order", order.id, {
      total,
      paymentMethod: body.paymentMethod,
      ...(khata ? { paidNow: body.paidNow ?? 0 } : {}),
      ...(totals ? { discount: totals.discount, wasTotal: order.total, reason: body.discount?.reason ?? null } : {}),
    });

    return NextResponse.json({ ok: true, orderNumber: order.orderNumber, total, discount: totals?.discount ?? 0 });
  }
);
