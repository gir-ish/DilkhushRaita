# Deploying to cPanel (dilkhushraita.com)

For a cPanel host with: **MySQL database**, **"Setup Node.js App"** support, and **SSH/Terminal access**. If your host lacks any of these, see the "If something's missing" section at the bottom.

This deploys the app using cPanel's Node.js hosting (Phusion Passenger), which needs a small wrapper script (`server.js`, already included) instead of running `next start` directly — Passenger starts your app by requiring a plain script, not a CLI command.

---

## 1. Get the code onto the server

Easiest with SSH + git (if the repo is on GitHub/GitLab):
```bash
cd ~
git clone <your-repo-url> dilkhushdhaba
cd dilkhushdhaba
```
No git? Zip the project locally (exclude `node_modules`, `.next`, `dev.db`) and upload/extract via cPanel **File Manager**, into `~/dilkhushdhaba` (a folder **outside** `public_html` — the Node.js App feature handles routing itself, the app files don't need to sit in the web root).

## 2. Create the database in cPanel (if not already done)

**MySQL® Databases** → create a database (e.g. `dilkhush`) and a user with **all privileges** on it. cPanel prefixes both with your account username, e.g.:
- Database: `cpaneluser_dilkhush`
- User: `cpaneluser_dbuser`

Note the database name, username, and password — you'll need them in step 4.

## 3. Create the Node.js App

cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
|---|---|
| Node.js version | Highest available, **20.x preferred** (minimum 18.18) |
| Application mode | Production |
| Application root | `dilkhushdhaba` (the folder from step 1) |
| Application URL | `dilkhushraita.com`, path `/` |
| Application startup file | `server.js` |

Click **Create**. cPanel shows a command like:
```
source /home/USERNAME/nodevenv/dilkhushdhaba/20/bin/activate && cd /home/USERNAME/dilkhushdhaba
```
**Copy this exact command** — you must run it at the start of every SSH session before running any `npm`/`npx` command below. It switches your shell to the correct Node version cPanel provisioned for this app (skipping it risks using the server's system Node, which may be too old or missing entirely).

## 4. Configure environment variables

In the same Node.js App page, scroll to **Environment variables** and add each of these (or alternatively, `nano .env` in the app root via SSH and paste them as a file — either works, since Next.js reads `.env` directly too):

```env
DATABASE_URL="mysql://cpaneluser_dbuser:YOUR_DB_PASSWORD@localhost:3306/cpaneluser_dilkhush"
SESSION_SECRET="<generate with the command below>"
COOKIE_SECURE="true"
OTP_PROVIDER="console"
OTP_BYPASS="true"
NEXT_PUBLIC_OTP_BYPASS="true"
PAYMENT_PROVIDER="cod"
MAPS_PROVIDER="haversine"
NOTIFY_SMS_ENABLED="false"
NOTIFY_WHATSAPP_ENABLED="false"
NOTIFY_EMAIL_ENABLED="false"
NEXT_PUBLIC_APP_NAME="DilKhush Dhaba – Raita Wala"
NEXT_PUBLIC_BASE_URL="https://dilkhushraita.com"
```

Generate a real `SESSION_SECRET` (never reuse the dev placeholder):
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`OTP_BYPASS`/`NEXT_PUBLIC_OTP_BYPASS` are kept `"true"` per your current setup (sign-in without SMS). Flip both to `"false"` and set real `MSG91_*`/`FAST2SMS_*` values once DLT approval is done — see `docs/API.md` and the OTP section of `.env.example`.

> **NEXT_PUBLIC_ variables are baked in at build time.** Set them *before* running `npm run build` in step 6, not after.

## 5. Enable HTTPS

cPanel → **SSL/TLS Status** → run **AutoSSL** for `dilkhushraita.com` (free, usually completes in a few minutes). This is required — `COOKIE_SECURE="true"` means sign-in cookies only work over HTTPS; without SSL, login will silently fail exactly like the plain-HTTP issue we hit testing locally.

## 6. Install, build, and create the database tables

In SSH, after running the `source .../activate` command from step 3:

```bash
npm install
npm run mysql:push       # creates all tables in your MySQL database
npm run build             # builds the production app
```

`mysql:push` reads `prisma/schema.mysql.prisma` (the MySQL-flavoured version of the schema — sized correctly for MySQL's text-column limits) and both creates every table **and** generates the matching Prisma Client in one step. `npm run build` must run *after* this, so the build picks up the MySQL client rather than the SQLite one used locally.

## 7. ⚠️ Before seeding — change the placeholder passwords

`prisma/seed.ts` creates staff accounts with placeholder passwords (`Owner@123` etc.) that are now public knowledge (they're in this project's README). **Edit that file locally and change every password** before seeding a real, live database:

```ts
["owner@dilkhush.test", "Owner@123", "Om Prakash (Owner)", "OWNER", []],
```
→ change `"Owner@123"` (and the rest) to strong unique passwords, and consider changing the placeholder emails too (`owner@dilkhush.test` → your real email). Re-upload/`git pull` the edited file to the server before the next step. Branch addresses/coordinates/phone numbers are also placeholders in there but those are safe to leave — you'll edit them live from **Branches** in the dashboard after launch, no code changes needed.

## 8. Seed starter data

```bash
npm run db:seed
```
This populates both branches, the full menu, your (now-changed) staff logins, and starter coupons/loyalty tiers into the live MySQL database.

## 9. Start the app

Back in cPanel's **Setup Node.js App** page, click **Restart** on your application. Visit **https://dilkhushraita.com** — you should see the DilKhush Dhaba homepage.

Sign in at `/admin/login` with your new owner credentials, and check **Branches** to replace the placeholder Rohini/NSP addresses and coordinates with the real ones.

## After every future code update

```bash
source /home/USERNAME/nodevenv/dilkhushdhaba/20/bin/activate && cd /home/USERNAME/dilkhushdhaba
git pull                                    # or re-upload changed files
npm install                                 # only if dependencies changed
npm run mysql:generate                      # only if prisma/schema.mysql.prisma changed
npm run build
```
Then click **Restart** in the Node.js App page (Passenger caches the running process — it won't pick up new code until restarted).

If you ever change `prisma/schema.mysql.prisma` itself (new fields, new tables), run `npm run mysql:push` again before rebuilding, to apply the change to the live database.

---

## If something's missing

- **No "Setup Node.js App" in cPanel** → your host is PHP-only shared hosting; this app can't run there. Options: ask your host to enable it (some do on request), or move to a Node-friendly host (Railway, Render, a VPS, or a cPanel plan advertised as supporting Node.js).
- **No SSH/Terminal access** → some Node.js App setups let you run `npm install` via a button in the cPanel UI, but `npx prisma db push` and `npm run build` are hard to do without a shell. Ask your host to enable Terminal (many include it standard; some gate it behind a support ticket).
- **Only MySQL 5.6 available** (rare, older hosts) → ask your host to upgrade; MySQL 5.7+/MariaDB 10.2+ is expected. Check via `mysql --version` in SSH.
