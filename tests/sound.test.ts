import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The alert tones are the only thing telling a busy counter that an order has
 * landed, so the parts that can silently stop working are worth pinning down:
 * the shared audio context, the mute switch, and never throwing.
 */

class FakeOscillator {
  type = "sine";
  frequency = { value: 0 };
  connect() {}
  start() {}
  stop() {}
}

class FakeGain {
  gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {} };
  connect() {}
}

class FakeAudioContext {
  static made = 0;
  static last: FakeAudioContext | null = null;
  state: "suspended" | "running" = "running";
  currentTime = 0;
  destination = {};
  oscillators = 0;
  resumed = 0;

  constructor() {
    FakeAudioContext.made++;
    FakeAudioContext.last = this;
  }
  createOscillator() {
    this.oscillators++;
    return new FakeOscillator();
  }
  createGain() {
    return new FakeGain();
  }
  resume() {
    this.resumed++;
    this.state = "running";
    return Promise.resolve();
  }
}

function fakeWindow(withAudio = true) {
  const store = new Map<string, string>();
  return {
    ...(withAudio ? { AudioContext: FakeAudioContext } : {}),
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
}

function install(withAudio = true) {
  FakeAudioContext.made = 0;
  FakeAudioContext.last = null;
  (globalThis as { window?: unknown }).window = fakeWindow(withAudio);
  vi.resetModules();
  return import("@/lib/sound");
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("playTone", () => {
  it("reuses one AudioContext however many orders arrive", async () => {
    const { playTone } = await install();
    // Chrome refuses to hand out more than six contexts per page. A fresh one
    // per beep therefore goes permanently silent partway through a dinner rush.
    for (let i = 0; i < 25; i++) playTone("newOrder");
    expect(FakeAudioContext.made).toBe(1);
  });

  it("schedules every note of the tone", async () => {
    const { playTone } = await install();
    playTone("newOrder");
    // Six notes: three repeats of a two-note chime.
    expect(FakeAudioContext.last?.oscillators).toBe(6);
    playTone("status");
    expect(FakeAudioContext.last?.oscillators).toBe(7);
  });

  it("plays nothing once muted, and plays again once unmuted", async () => {
    const { playTone, setMuted, isMuted } = await install();
    setMuted(true);
    expect(isMuted()).toBe(true);
    playTone("newOrder");
    expect(FakeAudioContext.last).toBeNull();

    setMuted(false);
    playTone("newOrder");
    expect(FakeAudioContext.last?.oscillators).toBe(6);
  });

  it("wakes a context the browser suspended before the page was touched", async () => {
    const { playTone, primeAudio, audioReady } = await install();
    playTone("success"); // creates the context
    const ctx = FakeAudioContext.last!;
    ctx.state = "suspended";
    expect(audioReady()).toBe(false);
    primeAudio();
    expect(ctx.resumed).toBe(1);
    expect(audioReady()).toBe(true);
  });

  it("stays silent rather than throwing where Web Audio is missing", async () => {
    const { playTone, primeAudio, audioReady } = await install(false);
    expect(() => playTone("newOrder")).not.toThrow();
    expect(() => primeAudio()).not.toThrow();
    expect(audioReady()).toBe(false);
  });
});

describe("notify", () => {
  it("does nothing until the user has allowed notifications", async () => {
    const { notify } = await install();
    const made: string[] = [];
    class FakeNotification {
      static permission = "default";
      constructor(title: string) {
        made.push(title);
      }
    }
    (globalThis as { Notification?: unknown }).Notification = FakeNotification;

    notify("🆕 New order!", "1 waiting");
    expect(made).toEqual([]);

    FakeNotification.permission = "granted";
    notify("🆕 New order!", "1 waiting");
    expect(made).toEqual(["🆕 New order!"]);

    delete (globalThis as { Notification?: unknown }).Notification;
  });
});
