"use client";

import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  SOUND_EVENT,
  askNotifyPermission,
  audioReady,
  isMuted,
  playTone,
  primeAudio,
  primeOnFirstGesture,
  setMuted,
} from "@/lib/sound";

/**
 * Turn the alert tones on or off, and — just as important — give the page the
 * one tap browsers demand before any sound is allowed out of it.
 *
 * Mounted in the dashboard header, so a screen left open on the counter is
 * always one tap away from being audible.
 */
export function SoundToggle({ className }: { className?: string }) {
  const [muted, setMutedState] = useState(false);
  const [ready, setReady] = useState(true);

  const sync = useCallback(() => {
    setMutedState(isMuted());
    setReady(audioReady());
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener(SOUND_EVENT, sync);
    // Any interaction with the page unlocks audio; nobody should have to be
    // told to press this button first.
    const stop = primeOnFirstGesture();
    return () => {
      window.removeEventListener(SOUND_EVENT, sync);
      stop();
    };
  }, [sync]);

  const toggle = async () => {
    const next = !muted;
    setMuted(next);
    if (!next) {
      primeAudio();
      // Confirm out loud. Silence after switching sound on tells you nothing
      // about whether the tablet's volume is up.
      playTone("success");
      await askNotifyPermission();
    }
    sync();
  };

  // Unmuted but still locked: the browser has not seen a gesture yet, so the
  // next new order would arrive in silence. Say so rather than pretend.
  const locked = !muted && !ready;

  return (
    <button
      onClick={toggle}
      aria-pressed={!muted}
      title={
        muted
          ? "Alert sounds are off"
          : locked
            ? "Tap to allow sound in this browser"
            : "Alert sounds are on"
      }
      className={cn(
        "rounded-xl px-3 py-2.5 text-sm font-semibold transition",
        locked && "animate-pulse",
        className
      )}
    >
      <span aria-hidden>{muted ? "🔕" : "🔔"}</span>
      <span className="sr-only">
        {muted ? "Turn alert sounds on" : "Turn alert sounds off"}
      </span>
    </button>
  );
}
