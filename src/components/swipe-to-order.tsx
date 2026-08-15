"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How far along the track the knob has to be released for the order to fire.
 * Deliberately short of the end: on a phone the last few pixels are where a
 * thumb runs out of travel, and stopping at 96% should not read as "changed my
 * mind".
 */
const COMMIT_AT = 0.9;

/** Gap between the knob and the inside of the track, in px — mirrors the CSS. */
const PAD = 5;

interface Props {
  /** The resting invitation, e.g. "Swipe to place order · ₹640". */
  label: string;
  /** Replaces the label once the swipe has committed. */
  busyLabel: string;
  disabled?: boolean;
  busy?: boolean;
  /**
   * Bump this to spring the knob back to the start — the parent does it when
   * the order was refused, so the customer can try again without reloading.
   */
  resetSignal?: number;
  onConfirm: () => void;
}

/**
 * Swipe-to-confirm for the one irreversible action in the app.
 *
 * A tap is too cheap for "place this order and charge me": the whole point is
 * that the gesture takes a deliberate second. Keyboard users get the same
 * commitment without the drag — Enter, Space or a few taps of ArrowRight walk
 * the knob across and fire the same handler, so nothing here is mouse-only.
 */
export function SwipeToOrder({
  label,
  busyLabel,
  disabled = false,
  busy = false,
  resetSignal = 0,
  onConfirm,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLButtonElement>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [committed, setCommitted] = useState(false);
  /** Pointer x minus knob x at the moment the drag started. */
  const grabOffset = useRef(0);
  const travel = useRef(1);
  const timer = useRef<number | null>(null);

  const measure = useCallback(() => {
    const track = trackRef.current;
    const knob = knobRef.current;
    if (!track || !knob) return 1;
    return Math.max(1, track.clientWidth - knob.offsetWidth - PAD * 2);
  }, []);

  // The parent refuses an order by bumping the signal; the control has to look
  // untouched again or there is no obvious way to retry.
  useEffect(() => {
    if (resetSignal === 0) return;
    setX(0);
    setDragging(false);
    setCommitted(false);
  }, [resetSignal]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  // A rotation mid-swipe changes how far the knob can go; without this the fill
  // and the knob would disagree about where the end of the track is.
  useEffect(() => {
    const onResize = () => {
      travel.current = measure();
      setX((cur) => Math.min(cur, travel.current));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  const locked = disabled || busy || committed;

  /** Runs the knob to the end, then fires — used by the keyboard path. */
  const rushAndConfirm = useCallback(() => {
    travel.current = measure();
    setCommitted(true);
    setX(travel.current);
    timer.current = window.setTimeout(onConfirm, 220);
  }, [measure, onConfirm]);

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (locked) return;
    travel.current = measure();
    grabOffset.current = e.clientX - x;
    knobRef.current?.setPointerCapture(e.pointerId);
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    const next = e.clientX - grabOffset.current;
    setX(Math.min(travel.current, Math.max(0, next)));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!dragging) return;
    setDragging(false);
    if (knobRef.current?.hasPointerCapture(e.pointerId))
      knobRef.current.releasePointerCapture(e.pointerId);
    if (x / travel.current >= COMMIT_AT) {
      setCommitted(true);
      setX(travel.current);
      onConfirm();
    } else {
      setX(0);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (locked) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      rushAndConfirm();
      return;
    }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      travel.current = measure();
      const step = travel.current / 4;
      const next = Math.min(
        travel.current,
        Math.max(0, x + (e.key === "ArrowRight" ? step : -step))
      );
      if (next >= travel.current) rushAndConfirm();
      else setX(next);
    }
  };

  const progress = Math.min(1, x / travel.current);
  const state = disabled ? "disabled" : committed || busy ? "committed" : dragging ? "dragging" : "idle";

  return (
    <div
      ref={trackRef}
      className="swipe"
      data-state={state}
      // The knob is animated by transform, so the fill is sized off the same
      // pixel value rather than a second, subtly different measurement.
      style={
        {
          "--x": `${x}px`,
          "--p": progress,
          // Snapping back should spring; following a finger must not lag it.
          "--swipe-ease": dragging ? "0ms" : "420ms",
        } as React.CSSProperties
      }
    >
      <div className="swipe__fill" aria-hidden />

      <p className="swipe__label" aria-hidden>
        {committed || busy ? (
          busyLabel
        ) : (
          <>
            {label}
            <span className="swipe__chevrons">
              <span>›</span>
              <span>›</span>
              <span>›</span>
            </span>
          </>
        )}
      </p>

      <button
        ref={knobRef}
        type="button"
        className="swipe__knob"
        disabled={disabled}
        aria-label={
          committed || busy
            ? busyLabel
            : `${label}. Swipe right, or press Enter, to confirm.`
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
      >
        {committed || busy ? (
          <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
            <path
              d="M5 12.5 10 17.5 19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
            <path
              d="M8 5.5 14.5 12 8 18.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </button>
    </div>
  );
}
