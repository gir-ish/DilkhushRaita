/**
 * The dashboard's new-order chime, rendered to a file.
 *
 * The website synthesises it in the browser, which is right there — a file
 * still downloading is a beep that never happens. The Android app cannot do
 * that: it has to ring with no page open and no audio context, from a file
 * bundled in the APK.
 *
 * So the same notes and the same envelope are rendered here instead, from the
 * definitions in src/lib/sound.ts, rather than someone recording the speaker
 * and calling it close enough. Re-run it if the chime ever changes:
 *
 *   node scripts/render-chime.mjs
 */
import { writeFileSync } from "node:fs";

// Copied deliberately, not imported: src/lib/sound.ts is browser code that
// reaches for `window` on load. Keep the two in step by hand — there is one
// tone here, and it has not changed since it was written.
const NOTES = [
  { freq: 784, at: 0, dur: 0.16 },
  { freq: 1046, at: 0.14, dur: 0.3 },
  { freq: 784, at: 0.5, dur: 0.16 },
  { freq: 1046, at: 0.64, dur: 0.3 },
  { freq: 784, at: 1.0, dur: 0.16 },
  { freq: 1046, at: 1.14, dur: 0.4 },
];
const VOLUME = 0.5;

const RATE = 44100;
/** A beat of quiet after the last note, so a looping alarm has a pulse. */
const TAIL = 0.45;
const length = Math.ceil((1.54 + TAIL) * RATE);
const buf = new Float32Array(length);

/*
 * The browser's gain curve exactly: silence to peak over 15ms, then back down
 * across the note. Exponential both ways — an instant start clicks through a
 * cheap speaker, which is the whole reason the ramp is there.
 */
const FLOOR = 0.0001;
const ATTACK = 0.015;

for (const n of NOTES) {
  const start = Math.floor(n.at * RATE);
  const end = Math.floor((n.at + n.dur) * RATE);
  for (let i = start; i < end && i < length; i++) {
    const t = (i - start) / RATE;
    const peak = VOLUME * (n.gain ?? 1);
    let g;
    if (t < ATTACK) g = FLOOR * Math.pow(peak / FLOOR, t / ATTACK);
    else g = peak * Math.pow(FLOOR / peak, (t - ATTACK) / (n.dur - ATTACK));
    buf[i] += Math.sin(2 * Math.PI * n.freq * t) * g;
  }
}

// 16-bit mono PCM, which every Android version plays without asking questions.
const data = Buffer.alloc(length * 2);
for (let i = 0; i < length; i++) {
  const s = Math.max(-1, Math.min(1, buf[i]));
  data.writeInt16LE(Math.round(s * 32767), i * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + data.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20); // PCM
header.writeUInt16LE(1, 22); // mono
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(data.length, 40);

const out = "mobile/app/src/main/res/raw/new_order.wav";
writeFileSync(out, Buffer.concat([header, data]));
console.log(`${out} — ${(length / RATE).toFixed(2)}s, ${(data.length / 1024).toFixed(0)}KB`);
