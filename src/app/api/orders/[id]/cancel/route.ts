import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";
import { onOrderCancelled } from "@/lib/order-effects";
import { notifyUser } from "@/lib/notify";

const Body = z.object({ reason: z.string().max(300).optional() });

/** Customers may cancel before the kitchen starts preparing. */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await requireCustomer();
    const body = Body.parse(await req.json().catch(() => ({})));

    const order = await db.order.findFirst({ where: { id, userId: session.uid } });
    if (!order) throw new HttpError(404, "Order not found");
    if (!["PLACED", "ACCEPTED"].includes(order.status))
      throw new HttpError(
        400,
        order.status === "PREPARING"
          ? "The kitchen has already started preparing — call the branch to request cancellation"
          : "This order can no longer be cancelled"
      );

    await db.order.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelReason: body.reason ?? "Cancelled by customer",
        cancelledAt: new Date(),
        paymentStatus: order.paymentStatus === "PAID" ? "REFUNDED" : order.paymentStatus,
      },
    });
    await onOrderCancelled(id, false);
    await notifyUser(
      session.uid,
      "CANCELLED",
      "Order cancelled",
      `Order ${order.orderNumber} was cancelled.${order.pointsRedeemed > 0 ? " Your redeemed points have been returned." : ""}`
    );
    return NextResponse.json({ ok: true });
  }
);
