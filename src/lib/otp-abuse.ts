/**
 * Stops someone burning the SMS balance by requesting codes they never use.
 *
 * The attack is called SMS pumping and it costs real money: every send is two
 * credits, and a script walking a list of phone numbers spends them as fast as
 * the gateway will accept. The per-number cap in the database does not touch it
 * — each number is only asked once — and the whole-system hourly ceiling only
 * decides how large the bill gets before it stops.
 *
 * What separates the attacker from a customer is not volume. It is that a
 * customer READS the code and comes back with it. Someone harvesting sends
 * never does, and that is what is counted here.
 *
 * Deliberately forgiving of shared addresses. Indian mobile carriers put
 * thousands of subscribers behind one public IP, so a hard per-address quota
 * would lock out real customers in blocks; the rule that matters instead asks
 * whether ANY sign-in has succeeded from an address recently. On a carrier NAT
 * some always have. On an attacker's, none ever do.
 */

interface Activity {
  /** When each code was sent, for windowing. */
  sends: number[];
  /** Distinct numbers asked for, and when each was first seen. */
  numbers: Map<string, number>;
  /** When each successful verification happened. */
  verified: number[];
}

const activity = new Map<string, Activity>();

const WINDOW_MS = 60 * 60 * 1000;

/** Sends from one address in an hour. A real customer needs one, or two with a resend. */
const MAX_SENDS = 10;
/** Distinct numbers from one address in an hour. High enough for a family or a shared till. */
const MAX_NUMBERS = 5;
/**
 * How many codes may go unused before an address has to prove someone real is
 * behind it.
 *
 * This is the rule that actually bites. Three unread codes is a customer having
 * a bad time — wrong number, no signal, gave up — so three are allowed. The
 * fourth, with nothing ever verified, is someone spending money that is not
 * theirs.
 */
const MAX_UNVERIFIED_SENDS = 3;

/** Bounded like the rate limiter's map, for the same reason. */
const MAX_KEYS = 20_000;

function recent(times: number[], now: number) {
  return times.filter((t) => now - t < WINDOW_MS);
}

function get(ip: string, now: number): Activity {
  const a = activity.get(ip) ?? { sends: [], numbers: new Map(), verified: [] };
  a.sends = recent(a.sends, now);
  a.verified = recent(a.verified, now);
  for (const [num, t] of a.numbers) if (now - t >= WINDOW_MS) a.numbers.delete(num);
  return a;
}

function save(ip: string, a: Activity) {
  if (a.sends.length === 0 && a.verified.length === 0 && a.numbers.size === 0) {
    activity.delete(ip);
    return;
  }
  if (activity.size >= MAX_KEYS && !activity.has(ip)) {
    // Drop the coldest rather than grow without bound.
    const oldest = [...activity.entries()].sort(
      (x, y) => (x[1].sends[0] ?? 0) - (y[1].sends[0] ?? 0)
    )[0];
    if (oldest) activity.delete(oldest[0]);
  }
  activity.set(ip, a);
}

export interface OtpVerdict {
  allowed: boolean;
  /** Safe to show a customer: never says which rule, so it cannot be probed. */
  reason?: string;
}

/**
 * May this address have a code sent to this number right now?
 *
 * Records nothing — call recordSend after the message actually goes out, so a
 * request refused further down the line does not count against anyone.
 */
export function mayRequestOtp(ip: string, phone: string): OtpVerdict {
  const now = Date.now();
  const a = get(ip, now);

  const refuse = (why: string): OtpVerdict => {
    console.error(`[otp][abuse] refused ${ip}: ${why} (sends=${a.sends.length}, numbers=${a.numbers.size}, verified=${a.verified.length})`);
    // One wording for every rule. Telling an attacker which limit they hit
    // tells them how to stay under it.
    return { allowed: false, reason: "Too many code requests from here. Try again later." };
  };

  if (a.sends.length >= MAX_SENDS) return refuse("hourly send cap");
  if (!a.numbers.has(phone) && a.numbers.size >= MAX_NUMBERS) return refuse("too many distinct numbers");
  if (a.sends.length >= MAX_UNVERIFIED_SENDS && a.verified.length === 0)
    return refuse("codes requested but none ever used");

  return { allowed: true };
}

/** Call once a code has genuinely been handed to the gateway. */
export function recordOtpSend(ip: string, phone: string) {
  const now = Date.now();
  const a = get(ip, now);
  a.sends.push(now);
  if (!a.numbers.has(phone)) a.numbers.set(phone, now);
  save(ip, a);
}

/**
 * Call when a code is accepted. This is what marks an address as carrying real
 * customers, and it is what lifts the unverified block for everyone behind it.
 */
export function recordOtpVerified(ip: string) {
  const now = Date.now();
  const a = get(ip, now);
  a.verified.push(now);
  save(ip, a);
}

/** Test seam. */
export function __resetOtpAbuse() {
  activity.clear();
}

/** Test seam: what this address looks like right now. */
export function __otpActivity(ip: string) {
  const a = get(ip, Date.now());
  return { sends: a.sends.length, numbers: a.numbers.size, verified: a.verified.length };
}
