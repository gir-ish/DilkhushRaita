import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, HttpError, requireStaff } from "@/lib/guard";
import { POINT_VALUE_RUPEES, REJECTION_REASONS, nextStatusesFor } from "@/lib/constants";
import { onOrderCancelled, onOrderDelivered } from "@/lib/order-effects";
import { notifyUser } from "@/lib/notify";
import { audit } from "@/lib/audit";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), prepTimeMins: z.number().int().min(5).max(120).optional() }),
  z.object({ action: z.literal("reject"), reason: z.enum(REJECTION_REASONS) }),
  z.object({ action: z.literal("status"), status: z.string() }),
  z.object({ action: z.literal("assign"), agentId: z.string() }),
  z.object({ action: z.literal("note"), note: z.string().max(1000) }),
  z.object({
    action: z.literal("refund"),
    amount: z.number().min(1),
    mode: z.enum(["CASH", "STORE_CREDIT", "LOYALTY_POINTS", "COUPON", "REPLACEMENT"]),
    reason: z.string().min(3).max(300),
  }),
]);

const CUSTOMER_MESSAGES: Record<string, [string, string]> = {
  ACCEPTED: ["Order accepted 👨‍🍳", "The kitchen has confirmed your order."],
  PREPARING: ["Being prepared 🍳", "Your food is being freshly prepared."],
  READY: ["Ready! 🛍️", "Your order is packed and ready."],
  OUT_FOR_DELIVERY: ["Out for delivery 🛵", "Your order is on the way."],
};

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await requireStaff(
      "BRANCH_MANAGER",
      "KITCHEN",
      "CASHIER",
      "DELIVERY_MANAGER"
    );
    const body = Body.parse(await req.json());

    const order = await db.order.findUnique({ where: { id } });
    if (!order) throw new HttpError(404, "Order not found");
    const scope = await allowedBranchIds(session);
    if (scope && !scope.includes(order.branchId))
      throw new HttpError(403, "This order belongs to a different branch");

    const actor = { uid: session.uid, name: session.name };

    switch (body.action) {
      case "accept": {
        if (session.role === "KITCHEN") throw new HttpError(403, "Kitchen staff cannot accept orders");
        if (order.status !== "PLACED") throw new HttpError(400, "Order is not awaiting acceptance");
        const prep = body.prepTimeMins ?? order.prepTimeMins;
        await db.order.update({
          where: { id },
          data: { status: "ACCEPTED", acceptedAt: new Date(), prepTimeMins: prep },
        });
        await notifyUser(order.userId, "ORDER_ACCEPTED", ...CUSTOMER_MESSAGES.ACCEPTED);
        await audit(actor, "ORDER_ACCEPTED", "Order", id, { prep });
        break;
      }
      case "reject": {
        if (session.role === "KITCHEN") throw new HttpError(403, "Kitchen staff cannot reject orders");
        if (order.status !== "PLACED") throw new HttpError(400, "Only new orders can be rejected");
        await db.order.update({
          where: { id },
          data: {
            status: "REJECTED",
            rejectionReason: body.reason,
            cancelledAt: new Date(),
            paymentStatus: order.paymentStatus === "PAID" ? "REFUNDED" : order.paymentStatus,
          },
        });
        await onOrderCancelled(id, true);
        await notifyUser(
          order.userId,
          "ORDER_REJECTED",
          "Order could not be accepted 😔",
          `Order ${order.orderNumber} was declined: ${body.reason}.${order.paymentStatus === "PAID" ? " A refund has been initiated." : ""}${order.pointsRedeemed > 0 ? " Redeemed points were returned." : ""}`
        );
        await audit(actor, "ORDER_REJECTED", "Order", id, { reason: body.reason });
        break;
      }
      case "status": {
        // Type-aware: a dine-in or pickup order must not be pushed onto the
        // delivery track, whatever the client sends.
        const allowed = nextStatusesFor(order.status, order.type);
        if (!allowed.includes(body.status as never))
          throw new HttpError(400, `Cannot move from ${order.status} to ${body.status}`);
        if (session.role === "KITCHEN" && !["PREPARING", "READY"].includes(body.status))
          throw new HttpError(403, "Kitchen staff can only mark Preparing / Ready");
        const stamps: Record<string, object> = {
          PREPARING: {},
          READY: { readyAt: new Date() },
          OUT_FOR_DELIVERY: { outAt: new Date() },
          DELIVERED: { deliveredAt: new Date() },
          CANCELLED: { cancelledAt: new Date() },
          REFUNDED: {},
          REFUND_INITIATED: {},
        };
        await db.order.update({
          where: { id },
          data: { status: body.status, ...(stamps[body.status] ?? {}) },
        });
        if (body.status === "DELIVERED") await onOrderDelivered(id);
        if (body.status === "CANCELLED") await onOrderCancelled(id, false);
        const msg = CUSTOMER_MESSAGES[body.status];
        if (msg) await notifyUser(order.userId, body.status, ...msg);
        await audit(actor, `ORDER_${body.status}`, "Order", id);
        break;
      }
      case "assign": {
        if (!["OWNER", "BRANCH_MANAGER", "DELIVERY_MANAGER", "CASHIER"].includes(session.role))
          throw new HttpError(403, "Not allowed");
        if (order.type !== "DELIVERY")
          throw new HttpError(400, "Only delivery orders need a delivery agent");
        if (!["READY", "ACCEPTED", "PREPARING"].includes(order.status))
          throw new HttpError(400, "Assign an agent once the order is being prepared or ready");
        const agent = await db.deliveryAgent.findUnique({ where: { id: body.agentId } });
        if (!agent) throw new HttpError(404, "Delivery agent not found");
        await db.order.update({
          where: { id },
          data: {
            deliveryAgentId: body.agentId,
            ...(order.status === "READY" ? { status: "ASSIGNED" } : {}),
          },
        });
        await audit(actor, "ORDER_AGENT_ASSIGNED", "Order", id, { agentId: body.agentId });
        break;
      }
      case "note": {
        await db.order.update({ where: { id }, data: { staffNotes: body.note } });
        break;
      }
      case "refund": {
        if (!["OWNER", "BRANCH_MANAGER", "CASHIER"].includes(session.role))
          throw new HttpError(403, "Not allowed");
        if (body.amount > order.total) throw new HttpError(400, "Refund exceeds order total");
        await db.$transaction(async (tx) => {
          await tx.refund.create({
            data: {
              orderId: id,
              amount: body.amount,
              mode: body.mode,
              reason: body.reason,
              status: body.mode === "CASH" ? "INITIATED" : "COMPLETED",
              createdBy: session.uid,
            },
          });
          if (body.mode === "STORE_CREDIT")
            await tx.customerProfile.update({
              where: { userId: order.userId },
              data: { storeCredit: { increment: body.amount } },
            });
          if (body.mode === "LOYALTY_POINTS") {
            // Derived from the point's rupee value, not a literal: refunding
            // ₹100 as points must hand back ₹100 of points whatever a point is
            // currently worth.
            const pts = Math.round(body.amount / POINT_VALUE_RUPEES);
            await tx.customerProfile.update({
              where: { userId: order.userId },
              data: { loyaltyPoints: { increment: pts } },
            });
            await tx.loyaltyTransaction.create({
              data: { userId: order.userId, orderId: id, points: pts, type: "ADJUST", note: body.reason },
            });
          }
        });
        await notifyUser(
          order.userId,
          "REFUND",
          "Refund update 💰",
          `A refund of ₹${body.amount} (${body.mode.replace("_", " ").toLowerCase()}) was issued for order ${order.orderNumber}.`
        );
        await audit(actor, "REFUND_ISSUED", "Order", id, body);
        break;
      }
    }

    const updated = await db.order.findUnique({
      where: { id },
      include: {
        items: true,
        user: { select: { name: true, phone: true } },
        refunds: true,
      },
    });
    return NextResponse.json({ ok: true, order: updated });
  }
);
