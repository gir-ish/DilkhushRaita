import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";
import { STATUS_LABELS } from "@/lib/constants";

/** Order detail + live status (customer polls this). */
export const GET = handler(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await requireCustomer();
    const order = await db.order.findFirst({
      where: { id, userId: session.uid },
      include: {
        items: true,
        branch: { select: { name: true, slug: true, phone: true, address: true } },
        deliveryAgent: { include: { user: { select: { name: true, phone: true } } } },
        refunds: true,
        review: true,
      },
    });
    if (!order) throw new HttpError(404, "Order not found");
    return NextResponse.json({
      order: { ...order, statusLabel: STATUS_LABELS[order.status] ?? order.status },
    });
  }
);
