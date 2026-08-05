import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";
import { buildQuote } from "@/lib/quote";
import { genOrderNumber } from "@/lib/utils";
import { rateLimit } from "@/lib/rate-limit";
import { notifyUser } from "@/lib/notify";
import { createGatewayOrder, onlinePaymentsEnabled, paymentProvider } from "@/lib/payments";

const Body = z.object({
  branchId: z.string(),
  orderType: z.enum(["DELIVERY", "PICKUP"]),
  items: z
    .array(
      z.object({
        menuItemId: z.string(),
        variantId: z.string().nullish(),
        addOnIds: z.array(z.string()).max(10).optional(),
        qty: z.number().int().min(1).max(20),
        instructions: z.string().max(300).nullish(),
      })
    )
    .min(1)
    .max(50),
  addressId: z.string().nullish(),
  couponCode: z.string().max(30).nullish(),
  redeemPoints: z.boolean().optional(),
  paymentMethod: z.enum(["COD", "ONLINE"]).default("COD"),
  scheduledFor: z.string().nullish(),
  instructions: z.string().max(500).nullish(),
  cutlery: z.boolean().default(true),
  contactless: z.boolean().default(false),
});

/** Place an order. All prices, coupons and fees are recomputed server-side. */
export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  if (!rateLimit(`order:${session.uid}`, 5, 10 * 60 * 1000))
    throw new HttpError(429, "Too many orders placed. Please wait a few minutes.");

  const body = Body.parse(await req.json());

  if (body.paymentMethod === "ONLINE" && !onlinePaymentsEnabled())
    throw new HttpError(400, "Online payment is not enabled yet — please use Cash on Delivery");

  const user = await db.user.findUnique({
    where: { id: session.uid },
    include: { profile: true },
  });
  if (!user) throw new HttpError(401, "Please sign in again");
  if (body.paymentMethod === "COD" && user.codOnlyBlock)
    throw new HttpError(403, "Cash on Delivery is unavailable for this account. Please contact the restaurant.");

  const quote = await buildQuote(body, session.uid, true);

  const orderNumber = genOrderNumber();

  // Open the gateway order BEFORE the transaction: if Razorpay is unreachable
  // we abort having written nothing, rather than leaving an unpayable order
  // behind with stock already decremented and loyalty points already spent.
  // An unpaid Razorpay order simply expires on their side, so this is safe.
  let gatewayOrder = null;
  if (body.paymentMethod === "ONLINE") {
    const result = await createGatewayOrder({
      amountRupees: quote.totals.total,
      receipt: orderNumber,
      notes: { orderNumber, branch: quote.branch.name },
    });
    if (!result.ok) {
      // A sub-₹1 total is the customer's own discounts working, not a fault —
      // tell them to switch method instead of implying the site is broken.
      if (result.reason === "amount-too-small")
        throw new HttpError(
          400,
          "This order is too small to pay for online. Please choose Cash on Delivery."
        );
      // "auth" stays a 502 deliberately: our keys being wrong is a server
      // problem, and a 401 here would read as "you are signed out" and bounce
      // the customer to the login page mid-checkout.
      throw new HttpError(
        502,
        "Could not start the payment. Please try again, or choose Cash on Delivery."
      );
    }
    gatewayOrder = result.order;
  }

  const order = await db.$transaction(async (tx) => {
    // Deduct redeemed points atomically.
    if (quote.pointsRedeemed > 0) {
      const p = await tx.customerProfile.findUnique({ where: { userId: session.uid } });
      if (!p || p.loyaltyPoints < quote.pointsRedeemed)
        throw new HttpError(400, "Loyalty points balance changed — please retry");
      await tx.customerProfile.update({
        where: { userId: session.uid },
        data: { loyaltyPoints: { decrement: quote.pointsRedeemed } },
      });
      await tx.loyaltyTransaction.create({
        data: {
          userId: session.uid,
          points: -quote.pointsRedeemed,
          type: "REDEEM",
          note: `Redeemed on order ${orderNumber}`,
        },
      });
    }
    // Decrement tracked stock.
    for (const line of quote.lines) {
      const updated = await tx.branchMenuItem.updateMany({
        where: {
          branchId: quote.branch.id,
          menuItemId: line.menuItemId,
          stockQty: { gte: line.qty },
        },
        data: { stockQty: { decrement: line.qty } },
      });
      if (updated.count === 0) {
        const bi = await tx.branchMenuItem.findUnique({
          where: { branchId_menuItemId: { branchId: quote.branch.id, menuItemId: line.menuItemId } },
        });
        if (bi && bi.stockQty !== -1)
          throw new HttpError(409, `${line.name} just sold out — please update your cart`);
      }
    }

    const created = await tx.order.create({
      data: {
        orderNumber,
        userId: session.uid,
        branchId: quote.branch.id,
        type: quote.orderType,
        status: "PLACED",
        scheduledFor: quote.scheduledFor,
        addressId: quote.address?.id ?? null,
        addressText: quote.address?.text ?? null,
        addressPincode: quote.address?.pincode ?? null,
        addressLat: quote.address?.lat ?? null,
        addressLng: quote.address?.lng ?? null,
        // Snapshot: editing or deleting the saved address later must not change
        // who the delivery agent was told to call for THIS order.
        contactName: quote.address?.contactName ?? null,
        contactPhone: quote.address?.contactPhone ?? null,
        contactless: body.contactless,
        instructions: body.instructions ?? null,
        cutlery: body.cutlery,
        distanceKm: quote.distanceKm,
        subtotal: quote.totals.subtotal,
        discount: quote.totals.discount,
        deliveryFee: quote.totals.deliveryFee,
        packagingFee: quote.totals.packagingFee,
        tax: quote.totals.tax,
        loyaltyCredit: quote.totals.loyaltyCredit,
        total: quote.totals.total,
        paymentMethod: body.paymentMethod,
        paymentStatus: "PENDING",
        couponCode: quote.coupon.applied?.code ?? null,
        couponId: quote.couponId,
        pointsRedeemed: quote.pointsRedeemed,
        etaMins: quote.etaMins,
        items: {
          create: quote.lines.map((l) => ({
            menuItemId: l.menuItemId,
            nameSnapshot: l.name,
            variantName: l.variantName,
            addOnsJson: JSON.stringify(l.addOns.map((a) => ({ name: a.name, price: a.price }))),
            unitPrice: l.unitPrice,
            qty: l.qty,
            lineTotal: l.lineTotal,
            instructions: l.instructions,
          })),
        },
        payment: {
          create: {
            provider: body.paymentMethod === "COD" ? "cod" : paymentProvider(),
            method: body.paymentMethod,
            status: "PENDING",
            amount: quote.totals.total,
            providerOrderId: gatewayOrder?.id ?? null,
          },
        },
      },
    });

    if (quote.couponId && quote.coupon.applied) {
      await tx.couponRedemption.create({
        data: {
          couponId: quote.couponId,
          orderId: created.id,
          userId: session.uid,
          amountSaved: quote.coupon.applied.savings,
        },
      });
    }
    return created;
  });

  // For ONLINE the order is not yet paid — hand the browser what Checkout needs
  // and stay quiet until /api/payments/verify (or the webhook) confirms money
  // actually arrived. Notifying now would promise an order we may never be paid for.
  if (gatewayOrder) {
    return NextResponse.json({
      ok: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      payment: {
        provider: "razorpay",
        keyId: process.env.RAZORPAY_KEY_ID ?? "",
        gatewayOrderId: gatewayOrder.id,
        amount: gatewayOrder.amount, // paise
        currency: gatewayOrder.currency,
        customerName: user.name ?? "",
        customerPhone: user.phone ?? "",
      },
    });
  }

  await notifyUser(
    session.uid,
    "ORDER_PLACED",
    "Order placed ✅",
    `Order ${order.orderNumber} has been sent to ${quote.branch.name}. We'll confirm it shortly.`
  );

  return NextResponse.json({ ok: true, orderId: order.id, orderNumber: order.orderNumber });
});

/** Customer order history. */
export const GET = handler(async () => {
  const session = await requireCustomer();
  const orders = await db.order.findMany({
    where: { userId: session.uid },
    orderBy: { placedAt: "desc" },
    take: 50,
    include: { items: true, branch: { select: { name: true, slug: true } } },
  });
  return NextResponse.json({ orders });
});
