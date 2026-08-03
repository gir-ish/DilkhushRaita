# DilKhush Dhaba — API Reference

All endpoints are JSON over HTTPS. Authentication uses an HTTP-only cookie (`dk_session`) set by the login endpoints. Errors return `{ "error": "message" }` with an appropriate status (`400` validation, `401` unauthenticated, `403` forbidden, `404` not found, `409` conflict, `429` rate-limited).

Roles: **C** = customer session, **S** = staff session (role list in parentheses; OWNER always allowed), **–** = public.

## Auth

| Method & path | Auth | Body / params | Notes |
|---|---|---|---|
| `POST /api/auth/otp/send` | – | `{ phone }` | Indian numbers only. 30s resend cooldown, 5/hour/phone, 15/hour/IP. Dev (`OTP_PROVIDER=console`, non-production): response includes `devOtp`. |
| `POST /api/auth/otp/verify` | – | `{ phone, code, name? }` | 6-digit code, 5-min expiry, 5 attempts. Creates the customer on first login; sets session cookie (30 days). |
| `POST /api/auth/staff/login` | – | `{ email, password }` | Staff only; 10 attempts / 15 min / IP; 12-hour session. |
| `POST /api/auth/logout` | any | — | Clears the cookie. |

## Branches & menu (public)

| Method & path | Body / params | Notes |
|---|---|---|
| `GET /api/branches` | `?pincode=110085` | All branches with open status, fees, min order; `pincode` adds per-branch serviceability. |
| `POST /api/branches/locate` | `{ lat, lng, pincode? }` | Distance (road estimate), travel & total ETA, delivery fee, serviceability per branch + `recommendedBranchId` (fastest open serviceable branch). |
| `GET /api/menu/[branchSlug]` | — | Categories → items with branch-effective price, availability (flag + stock + time window), variants, add-ons, dietary flags, allergens. |

## Cart, coupons & orders

| Method & path | Auth | Body / params | Notes |
|---|---|---|---|
| `POST /api/cart/quote` | – (better with C) | `{ branchId, orderType, items:[{menuItemId, variantId?, addOnIds?, qty, instructions?}], addressId?, couponCode?, redeemPoints?, paymentMethod?, scheduledFor? }` | Server-priced preview. Returns lines, totals breakdown, warnings (unavailable items, min-order, serviceability), applied/suggested coupon with reasons, ETA, points info. **Client prices are never trusted.** |
| `GET /api/coupons/available` | – / C | `?branchId&subtotal&orderType` | Eligible offers ranked by savings + ineligible ones with exact reasons. |
| `POST /api/orders` | C | same shape as quote + `{ instructions?, cutlery, contactless }` | Strict re-validation (branch open, capacity, stock, serviceability, min order, coupon, points) in a transaction: order + items snapshot + payment row + coupon redemption + stock decrement + point deduction. Rate-limited 5/10min. COD-restricted customers are blocked. |
| `GET /api/orders` | C | — | Own order history (50 latest). |
| `GET /api/orders/[id]` | C | — | Own order detail + live status (poll this). |
| `POST /api/orders/[id]/cancel` | C | `{ reason? }` | Allowed in PLACED/ACCEPTED; returns redeemed points, restores stock. |
| `POST /api/orders/[id]/review` | C | `{ foodRating, packagingRating?, deliveryRating?, overallRating, comment? }` | After DELIVERED, once per order. |

## Customer account

| Method & path | Auth | Notes |
|---|---|---|
| `GET /api/me` | C | Profile + loyalty summary (`{user:null}` when signed out). |
| `PATCH /api/me` | C | `{ name?, notifyPromos?, birthday?, anniversary? }` |
| `GET/POST /api/me/addresses`, `DELETE /api/me/addresses/[id]` | C | Address book; `POST` accepts label/lines/landmark/pincode/lat/lng/instructions/isDefault. |
| `GET/POST /api/me/favourites` | C | `POST { menuItemId }` toggles. |
| `GET/POST /api/support` | C | Complaint tickets (`type` ∈ MISSING_ITEM, WRONG_ITEM, LATE, QUALITY, PAYMENT, COUPON, PACKAGING, OTHER). |

## Admin (staff cookie required; non-owner staff are branch-scoped)

| Method & path | Roles | Notes |
|---|---|---|
| `GET /api/admin/summary` | S (all but KITCHEN) | `?range=today|yesterday|7d|30d|custom&from&to&branchId` — revenue, orders, AOV, cancellations, active, new customers, discounts, by-branch, by-hour, payment mix, bestsellers, avg delivery mins. |
| `GET /api/admin/orders` | S (ops roles) | `?q&status&paymentStatus&branchId&active=1&date` — queue with customer, items, agent. |
| `PATCH /api/admin/orders/[id]` | S (ops roles) | Actions: `accept {prepTimeMins}`, `reject {reason}` (fixed reason list), `status {status}` (validated transitions; KITCHEN limited to PREPARING/READY), `assign {agentId}`, `note {note}`, `refund {amount, mode, reason}`. DELIVERED triggers loyalty/metrics/COD capture; cancel/reject returns points & stock. All audited. |
| `GET /api/admin/agents` | S (ops) | Delivery agents for assignment. |
| `GET/POST /api/admin/menu/categories`, `PATCH/DELETE …/[id]` | S (BRANCH_MANAGER) | Category CRUD (delete blocked while items exist). |
| `GET/POST /api/admin/menu/items`, `PATCH/DELETE …/[id]` | S (BRANCH_MANAGER) | Item CRUD with nested `variants`, `addOns`, per-branch `branchOverrides` (priceOverride, available, stockQty, time window). `GET ?format=csv` exports. DELETE = soft-deactivate. Price changes audited separately. |
| `POST /api/admin/menu/import` | S (BRANCH_MANAGER) | CSV body: `name,category,price,veg,spicy,bestseller,description`. Upserts by name; auto-creates categories. |
| `GET /api/admin/branches`, `PATCH …/[id]` | S (BRANCH_MANAGER, own branch only) | Every branch setting incl. coordinates, hours array, PIN list, fees, busy mode, capacity. Audited (closure/busy flagged distinctly). |
| `GET/POST /api/admin/coupons`, `PATCH/DELETE …/[id]` | S (MARKETING) | Full rule set (see `CouponBody` in `src/lib/validation.ts`). DELETE deactivates (history kept). |
| `GET /api/admin/coupons/preview` | S (MARKETING) | Eligible-customer estimate, example calculation, max liability + unlimited-liability warning. |
| `GET /api/admin/customers`, `PATCH …/[id]` | S (BRANCH_MANAGER, MARKETING) | `?q&segment=new|frequent|high-spend|inactive-30`; PATCH: `blocked`, `codOnlyBlock`, `adjustPoints`, `adjustCredit` (+`note`). Audited. |
| `GET/PUT /api/admin/loyalty-tiers` | S (MARKETING read/write) | Owner-configurable tier ladder. |
| `GET /api/admin/reports` | S (BM, CASHIER, MARKETING) | `?type=sales|items|coupons|customers|cod&from&to&branchId&format=csv`. |
| `GET /api/admin/audit` | OWNER | Last 200 audit entries. |

## Provider integration points

- **Maps** (`MAPS_PROVIDER`): replace `roadKm()` in `src/lib/geo.ts` with a Distance Matrix call; everything downstream (ETA, fees, serviceability) consumes its output.
- **Payments** (`PAYMENT_PROVIDER`): add a provider module creating provider orders in `POST /api/orders` and a webhook route verifying `RAZORPAY_WEBHOOK_SECRET` that flips `Payment.status` + `webhookVerified`. Checkout UI already gates non-COD methods on this env.
- **OTP / notifications**: implement the `OtpProvider` interface (`src/lib/otp.ts`) or the channel stubs in `src/lib/notify.ts`.
