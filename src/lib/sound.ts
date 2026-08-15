/**
 * Alert tones for the dashboard and the customer's order page.
 *
 * Synthesised with the Web Audio API rather than shipped as audio files: a new
 * order has to be audible the instant it lands, and a file still downloading is
 * a beep that never happens. Nothing here throws — a silent alert is a nuisance,
 * a crashed order queue is not.
 */

interface Note {
  freq: number;
  /** Seconds from the start of the tone. */
  at: number;
  /** Seconds. */
  dur: number;
  /** 0–1, multiplied by the tone's own volume. */
  gain?: number;
  type?: OscillatorType;
}

/**
 * Each tone has to be recognisable without looking at the screen — a cashier
 * hears "that was taken" and "something new came in" as different events.
 */
export type ToneName = "newOrder" | "success" | "ready" | "status" | "error";

const TONES: Record<ToneName, Note[]> = {
  /** A new order is waiting to be accepted. Repeats so it carries across a kitchen. */
  newOrder: [
    { freq: 784, at: 0, dur: 0.16 }, { freq: 1046, at: 0.14, dur: 0.3 },
    { freq: 784, at: 0.5, dur: 0.16 }, { freq: 1046, at: 0.64, dur: 0.3 },
    { freq: 784, at: 1.0, dur: 0.16 }, { freq: 1046, at: 1.14, dur: 0.4 },
  ],
  /** An action landed: order billed, tab opened, status moved. */
  success: [
    { freq: 659, at: 0, dur: 0.12 }, { freq: 988, at: 0.1, dur: 0.24 },
  ],
  /** Food is up. Brighter than success — it calls someone over. */
  ready: [
    { freq: 1046, at: 0, dur: 0.1 }, { freq: 1318, at: 0.09, dur: 0.1 },
    { freq: 1568, at: 0.18, dur: 0.32 },
  ],
  /** A quiet nudge for the customer: their order moved a step. */
  status: [
    { freq: 880, at: 0, dur: 0.28, gain: 0.7 },
  ],
  /** Something was refused. Falling, and deliberately blunt. */
  error: [
    { freq: 392, at: 0, dur: 0.16, type: "triangle" },
    { freq: 294, at: 0.15, dur: 0.32, type: "triangle" },
  ],
};

/** New orders have to beat a kitchen extractor fan; the rest are feedback. */
const VOLUME: Record<ToneName, number> = {
  newOrder: 0.5,
  ready: 0.4,
  success: 0.28,
  status: 0.3,
  error: 0.3,
};

const MUTE_KEY = "dk.sound.muted";
/** Fired on the window whenever the mute preference changes, so every toggle in the tab agrees. */
export const SOUND_EVENT = "dk-sound-pref";

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  // One context for the whole tab, deliberately. Browsers cap how many a page
  // may create (Chrome stops at six), so a fresh context per beep goes silent
  // after the first handful of orders — exactly when a busy counter needs it.
  if (!ctx) {
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }
  }
  return ctx;
}

/**
 * Wake the audio context.
 *
 * A context created before the page has been touched starts suspended, so the
 * very first new-order tone — the one that matters most — would be silent.
 * Must be called from inside a real user gesture to have any effect.
 */
export function primeAudio(): void {
  const c = audio();
  if (c && c.state === "suspended") void c.resume();
}

/** True once tones will actually be heard. False means the page still needs a tap. */
export function audioReady(): boolean {
  return ctx?.state === "running";
}

/** Prime on whatever the first interaction happens to be, so nobody has to be told. */
export function primeOnFirstGesture(): () => void {
  if (typeof window === "undefined") return () => {};
  const wake = () => {
    primeAudio();
    window.dispatchEvent(new Event(SOUND_EVENT));
  };
  const opts = { once: true, passive: true } as const;
  window.addEventListener("pointerdown", wake, opts);
  window.addEventListener("keydown", wake, opts);
  return () => {
    window.removeEventListener("pointerdown", wake);
    window.removeEventListener("keydown", wake);
  };
}

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    // Private mode or blocked storage: default to audible.
    return false;
  }
}

export function setMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(SOUND_EVENT));
}

/** Play one of the named tones. Silent — never throwing — if audio is unavailable or muted. */
export function playTone(name: ToneName): void {
  if (isMuted()) return;
  const c = audio();
  if (!c) return;
  if (c.state === "suspended") void c.resume();
  try {
    const t0 = c.currentTime + 0.01;
    const volume = VOLUME[name];
    for (const n of TONES[name]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.connect(gain);
      gain.connect(c.destination);
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.freq;
      const peak = volume * (n.gain ?? 1);
      // Ramped rather than switched on: an instant start on a square-ish edge
      // clicks through cheap tablet speakers.
      gain.gain.setValueAtTime(0.0001, t0 + n.at);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.dur);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.dur + 0.02);
    }
  } catch {}
}

/**
 * A desktop notification, if the user has already allowed them.
 *
 * Never asks here: permission prompts belong on a button the user pressed.
 */
export function notify(title: string, body: string, tag?: string): void {
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    // `tag` collapses repeats — ten polls of the same order must not stack up
    // ten notifications.
    new Notification(title, { body, tag, icon: "/icon.svg" });
  } catch {}
}

/** Ask for notification permission. Call from a click — Firefox ignores it otherwise. */
export async function askNotifyPermission(): Promise<boolean> {
  try {
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    return (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}
