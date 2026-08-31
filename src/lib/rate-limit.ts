/**
 * Simple in-memory sliding-window rate limiter.
 * NOTE (production): replace with Redis/Upstash when running more than one
 * server instance — this map is per-process.
 */
const buckets = new Map<string, number[]>();

/**
 * Ceiling on how many distinct keys are tracked at once.
 *
 * The keys include client-supplied values, so without a cap someone rotating a
 * header could grow this map until the process runs out of memory. When it is
 * hit the coldest entries are dropped: a limiter that forgets the quietest
 * callers is survivable, a dead server is not.
 */
const MAX_KEYS = 20_000;

/**
 * Sweeping costs a pass over every key, so it must not happen per request:
 * doing that once the map is full would turn a flood into a self-inflicted
 * denial of service, each request paying to scan the mess left by the last.
 * Instead the map is allowed to run over its ceiling, then cut back in one go.
 */
const SWEEP_AT = MAX_KEYS + 5_000;

function prune(now: number, windowMs: number) {
  for (const [k, hits] of buckets) {
    // A bucket whose newest hit is older than the window can never refuse
    // anything again, so it is dead weight.
    if (hits.length === 0 || now - hits[hits.length - 1] >= windowMs) buckets.delete(k);
  }
  if (buckets.size <= MAX_KEYS) return;
  // Still over after dropping the expired: evict the coldest until it fits.
  const byAge = [...buckets.entries()].sort(
    (a, b) => a[1][a[1].length - 1] - b[1][b[1].length - 1]
  );
  for (const [k] of byAge.slice(0, buckets.size - MAX_KEYS)) buckets.delete(k);
}

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size >= SWEEP_AT) prune(now, windowMs);
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return false;
  }
  arr.push(now);
  buckets.set(key, arr);
  return true;
}

/**
 * How many proxies of ours sit in front of the app.
 *
 * On cPanel/Passenger that is the one Apache in front, which appends the real
 * peer address to X-Forwarded-For. Override with TRUSTED_PROXY_HOPS if the site
 * is put behind another proxy (Cloudflare, a load balancer) later.
 */
function trustedHops(): number {
  const n = Number(process.env.TRUSTED_PROXY_HOPS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/**
 * The client's address, as far as it can be trusted.
 *
 * X-Forwarded-For is a list that each proxy APPENDS to, so the entries on the
 * left are whatever the caller sent — freely forged — and only the ones our own
 * proxies added can be believed. Reading the leftmost entry, the obvious thing
 * to do, hands an attacker a new identity per request and with it an unlimited
 * number of password guesses.
 *
 * So count in from the right instead: with one proxy in front, the last entry
 * is the address Apache saw the connection come from.
 *
 * Even this is only a hint. A forged header cannot be told apart from a real
 * one when the proxy chain is misconfigured, which is why every limit that
 * actually protects a secret is ALSO keyed on the thing being attacked — the
 * account, the phone number, the device — using rateLimitIdentity below.
 */
export function clientIp(req: Request): string {
  const h = req.headers;
  const xff = h.get("x-forwarded-for");
  if (xff) {
    const parts = xff
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const idx = Math.max(0, parts.length - trustedHops());
      return parts[idx];
    }
  }
  // Set by the proxy itself rather than forwarded from the caller, so it is
  // the better fallback of the two.
  return h.get("x-real-ip")?.trim() || "local";
}

/**
 * Failure counting for something the caller cannot swap out.
 *
 * An attacker guessing one account's password has to keep sending that same
 * email, and someone guessing an OTP has to keep sending that same number, so
 * a count kept against it holds however many addresses they rotate through.
 * This is the real guarantee; the IP-keyed limit beside it only stops one
 * source from drowning everyone else.
 *
 * Only failures are counted, and a success wipes the slate. Counting every
 * attempt would hand anyone a way to lock the owner out of their own dashboard
 * by typing a wrong password ten times, which trades one denial of service for
 * another.
 *
 * `kind` separates the namespaces so an email can never collide with a phone.
 */
function identityKey(kind: string, identity: string) {
  return `${kind}:id:${identity.trim().toLowerCase()}`;
}

/** True while this identity may still be tried. Records nothing. */
export function identityAllowed(
  kind: string,
  identity: string,
  max: number,
  windowMs: number
): boolean {
  const now = Date.now();
  const hits = (buckets.get(identityKey(kind, identity)) ?? []).filter(
    (t) => now - t < windowMs
  );
  return hits.length < max;
}

/** Call after a rejected attempt — this is what eventually closes the door. */
export function recordIdentityFailure(kind: string, identity: string, windowMs: number) {
  const now = Date.now();
  const key = identityKey(kind, identity);
  if (buckets.size >= SWEEP_AT) prune(now, windowMs);
  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);
}

/** Call after a genuine sign-in, so an honest typo never accumulates. */
export function clearIdentityFailures(kind: string, identity: string) {
  buckets.delete(identityKey(kind, identity));
  lockouts.delete(identityKey(kind, identity));
}

/*
 * Lockouts, kept apart from the failure counts on purpose.
 *
 * A sliding window forgets: three wrong passwords inside five minutes stops
 * mattering once those five minutes pass, so a patient script simply waits and
 * carries on. A lockout is the opposite — it is earned inside the window and
 * then has to outlive it, which is what turns "slow down" into "stop".
 */
const lockouts = new Map<string, number>();

export interface LockState {
  locked: boolean;
  /** Milliseconds until it lifts. Zero when not locked. */
  retryAfterMs: number;
}

/** Is this identity currently locked out? Records nothing. */
export function identityLock(kind: string, identity: string): LockState {
  const until = lockouts.get(identityKey(kind, identity));
  if (until === undefined) return { locked: false, retryAfterMs: 0 };
  const left = until - Date.now();
  if (left <= 0) {
    lockouts.delete(identityKey(kind, identity));
    return { locked: false, retryAfterMs: 0 };
  }
  return { locked: true, retryAfterMs: left };
}

/**
 * Records a failure and locks the identity out once too many land inside the
 * window. Returns the state after recording, so the caller can say how long.
 *
 * Failures only, and cleared by a real sign-in — counting every attempt would
 * hand anyone who knows an email address a way to shut that person out on
 * demand.
 */
export function recordFailureWithLockout(
  kind: string,
  identity: string,
  max: number,
  windowMs: number,
  lockoutMs: number
): LockState {
  const now = Date.now();
  const key = identityKey(kind, identity);
  if (buckets.size >= SWEEP_AT) prune(now, windowMs);

  const hits = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  buckets.set(key, hits);

  if (hits.length >= max) {
    lockouts.set(key, now + lockoutMs);
    // The count is spent: it has become the lockout, and leaving it behind
    // would re-lock on the first failure after the block lifts.
    buckets.delete(key);
    return { locked: true, retryAfterMs: lockoutMs };
  }
  return { locked: false, retryAfterMs: 0 };
}

/** How many tries are left before the door shuts. */
export function triesLeft(kind: string, identity: string, max: number, windowMs: number): number {
  const now = Date.now();
  const hits = (buckets.get(identityKey(kind, identity)) ?? []).filter((t) => now - t < windowMs);
  return Math.max(0, max - hits.length);
}

/** Test seam: forget every recorded hit. */
export function __resetRateLimits() {
  buckets.clear();
  lockouts.clear();
}

/** Test seam: how many keys are being tracked right now. */
export function __bucketCount() {
  return buckets.size;
}
