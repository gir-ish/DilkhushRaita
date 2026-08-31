"use client";

import { useEffect, useState } from "react";
import { billBytes, kotBytes, type PaperWidth, type TextScale } from "@/lib/escpos";
import { connectedPrinter, isSupported, printBytes } from "@/lib/bluetooth-printer";
import type { PrintableOrder } from "./print-sheet";

const WIDTH_KEY = "dk.print.width";
const SCALE_KEY = "dk.print.scale";

/**
 * Prints the slip straight to a Bluetooth thermal printer.
 *
 * Sits beside the ordinary Print button rather than replacing it: the browser
 * dialog is still the right answer on a desktop with a USB printer, and iOS has
 * no Web Bluetooth at all. This is the path that avoids Android's print dialog,
 * and with it the advertising line RawBT's free build stamps on every receipt.
 *
 * Paper width and text size are remembered per device, because they are a
 * property of the printer sitting on that counter, not of the order.
 */
export function BluetoothPrint({
  order,
  variant,
}: {
  order: PrintableOrder;
  variant: "bill" | "kot";
}) {
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [width, setWidth] = useState<PaperWidth>(32);
  const [scale, setScale] = useState<TextScale>("large");
  const [showSettings, setShowSettings] = useState(false);

  // Read on mount, not during render: the server has no localStorage, and
  // reading it in render would make the markup differ from the server's.
  useEffect(() => {
    setSupported(isSupported());
    try {
      const w = Number(localStorage.getItem(WIDTH_KEY));
      if (w === 32 || w === 48) setWidth(w);
      const s = localStorage.getItem(SCALE_KEY);
      if (s === "normal" || s === "large") setScale(s);
    } catch {
      // Blocked storage: the defaults are fine.
    }
  }, []);

  const remember = (w: PaperWidth, s: TextScale) => {
    setWidth(w);
    setScale(s);
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
      localStorage.setItem(SCALE_KEY, s);
    } catch {}
  };

  if (!supported) return null;

  const print = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const bytes =
        variant === "bill" ? billBytes(order, width, scale) : kotBytes(order, width, scale);
      const name = await printBytes(bytes);
      setDone(name);
      setTimeout(() => setDone(null), 4000);
    } catch (e) {
      // A cancelled chooser is a decision, not a fault worth shouting about.
      const msg = e instanceof Error ? e.message : "Could not print";
      setError(/cancelled|User cancelled|NotFoundError/i.test(msg) ? null : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={print}
        disabled={busy}
        className="btn-secondary !min-h-[44px]"
        title={
          connectedPrinter()
            ? `Print to ${connectedPrinter()!.name}`
            : "Connect a Bluetooth thermal printer"
        }
      >
        {busy ? "Printing…" : done ? "✓ Sent" : "📲 Bluetooth"}
      </button>
      <button
        onClick={() => setShowSettings((v) => !v)}
        className="btn-ghost !min-h-[44px] !bg-white/15 !text-white hover:!bg-white/25"
        aria-expanded={showSettings}
        title="Paper width and text size"
      >
        ⚙️
      </button>

      {(showSettings || error) && (
        <div className="w-full rounded-xl bg-white/95 p-3 text-sm text-maroon-900">
          {error && (
            <p role="alert" className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-red-900">
              {error}
            </p>
          )}
          {showSettings && (
            <div className="space-y-3">
              <div>
                <p className="mb-1 font-bold">Paper width</p>
                <div className="flex gap-2">
                  {([32, 48] as const).map((w) => (
                    <button
                      key={w}
                      onClick={() => remember(w, scale)}
                      aria-pressed={width === w}
                      className={`min-h-[38px] flex-1 rounded-lg border px-3 font-semibold ${
                        width === w
                          ? "border-maroon-600 bg-maroon-600 text-white"
                          : "border-maroon-800/20"
                      }`}
                    >
                      {w === 32 ? "58 mm" : "80 mm"}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 font-bold">Text size</p>
                <div className="flex gap-2">
                  {(
                    [
                      ["large", "Large"],
                      ["normal", "Normal"],
                    ] as const
                  ).map(([s, label]) => (
                    <button
                      key={s}
                      onClick={() => remember(width, s)}
                      aria-pressed={scale === s}
                      className={`min-h-[38px] flex-1 rounded-lg border px-3 font-semibold ${
                        scale === s
                          ? "border-maroon-600 bg-maroon-600 text-white"
                          : "border-maroon-800/20"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-maroon-800/70">
                  Large prints double height — same 32 characters a line, twice as tall to
                  read. It uses about half again as much paper.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
