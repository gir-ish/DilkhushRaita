# 🥘 DilKhush Dhaba – Raita Wala

A **production-ready, mobile-first, full-stack restaurant ordering platform** built exclusively for DilKhush Dhaba – Raita Wala (Rohini & NSP branches, Delhi).

This is not a UI mock-up: it is a working website + database + APIs + authentication + owner dashboard + kitchen screen, with server-side pricing, a rule-based coupon engine, a loyalty programme and role-based access control.

> ⚠️ **Placeholders:** every address, coordinate, phone number, staff password and food image (emoji placeholders) in the seed data is marked `PLACEHOLDER` and must be replaced before going live. Nothing is hard-coded — all branch details are editable live from the owner dashboard.

---

## Table of contents

1. [Tech stack](#tech-stack)
2. [How to run](#how-to-run)
3. [Test accounts](#test-accounts)
4. [Guided walkthrough (place your first order)](#guided-walkthrough)
5. [Features — customer website](#features--customer-website)
6. [Features — owner & staff dashboard](#features--owner--staff-dashboard)
7. [Loyalty programme](#loyalty-programme)
8. [Coupon engine](#coupon-engine)
9. [Order status workflow](#order-status-workflow)
10. [User roles & permissions](#user-roles--permissions)
11. [Project structure](#project-structure)
12. [Database](#database)
13. [Environment variables](#environment-variables)
14. [Security](#security)
15. [Testing](#testing)
16. [Going to production](#going-to-production)
17. [Troubleshooting](#troubleshooting)
18. [Prepared for later activation](#prepared-for-later-activation)

---

## Tech stack

| Layer | Technology |
|---|---|
| Framework | **Next.js 15** (App Router) + **TypeScript** |
| Styling | **Tailwind CSS** — warm dhaba design system (cream / maroon / mustard, rounded cards, large touch targets) |
| Database | **Prisma ORM** — SQLite in development (zero setup), **PostgreSQL** in production (one-line switch) |
| Auth | Phone **OTP** for customers, email + password for staff → signed **HTTP-only JWT cookie** |
| Realtime | Polling (8–10 s) on tracking, order queue and kitchen screens |
| PWA | Web manifest, service worker, offline fallback, installable on phones |
| Tests | **Vitest** — 32 unit tests on the money-handling logic |

Modular providers (swap via env, no rewrites): OTP (console/MSG91), payments (COD live, Razorpay slot), maps (built-in road estimate / Google slot), notifications (in-app live; SMS/WhatsApp/Email stubs).

---

## How to run

### Prerequisites

- **Node.js 20+** and npm. That's all — no database server, no Docker.

### First-time setup

Open a terminal in the project folder and run:

```bash
npm install               # 1. install dependencies
cp .env.example .env      # 2. create local config   (Windows: Copy-Item .env.example .env)
npx prisma migrate dev    # 3. create the SQLite database and tables
npm run db:seed           # 4. load branches, menu, staff accounts, coupons, tiers
```

### Start the website (development)

```bash
npm run dev
```

Open **http://localhost:3000**. Stop with `Ctrl+C`.

### Production-style run

```bash
npm run build
npm start
```

### All scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server at http://localhost:3000 |
| `npm run build` / `npm start` | Production build / serve |
| `npm test` | Run the unit tests |
| `npm run typecheck` | TypeScript check, no emit |
| `npm run verify` | `typecheck` + `test` — runs automatically before every build |
| `npm run smoke` | End-to-end HTTP test against a **running** server |
| `npm run db:migrate` | Apply schema changes |
| `npm run db:seed` | (Re)load sample data |
| `npm run db:studio` | Visual database browser at http://localhost:5555 |
| `npm run db:reset` | Wipe the database, re-migrate, re-seed |

### Testing

`npm run build` is gated: npm runs `prebuild` → `verify` (type-check + unit
tests) first, and a single failure aborts the build before `next build` starts.

> Because of this, the server needs devDependencies — do **not** deploy with
> `npm install --production`, or the build will fail with "vitest not found".

The unit suites (`tests/*.test.ts`) are pure functions — pricing, coupons,
loyalty, geo, and the payment signature/amount logic. No database or network.

`npm run smoke` is separate because it needs a live server and writes to the
database. It drives the real HTTP API: public endpoints, auth guards, input
validation, the full order flow, payment gating, and cross-account access
(one customer must never read or cancel another's order).

```bash
npm run dev                                   # in one terminal
SMOKE_URL=http://localhost:3000 npm run smoke # in another
```

It signs in over OTP, so it needs `OTP_BYPASS="true"` (or a console OTP
provider). Point `SMOKE_URL` at whichever port `next dev` actually claimed.

> Don't run `npm run build` while `npm run dev` is running — they share
> `.next/`, and the production output makes the dev server throw
> `Cannot find module './XXXX.js'`. Fix: stop dev, `rm -rf .next`, restart.

**Run `npm run build` before pushing, not just `npm run verify`.** `verify` is
type-check plus unit tests; it cannot see prerender errors. A client hook like
`useSearchParams()` outside a `<Suspense>` boundary passes `next dev`, passes
`tsc`, passes every test — and then fails the production build during static
generation. `build` runs `verify` first via `prebuild`, so it is the only
command you actually need.

---

## Test accounts

> ⚠️ **Seed passwords are not secrets.** They are the same in every copy of this
> repository, so any install still using them can be signed into by anyone who
> can read this file. They exist to get a *local* install running, nothing more.
>
> On a live deployment, change them before the site takes an order:
>
> ```bash
> # Owner — also clears the PIN and unpairs every device
> OWNER_EMAIL='you@example.com' OWNER_PASSWORD='...' OWNER_NAME='Your Name' node scripts/set-owner.mjs
>
> node scripts/staff-passwords.mjs --list        # see what exists
> node scripts/staff-passwords.mjs --reset-all   # new random passwords, printed once
> node scripts/staff-passwords.mjs --block marketing@dilkhush.test   # roles you do not use
> ```

### Customers — sign in at `/login`

| Phone | OTP |
|---|---|
| `98999 99999` (or any valid Indian mobile — new numbers auto-register) | Shown **on the login screen** in dev mode, and printed in the server terminal |

### Staff — sign in at `/admin/login`

| Role | Email (local seed) | Can access |
|---|---|---|
| **Owner** | `owner@dilkhush.test` | Everything, all branches |
| Branch Manager (Rohini) | `manager.rohini@dilkhush.test` | Own branch: orders, menu, branch settings, customers, reports |
| Branch Manager (NSP) | `manager.nsp@dilkhush.test` | Same, NSP only |
| Kitchen (Rohini) | `kitchen.rohini@dilkhush.test` | Order queue + kitchen screen (Preparing/Ready only) |
| Kitchen (NSP) | `kitchen.nsp@dilkhush.test` | Same, NSP only |
| Cashier (Rohini) | `cashier.rohini@dilkhush.test` | Orders, payments, refunds, reports |
| Delivery Manager | `delivery@dilkhush.test` | Orders, agent assignment |
| Marketing | `marketing@dilkhush.test` | Coupons, loyalty tiers, customers, reports |

Passwords for these are set in `prisma/seed.ts` and printed by the seed run. They
are for local development only — see the warning above.

### Owner PIN

Typing a long password on a phone every time you check the queue is how the
password ends up on a sticky note by the till. The owner can set a 4-6 digit PIN
instead.

A short PIN is only ten thousand guesses, so it never stands alone. Signing in
with email and password *pairs* that browser (a random token in an httpOnly
cookie, stored only as a hash), and the PIN is accepted from a paired browser or
not at all — shoulder-surfing the digits buys nothing on another machine. Five
wrong tries lock that device for 15 minutes; the password still works meanwhile.
Only the OWNER role can have one.

- **Set it:** sign in with email + password; you are offered a PIN straight after.
  Later, Dashboard → *Devices that can use your PIN* → **Set / Change PIN**.
- **Forgot it:** *Forgot PIN?* on the lock screen emails a six-digit code to the
  address on the account (never one supplied in the request). The code sets a new
  PIN but does not sign you in. Needs `SMTP_URL` — see `.env.example`.
- **Lost a device:** the same dashboard panel lists every paired browser with
  when it was last used, and removes any of them, or all at once.

Two seeded delivery agents (Raju, Sonu) are available for assignment on delivery orders.

---

## Guided walkthrough

The branches follow their opening hours (11:00–23:00 IST). **Outside those hours** first sign in as the owner → **Branches** → *Open status* → **Force open** → Save.

1. **Customer window:** open http://localhost:3000 → tap **📍 Find the Closest Branch** (or enter PIN `110085`) → pick Rohini → browse the menu.
2. Add **Dal Makhani** (choose portion + "Extra Raita" add-on) and a couple of **Garlic Naans** → open the cart → **Checkout**.
3. Sign in with `9899999999` (OTP shown on screen) → **Add new address** with PIN `110085` → the WELCOME50 first-order coupon auto-applies → **Place order** (Cash on Delivery).
4. **Second window (or incognito):** sign in at `/admin/login` as the owner → **Orders** — you'll hear a 🔔 beep for the new order. Open it, set a prep time, **Accept**.
5. Go to **Kitchen** → tap **🍳 Start preparing** → **✅ Ready**. Back in Orders: **→ OUT FOR DELIVERY** → **→ DELIVERED**.
6. Watch the customer's tracking page update live, award loyalty points, then rate the order and try **🔁 Order again**.
7. Check **Overview** and **Reports** in the dashboard — your order is in the numbers.

---

## Features — customer website

### Landing & branch selection (`/`)
- DilKhush Dhaba – Raita Wala branding, warm dhaba visual identity, subtle jaali pattern
- Both branches shown with: name, address, **open/closed status**, distance, **estimated delivery time**, delivery fee, free-delivery threshold, minimum order, pickup availability, busy badge
- **Find the Closest Branch** — location permission is requested *only after tapping*; road-distance estimate + ETA for both branches; best branch recommended, manual choice always allowed
- **Enter Address Manually** — PIN-code serviceability check as fallback
- Non-serviceable branches can't be checked out from (validated again on the server)

### Menu (`/menu/rohini`, `/menu/nsp`)
- **Branch-specific**: prices, availability, stock and time-windows can differ per branch (e.g. Chole Bhature 08:00–16:00, Pineapple Raita NSP-only, Paneer Butter Masala ₹10 dearer at NSP)
- Search bar + category chips (Recommended, Bestsellers, Starters, Main Course, Dal, Paneer, Thali, Raita, Breads, Rice, Beverages, Desserts — all editable in the dashboard)
- Filters: 🟢 Veg · 🌱 Vegan · 🌶 Spicy · ⭐ Bestsellers · ✅ In stock · price sorting
- Item cards: image (emoji placeholder), veg mark, bestseller label, rating placeholder, prep time, price, availability note ("Sold out", "Available 08:00–16:00")
- Item detail modal: **portion variants** (Half/Full/Large…), **add-ons** (Extra Raita, Extra Butter, Extra Gravy, Salad, Cutlery…), quantity, special instructions ("less spicy, no onion"), ingredients & allergens

### Cart (`/cart`)
- Persistent (survives refresh/close), bound to **one branch**; switching branches asks for confirmation and clears
- Quantity controls, variant/add-on summary, per-item instructions
- **Server-priced bill**: item subtotal, discount, delivery fee, packaging, tax — shown *before* checkout, no hidden charges; coupon suggestion banner
- The browser never sends prices — everything is recomputed by `/api/cart/quote`

### Checkout (`/checkout`)
- **Delivery or Self-pickup**, immediate or **scheduled** (20 min – 3 days ahead)
- Saved addresses + add-address form (house/street, locality, landmark, PIN, label, delivery instructions, **optional GPS pin**)
- Serviceability re-validated: distance vs branch radius **or** whitelisted PIN codes
- Contactless delivery toggle, cutlery preference, restaurant instructions
- Coupons: manual code entry, **View all offers** drawer showing eligible coupons ranked by savings *and* ineligible ones with the exact reason ("Add items worth ₹100 more…", "Valid on your first order only")
- **Loyalty point redemption** toggle (100 pts = ₹50)
- **Cash on Delivery** live; online payment architecture ready behind `PAYMENT_PROVIDER`
- Order placed atomically: stock decremented, points deducted, coupon redemption recorded

### Order tracking (`/orders/[id]`)
- Unique order number, live status timeline (polls every 8 s)
- Statuses: Placed → Accepted → Preparing → Ready → Out for delivery → Delivered (+ Rejected / Cancelled / Refund initiated / Refunded)
- ETA, delivery-agent card with call button when assigned
- **Cancel** button (until preparing starts), **printable invoice**, 🔁 **Order again**, ⭐ post-delivery ratings (food / packaging / delivery / overall + comment)
- 📞 Call restaurant · 🆘 order-specific help button

### Account (`/account`)
- Profile (name, phone), **loyalty card**: points, ₹ value, tier, benefits, progress to next tier, store credit, referral code
- Order history with one-tap repeat, favourites (❤️ on any dish), saved addresses
- **Notification preferences** — promotional opt-out that never disables order updates
- Support: raise complaints (missing/wrong item, late, quality, payment, coupon, packaging) and track ticket status/resolution

### PWA
- Installable (Add to Home Screen), app manifest + icons, offline fallback page, cached shell

### Accessibility & performance
Keyboard navigable, visible focus rings, labelled inputs, aria-live status updates, 44 px touch targets, high-contrast palette, semantic landmarks, lazy images, SEO metadata + schema.org Restaurant structured data.

---

## Features — owner & staff dashboard

All at `/admin` (staff login required; protected by middleware + per-route role checks).

### 📊 Overview
Today / yesterday / 7 days / 30 days × per-branch filters: revenue, completed orders, **active orders right now**, cancellations, average order value, new customers, discounts given, average delivery time, **branch comparison table**, bestselling items, orders-by-hour chart, payment-method breakdown, coupon usage.

### 🧾 Order management
- Live queue (10 s polling) with **new-order sound + desktop notification**
- Cards colour-coded by urgency; full detail view: customer + phone (tap to call), address, instructions, payment method/status, coupon used
- **Accept** with prep-time control · **Reject** with fixed reason list (customer notified, points returned, stock restored)
- Status workflow with **validated transitions**, delivery-agent assignment, refunds (cash / store credit / loyalty points / coupon / replacement) with mandatory reason, internal staff notes
- **Kitchen-ticket printing** (order no, items, add-ons, instructions, type, time — payment & customer details excluded) and customer invoice
- Search by order number, customer name, phone; filter by status/payment/active

### 👨‍🍳 Kitchen display
Large-text cards sorted oldest-first, elapsed timer with **LATE!** warning, scheduled-order flags, customer instructions highlighted, one-tap **Start preparing / Ready**, sound on new orders. Kitchen accounts are locked to exactly these actions.

### 🍛 Menu administration
- Category CRUD (+ hide/show), item CRUD: name (English + Hindi field), description, emoji/photo, price, veg/vegan/spicy/bestseller/recommended flags, prep time, ingredients, allergens, display order
- **Variants** and **add-ons** editors per item
- **Per-branch overrides**: price, availability toggle (one click from the list), **stock quantity** (auto-marks sold-out at 0, restored on cancellations), daily **time-window** availability
- **CSV export** and **CSV bulk import** (auto-creates categories, upserts by name)
- Deletion is soft (item hidden, order history preserved); price changes audited separately

### 🏪 Branch management (nothing hard-coded)
Per branch: name, address, coordinates, phone, **open-status override** (follow hours / force open / temporarily closed), **opening hours per weekday**, online-ordering / delivery / pickup toggles, delivery radius, serviceable PIN codes, minimum order, base + per-km delivery fee with free-km allowance, free-delivery threshold, packaging fee, tax %, prep time, **max active-order capacity**, and **🔥 Busy mode** (auto extra prep minutes, pause delivery → pickup-only, pause scheduled orders).

### 🎟️ Marketing
- **Coupon builder**: percent / flat / free-delivery rewards, max-discount cap, min/max cart, first-order-only, minimum completed orders, **win-back inactivity targeting**, delivery/pickup restriction, schedule (start/end), total + per-customer usage limits, auto-apply vs code-required, priority
- **Impact preview before saving**: estimated eligible customers, example order calculation, **maximum campaign liability** with an unlimited-liability warning
- Enable/disable instantly; per-coupon redemption count and total discount given
- **Loyalty tier editor** — names, thresholds, multipliers, benefits (see below)

### 👥 Customers
Metrics table (orders, cancellations, lifetime spend, AOV, last order, points, tier), search by name/phone, segments (new / frequent / high-spend / inactive 30 days), **block** (with manual confirmation), **COD restriction** for cash-abuse cases, manual point adjustments — all audited.

### 📈 Reports (CSV export on all)
Daily sales (revenue, discounts, delivery fees, taxes, cancellations) · menu performance (units, revenue) · **coupon performance** (uses, discount given, revenue generated, avg cart) · customer retention (per-customer lifetime metrics) · **COD reconciliation** (cash collected per order/agent/branch).

### 🔒 Audit log
Every sensitive action recorded: order accepted/rejected, price changed, item deleted, coupon created, branch closed, busy mode, refunds, customer blocked, point adjustments, staff logins. Owner-only via `/api/admin/audit`.

---

## Loyalty programme

- Earn **1 point per ₹10** spent (× tier multiplier), credited when an order is delivered
- Redeem at checkout: **100 points = ₹50** (minimum 100-point balance, capped at the payable amount); points returned automatically if the order is cancelled/rejected
- **Configurable tiers** (edit names/thresholds/benefits in Marketing):

| Tier | Requirement (orders + spend) | Benefits |
|---|---|---|
| New Customer | 0 | 1× points |
| Regular Customer | 3 + ₹750 | 1.2× points |
| Dhaba Lover | 8 + ₹2,500 | **Free delivery** + 1.5× points |
| DilKhush VIP | 20 + ₹8,000 | Free delivery + 2× points + **5% off every order** |

Tier benefits (free delivery, automatic discount) apply silently at checkout. Customer metrics (order counts, lifetime spend, AOV, last-order date, preferred branch) update on every delivery.

## Coupon engine

Seeded examples: `WELCOME50` (50% off ≤ ₹120, first order, auto-applies) · `DILKHUSH20` (20% ≤ ₹150 on ₹499+) · `FREEDEL` (free delivery on ₹299+) · `COMEBACK100` (₹100 off after 30 days inactivity, auto-applies).

Evaluation happens **only on the server**, in this order: active → schedule → time-of-day window → day-of-week → branch → order type → payment method → cart min/max → first-order → order-count / spend / tier / inactivity targeting → campaign & per-customer limits → reward computation with caps. Ineligible coupons return a human-readable reason that the customer sees. The best auto-apply coupon is applied automatically; a better code-required coupon is suggested.

## Order status workflow

```
PLACED ──► ACCEPTED ──► PREPARING ──► READY ──► (ASSIGNED) ──► OUT_FOR_DELIVERY ──► DELIVERED
   │                                    └──────────── pickup: READY ──► DELIVERED
   └──► REJECTED / CANCELLED ──► REFUND_INITIATED ──► REFUNDED
```

Transitions are whitelisted server-side; anything else is rejected. Delivery completion triggers: metrics update → tier recomputation → point earning → COD payment capture. Rejection/cancellation triggers: point return → stock restore → cancellation metrics → customer notification with reason and refund info.

## User roles & permissions

| Role | Scope |
|---|---|
| **Customer** | Browse freely; OTP required for checkout/account |
| **Owner** | Everything, all branches |
| **Branch Manager** | Assigned branch only: orders, menu, branch settings, customers, reports |
| **Kitchen** | Order queue + kitchen screen; can only mark Preparing/Ready |
| **Cashier** | Orders, accept/reject, payments, refunds, reports |
| **Delivery Manager** | Orders, agent assignment |
| **Marketing** | Coupons, loyalty tiers, customers, reports |
| **Delivery Agent** | Account type ready for the future agent app |

Enforced in three layers: middleware (route access), per-endpoint role guards, and branch scoping (non-owner staff only see their assigned branches' data).

## Project structure

```
prisma/
  schema.prisma        # 28-table relational schema (SQLite dev / PostgreSQL prod)
  seed.ts              # branches, menu, staff, coupons, tiers (all PLACEHOLDER-marked)
src/
  middleware.ts        # protects /admin, /account, /checkout
  lib/                 # business logic (framework-free, unit-testable)
    pricing.ts         #   single source of truth for order maths
    coupons.ts         #   rule evaluation engine
    loyalty.ts         #   tiers & points
    geo.ts             #   distance, ETA, serviceability, opening hours
    quote.ts           #   server-side cart validation + pricing pipeline
    order-effects.ts   #   delivery/cancellation side-effects
    otp.ts / session.ts / guard.ts / rate-limit.ts / audit.ts / notify.ts / csv.ts
  app/
    page.tsx           # landing + branch picker
    menu/[slug]/       # branch menu
    cart/ checkout/ orders/[id]/ account/ login/
    admin/             # dashboard: overview, orders, kitchen, menu, branches,
                       #   coupons+tiers, customers, reports, login
    api/               # ~30 JSON endpoints (see docs/API.md)
  components/          # design system + shared UI
public/                # PWA manifest, service worker, offline page, icons
tests/                 # vitest suites: pricing, coupons, geo, loyalty
docs/API.md            # full API reference
```

## Database

28 tables: `User, CustomerProfile, Address, Branch, BranchHours, DeliveryZone, Category, MenuItem, MenuItemVariant, AddOn, BranchMenuItem, Cart, CartItem, Order, OrderItem, Payment, Refund, Coupon, CouponRedemption, LoyaltyTier, LoyaltyTransaction, CustomerMetrics, Review, SupportTicket, StaffBranchAssignment, DeliveryAgent, Notification, AuditLog, OtpCode`.

Orders snapshot item names/prices at purchase time, so menu edits never corrupt history. Pseudo-enum values live in `src/lib/constants.ts`; JSON-ish columns are suffixed `Json` — both keep the schema portable between SQLite, PostgreSQL and MySQL.

### Switching to PostgreSQL

1. `prisma/schema.prisma` → `provider = "postgresql"`
2. `.env` → `DATABASE_URL="postgresql://USER:PASS@HOST:5432/dilkhush"`
3. `npx prisma migrate dev` && `npm run db:seed`

### Switching to MySQL / MariaDB (e.g. cPanel hosting)

Use **`prisma/schema.mysql.prisma`** instead of editing the main schema — it's a MySQL-sized copy (MySQL needs explicit column widths on long text fields that SQLite/Postgres don't). Full step-by-step cPanel walkthrough: **[docs/DEPLOY_CPANEL.md](docs/DEPLOY_CPANEL.md)**. Quick version:

```bash
# .env → DATABASE_URL="mysql://USER:PASS@HOST:3306/dilkhush"
npm run mysql:push     # creates tables + generates the MySQL client
npm run build
npm run db:seed
```

## Environment variables

All documented with comments in **`.env.example`** — copy it to `.env` and fill in. Highlights:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | SQLite file (dev) or Postgres URL (prod) |
| `SESSION_SECRET` | 32+ random chars signing the auth cookie — **must** change for prod |
| `OTP_PROVIDER` | `console` (dev: OTP shown on screen/terminal) or `msg91` + `MSG91_*` keys |
| `PAYMENT_PROVIDER` | `cod` (v1) or `razorpay` + `RAZORPAY_*` keys |
| `MAPS_PROVIDER` | `haversine` (built-in estimate) or `google` + restricted keys |
| `NOTIFY_SMS_ENABLED` etc. | Feature-flags for SMS / WhatsApp / Email channels |

Never commit `.env`; no secret ever reaches frontend code.

## Security

Server-side validation (zod) on every input · all prices/coupons/fees recomputed server-side · bcrypt staff passwords · hashed OTPs with 5-min expiry, 5-attempt cap, 30 s resend cooldown, per-phone and per-IP rate limits · login and order-placement rate limiting · HTTP-only `SameSite=Lax` `Secure` session cookies (CSRF defence) · role guards + branch scoping on every admin endpoint · validated status transitions · SQLi impossible via Prisma parameterised queries · XSS mitigated by React escaping + input length caps · COD-abuse restriction per customer · audit logging · webhook-verification flag ready for payments.

## Testing

```bash
npm test        # 32 unit tests across 4 suites
```

Covers: pricing breakdowns, delivery-fee tiers & free-delivery rules, discount/credit capping, coupon eligibility (limits, schedules, windows, targeting) and reward caps, best-coupon ranking, serviceability (radius + PIN whitelist), loyalty earning/redemption/tier assignment. An end-to-end API smoke test (OTP → order → accept → deliver → points) was run against the live server during development.

## Going to production

1. PostgreSQL (above) + automated database backups
2. Strong `SESSION_SECRET`; change **all** seeded staff passwords; delete the test customer
3. Real SMS provider (`OTP_PROVIDER=msg91`) and a CAPTCHA (hCaptcha/Turnstile) on `/api/auth/otp/send`
4. HTTPS (cookies are `Secure` in production builds)
5. Replace placeholder branch data (dashboard), food photos (`MenuItem.imageUrl` + object storage), and PNG app icons
6. Redis-backed rate limiter if running multiple instances (`src/lib/rate-limit.ts` is per-process)
7. Restricted Google Maps keys if enabling `MAPS_PROVIDER=google`
8. Error monitoring (e.g. Sentry) — API errors already log server-side

## Troubleshooting

| Symptom | Fix |
|---|---|
| Branches show **Closed** | It's outside 11:00–23:00 IST. Owner → Branches → Open status → **Force open** |
| Didn't receive an OTP | Dev mode shows it on the login screen and in the terminal running `npm run dev` |
| **Checkout blocked** | Cart below branch minimum order, or address outside radius/PIN list — the exact reason is shown in the bill area |
| Admin pages redirect to login | Staff session expired (12 h) — sign in again |
| Want a clean slate | `npm run db:reset` |
| Port 3000 busy | `npm run dev -- -p 3001` |

## Prepared for later activation

Schema and hooks already exist for: online payments (Razorpay), delivery-agent app with live location, WhatsApp/SMS campaigns, referral rewards (codes already issued), gift cards/store credit (credit field live via refunds), ingredient-level inventory, dine-in QR ordering, table reservations, catering enquiries, corporate accounts, subscription meals, and a Hindi interface (menu items already store `nameHindi`).

---

📚 **Full API reference:** [docs/API.md](docs/API.md)
