/**
 * End-to-end smoke test against a RUNNING server.
 *
 *   npm run smoke                        # defaults to http://localhost:3000
 *   SMOKE_URL=http://localhost:3002 npm run smoke
 *
 * Unlike the vitest suites (pure functions, no I/O) this drives the real HTTP
 * API: public endpoints, auth guards, the full order flow and payment gating.
 * It is deliberately NOT part of `npm run build` because it needs a live server
 * and writes to the database.
 *
 * Requires OTP_BYPASS="true" to sign in without a real SMS.
 */

const BASE = process.env.SMOKE_URL ?? "http://localhost:3000";
const PHONE = process.env.SMOKE_PHONE ?? "9999000011";

let pass = 0;
let fail = 0;
const failures = [];
let cookie = "";
let victimOrderId = null; // used by the cross-account access check

function ok(name) {
  pass++;
  console.log(`  \x1b[32m✓\x1b[0m ${name}`);
}
function bad(name, detail) {
  fail++;
  failures.push({ name, detail });
  console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${detail}`);
}
function check(name, cond, detail = "") {
  cond ? ok(name) : bad(name, detail || "assertion failed");
  return cond;
}

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  let body = null;
  const text = await res.text();
  try {
    body = JSON.parse(text);
  } catch {
    body = text.slice(0, 200);
  }
  return { status: res.status, body };
}

console.log(`\n\x1b[1mSmoke test → ${BASE}\x1b[0m\n`);

// ---------------------------------------------------------------- reachability
console.log("Reachability");
{
  const r = await req("/");
  if (!check("homepage responds 200", r.status === 200, `got ${r.status}`)) {
    console.log("\n\x1b[31mServer unreachable — aborting.\x1b[0m\n");
    process.exit(1);
  }
}

// ---------------------------------------------------------------- public API
console.log("\nPublic API");
let slug = null;
{
  const r = await req("/api/branches");
  check("GET /api/branches → 200", r.status === 200, `got ${r.status}`);
  const branches = r.body?.branches ?? [];
  check("returns at least one branch", branches.length > 0, "no branches (is the DB seeded?)");
  slug = branches[0]?.slug ?? null;

  // A public endpoint must never leak internal fields.
  const leaked = branches[0] && ["ownerId", "passwordHash", "apiKey"].filter((k) => k in branches[0]);
  check("branch payload has no sensitive fields", !leaked || leaked.length === 0, `leaked: ${leaked}`);
}
if (slug) {
  const r = await req(`/api/menu/${slug}`);
  check(`GET /api/menu/${slug} → 200`, r.status === 200, `got ${r.status}`);
  check("menu has categories", Array.isArray(r.body?.categories), "no categories array");
}
{
  const r = await req("/api/menu/definitely-not-a-real-branch");
  check("unknown branch slug → 4xx", r.status >= 400 && r.status < 500, `got ${r.status}`);
}

// ---------------------------------------------------------------- auth guards
console.log("\nAuth guards (unauthenticated)");
for (const [path, method] of [
  ["/api/me/addresses", "GET"],
  ["/api/orders", "GET"],
  ["/api/support", "GET"],
]) {
  const r = await req(path, { method });
  check(`${method} ${path} → 401`, r.status === 401, `got ${r.status}`);
}
{
  // /api/me deliberately answers 200 with {user:null} when signed out — the
  // site header relies on it. What matters is that it exposes no user data.
  const r = await req("/api/me");
  check(
    "GET /api/me → {user:null} when signed out",
    r.status === 200 && r.body?.user === null,
    `got ${r.status}: ${JSON.stringify(r.body).slice(0, 120)}`
  );
}
{
  const r = await req("/api/admin/summary");
  check("GET /api/admin/summary → 401 for anonymous", r.status === 401, `got ${r.status}`);
}

// ---------------------------------------------------------------- input validation
console.log("\nInput validation");
{
  const r = await req("/api/auth/otp/send", {
    method: "POST",
    body: JSON.stringify({ phone: "123" }),
  });
  check("rejects a too-short phone", r.status >= 400, `got ${r.status}`);
}
{
  const r = await req("/api/auth/otp/send", { method: "POST", body: "{not json" });
  check("rejects malformed JSON", r.status >= 400, `got ${r.status}`);
}

// ---------------------------------------------------------------- sign in
console.log("\nAuthentication");
let signedIn = false;
{
  const send = await req("/api/auth/otp/send", {
    method: "POST",
    body: JSON.stringify({ phone: PHONE }),
  });
  check("POST /api/auth/otp/send → 200", send.status === 200, `got ${send.status}`);

  const code = send.body?.bypass ? "" : send.body?.devOtp;
  if (!send.body?.bypass && !code) {
    bad("sign-in", "no bypass and no devOtp — set OTP_BYPASS=true to run this suite");
  } else {
    const v = await req("/api/auth/otp/verify", {
      method: "POST",
      body: JSON.stringify({ phone: PHONE, code, name: "Smoke Test" }),
    });
    signedIn = check("POST /api/auth/otp/verify → 200", v.status === 200, `got ${v.status}: ${JSON.stringify(v.body)}`);
    check("session cookie issued", cookie.length > 0, "no cookie set");
  }
}

if (signedIn) {
  const r = await req("/api/me");
  check("GET /api/me → 200 once signed in", r.status === 200, `got ${r.status}`);
  check("never exposes a password hash", !JSON.stringify(r.body).includes("passwordHash"), "passwordHash present");
}

// ---------------------------------------------------------------- ordering
console.log("\nOrdering");
if (signedIn && slug) {
  const menu = (await req(`/api/menu/${slug}`)).body;
  const branchId = menu?.branch?.id;
  const item = menu?.categories?.flatMap((c) => c.items).find((i) => i.available);

  // Branch capabilities are seed/config driven, so discover them rather than
  // assuming: pickup is disabled on the stock seed data.
  const branchInfo = (await req("/api/branches")).body?.branches?.find((b) => b.slug === slug);
  const usePickup = branchInfo?.pickupEnabled === true;

  let addressId = null;
  if (!usePickup) {
    const pin = process.env.SMOKE_PINCODE ?? "110085";
    const a = await req("/api/me/addresses", {
      method: "POST",
      body: JSON.stringify({
        label: "Home",
        line1: "1 Smoke Test Lane",
        pincode: pin,
        isDefault: true,
      }),
    });
    check("POST /api/me/addresses → 200", a.status === 200, `got ${a.status}: ${JSON.stringify(a.body)}`);
    addressId = a.body?.address?.id ?? null;
  }

  if (!branchId || !item) {
    bad("order flow", "could not find an available menu item to order");
  } else if (!usePickup && !addressId) {
    bad("order flow", "could not create a delivery address");
  } else {
    const orderBody = {
      branchId,
      orderType: usePickup ? "PICKUP" : "DELIVERY",
      addressId: usePickup ? null : addressId,
      items: [{ menuItemId: item.id, qty: 1 }],
      paymentMethod: "COD",
      cutlery: true,
    };

    const q = await req("/api/cart/quote", { method: "POST", body: JSON.stringify(orderBody) });
    check("POST /api/cart/quote → 200", q.status === 200, `got ${q.status}: ${JSON.stringify(q.body)}`);
    const total = q.body?.quote?.totals?.total;
    check("quote returns a positive total", typeof total === "number" && total > 0, `total=${total}`);

    // Server must recompute prices, never trust a client-supplied one.
    const tampered = await req("/api/cart/quote", {
      method: "POST",
      body: JSON.stringify({ ...orderBody, items: [{ menuItemId: item.id, qty: 1, unitPrice: 1 }] }),
    });
    check(
      "ignores a client-supplied unitPrice",
      tampered.status !== 200 || tampered.body?.quote?.totals?.total === total,
      `tampered total=${tampered.body?.quote?.totals?.total} vs ${total}`
    );

    const o = await req("/api/orders", { method: "POST", body: JSON.stringify(orderBody) });
    check("POST /api/orders (COD) → 200", o.status === 200, `got ${o.status}: ${JSON.stringify(o.body)}`);
    const orderId = o.body?.orderId;
    check("order id returned", !!orderId, "no orderId");
    victimOrderId = orderId;

    if (orderId) {
      const g = await req(`/api/orders/${orderId}`);
      check("GET /api/orders/:id → 200", g.status === 200, `got ${g.status}`);
    }

    const qty0 = await req("/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...orderBody, items: [{ menuItemId: item.id, qty: 0 }] }),
    });
    check("rejects qty 0", qty0.status >= 400, `got ${qty0.status}`);

    const empty = await req("/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...orderBody, items: [] }),
    });
    check("rejects an empty order", empty.status >= 400, `got ${empty.status}`);

    // Online must be refused unless PAYMENT_PROVIDER is a real gateway, no
    // matter what the client asks for.
    const online = await req("/api/orders", {
      method: "POST",
      body: JSON.stringify({ ...orderBody, paymentMethod: "ONLINE" }),
    });
    const gatewayLive = online.status === 200 && online.body?.payment?.gatewayOrderId;
    check(
      gatewayLive
        ? "ONLINE order opens a gateway order (gateway configured)"
        : "ONLINE refused while PAYMENT_PROVIDER=cod",
      gatewayLive || online.status === 400,
      `got ${online.status}: ${JSON.stringify(online.body)}`
    );
  }
}

// ---------------------------------------------------------------- payments
console.log("\nPayments");
{
  const r = await req("/api/payments/webhook", {
    method: "POST",
    body: JSON.stringify({ event: "payment.captured", payload: {} }),
  });
  check("webhook rejects an unsigned request", r.status === 400, `got ${r.status}`);
}
{
  const r = await req("/api/payments/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": "0".repeat(64) },
    body: JSON.stringify({ event: "payment.captured", payload: {} }),
  });
  check("webhook rejects a forged signature", r.status === 400, `got ${r.status}`);
}
if (signedIn) {
  const r = await req("/api/payments/verify", {
    method: "POST",
    body: JSON.stringify({
      orderId: "does-not-exist",
      razorpayOrderId: "order_fake",
      razorpayPaymentId: "pay_fake",
      signature: "0".repeat(64),
    }),
  });
  check("verify rejects an unknown order", r.status >= 400, `got ${r.status}`);
}

// ------------------------------------------------- cross-account access (IDOR)
console.log("\nCross-account access");
if (victimOrderId) {
  // Sign in as a DIFFERENT customer, then try to read the first one's order.
  const otherPhone = process.env.SMOKE_PHONE_2 ?? "9999000022";
  cookie = "";
  await req("/api/auth/otp/send", { method: "POST", body: JSON.stringify({ phone: otherPhone }) });
  const v = await req("/api/auth/otp/verify", {
    method: "POST",
    body: JSON.stringify({ phone: otherPhone, code: "", name: "Smoke Two" }),
  });

  if (v.status !== 200) {
    bad("second account sign-in", `got ${v.status}: ${JSON.stringify(v.body)}`);
  } else {
    const stolen = await req(`/api/orders/${victimOrderId}`);
    check(
      "cannot read another customer's order",
      stolen.status === 404 || stolen.status === 403,
      `got ${stolen.status} — ORDER DATA LEAK`
    );

    const cancelled = await req(`/api/orders/${victimOrderId}/cancel`, { method: "POST", body: "{}" });
    check(
      "cannot cancel another customer's order",
      cancelled.status >= 400,
      `got ${cancelled.status} — CAN CANCEL OTHERS' ORDERS`
    );
  }
} else {
  console.log("  (skipped — no order was created)");
}

// ---------------------------------------------------------------- summary
console.log(`\n\x1b[1mResult:\x1b[0m ${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  console.log("\x1b[31mFailures:\x1b[0m");
  for (const f of failures) console.log(`  • ${f.name} — ${f.detail}`);
  console.log("");
  process.exit(1);
}
console.log("\x1b[32mAll smoke checks passed.\x1b[0m\n");
