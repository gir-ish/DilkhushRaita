import { db } from "./db";
import { pointsEarned, tierFor } from "./loyalty";
import { loyaltyRates } from "./loyalty-settings";
import { notifyUser } from "./notify";
import { round2 } from "./utils";

/** Applied when an order reaches DELIVERED: metrics, points, tier. */
export async function onOrderDelivered(orderId: string) {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return;

  const tiers = await db.loyaltyTier.findMany();
  const profile = await db.customerProfile.findUnique({ where: { userId: order.userId } });
  const metrics = await db.customerMetrics.upsert({
    where: { userId: order.userId },
    create: { userId: order.userId },
    update: {},
  });

  const completed = metrics.completedOrders + 1;
  const spend = round2(metrics.lifetimeSpend + order.total);
  const currentTier = tierFor(tiers, { completedOrders: completed, lifetimeSpend: spend });
  const earned = pointsEarned(
    order.subtotal,
    currentTier?.pointMultiplier ?? 1,
    await loyaltyRates()
  );

  await db.$transaction([
    db.customerMetrics.update({
      where: { userId: order.userId },
      data: {
        completedOrders: completed,
        lifetimeSpend: spend,
        avgOrderValue: round2(spend / completed),
        lastOrderAt: new Date(),
        firstOrderAt: metrics.firstOrderAt ?? new Date(),
        preferredBranchId: order.branchId,
      },
    }),
    db.customerProfile.update({
      where: { userId: order.userId },
      data: {
        loyaltyPoints: { increment: earned },
        loyaltyTierId: currentTier?.id ?? profile?.loyaltyTierId ?? null,
      },
    }),
    db.loyaltyTransaction.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        points: earned,
        type: "EARN",
        note: `Earned on order ${order.orderNumber}`,
      },
    }),
    db.order.update({ where: { id: order.id }, data: { pointsEarned: earned } }),
    // Delivering a COD order means the agent took the cash, so it settles
    // itself. A dine-in tab is also "COD", but serving the food is NOT payment
    // — the customer pays at the till afterwards. Auto-settling it here would
    // record money that was never collected and drop the tab off the counter
    // before anyone could bill it.
    ...(order.paymentMethod === "COD" && order.type !== "DINE_IN"
      ? [
          db.payment.update({
            where: { orderId: order.id },
            data: { status: "PAID" },
          }),
          db.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } }),
        ]
      : []),
  ]);

  await notifyUser(
    order.userId,
    "DELIVERED",
    "Order delivered 🎉",
    `Order ${order.orderNumber} was delivered. You earned ${earned} DilKhush points!`
  );
}

/** Applied on REJECTED / CANCELLED: return redeemed points, count cancellation. */
export async function onOrderCancelled(orderId: string, rejected: boolean) {
  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) return;

  const ops = [];
  if (order.pointsRedeemed > 0) {
    ops.push(
      db.customerProfile.update({
        where: { userId: order.userId },
        data: { loyaltyPoints: { increment: order.pointsRedeemed } },
      }),
      db.loyaltyTransaction.create({
        data: {
          userId: order.userId,
          orderId: order.id,
          points: order.pointsRedeemed,
          type: "ADJUST",
          note: `Points returned for ${order.orderNumber}`,
        },
      })
    );
  }
  ops.push(
    db.customerMetrics.upsert({
      where: { userId: order.userId },
      create: {
        userId: order.userId,
        cancelledOrders: rejected ? 0 : 1,
        rejectedOrders: rejected ? 1 : 0,
      },
      update: rejected
        ? { rejectedOrders: { increment: 1 } }
        : { cancelledOrders: { increment: 1 } },
    })
  );
  // Restore tracked stock.
  const items = await db.orderItem.findMany({ where: { orderId } });
  for (const it of items) {
    if (!it.menuItemId) continue;
    ops.push(
      db.branchMenuItem.updateMany({
        where: { branchId: order.branchId, menuItemId: it.menuItemId, stockQty: { gte: 0 } },
        data: { stockQty: { increment: it.qty } },
      })
    );
  }
  await db.$transaction(ops);
}
