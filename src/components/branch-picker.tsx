"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/utils";
import { Badge, ErrorBox } from "./ui";
import { useCart } from "./cart-context";

interface BranchInfo {
  id: string;
  slug: string;
  name: string;
  address: string;
  phone?: string | null;
  lat?: number;
  lng?: number;
  open: boolean;
  openReason: string | null;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  minOrderValue: number;
  baseDeliveryFee?: number;
  deliveryFee?: number;
  freeDeliveryAbove: number | null;
  prepTimeMins?: number;
  distanceKm?: number;
  etaMins?: number;
  serviceable?: boolean | null;
  serviceReason?: string | null;
  busyMode?: boolean;
}

/**
 * Fold a locate or PIN-code answer into the list already on screen.
 *
 * /api/branches/locate returns distances and ETAs but not the branch's
 * coordinates or phone number, so replacing the list outright would make the
 * Directions and Call links vanish the moment someone pressed the very button
 * meant to help them find the place. Merging by id keeps both halves.
 */
function merge(prev: BranchInfo[] | null, next: BranchInfo[]): BranchInfo[] {
  if (!prev?.length) return next;
  const incoming = new Map(next.map((b) => [b.id, b]));
  const merged = prev.map((b) => ({ ...b, ...(incoming.get(b.id) ?? {}) }));
  for (const b of next) if (!merged.some((m) => m.id === b.id)) merged.push(b);
  return merged;
}

/**
 * Where to send someone who wants to walk or drive to the branch rather than
 * order from it. Coordinates when we have them — a name-and-address search is
 * a guess, and two dhabas on one road is exactly the case this has to get right.
 */
function directionsUrl(b: BranchInfo) {
  const dest = b.lat != null && b.lng != null ? `${b.lat},${b.lng}` : `${b.name}, ${b.address}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
}

export function BranchPicker() {
  const router = useRouter();
  const cart = useCart();
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [recommended, setRecommended] = useState<string | null>(null);
  /** What earned the crest, so the badge says why rather than just "⭐". */
  const [crest, setCrest] = useState("Recommended");
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pincode, setPincode] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    fetch("/api/branches")
      .then(async (r) => {
        const d = await r.json();
        // Without this an error response sets branches to undefined, which the
        // render below reads as "still loading" — a spinner that never ends.
        if (!r.ok || !Array.isArray(d.branches)) throw new Error(d.error ?? "Bad response");
        setBranches(d.branches);
      })
      .catch(() => {
        setBranches([]);
        setError("Could not load branches. Please refresh the page.");
      });
  }, []);

  /**
   * Nearest first, once anything is known about distance.
   *
   * Two branches in an unexplained order asks the customer to read both cards
   * before choosing. Sorted, the top card is the answer and the second is there
   * for the people who want the other side of town.
   */
  const ordered = useMemo(() => {
    if (!branches) return null;
    if (!branches.some((b) => b.distanceKm !== undefined)) return branches;
    return [...branches].sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
  }, [branches]);

  /** True once a real distance can be shown instead of a generic prep time. */
  const located = !!branches?.some((b) => b.distanceKm !== undefined);

  const findClosest = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError("Location is not supported on this device — use the PIN code option below.");
      setManualOpen(true);
      return;
    }
    setLocating(true);
    // Location permission is requested only now, after the user tapped the button.
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch("/api/branches/locate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          });
          const d = await res.json();
          if (!res.ok) throw new Error(d.error);
          setBranches((prev) => merge(prev, d.branches));
          setRecommended(d.recommendedBranchId);
          setCrest("Nearest to you");
          if (!d.recommendedBranchId)
            setError("You seem to be outside our delivery areas — pickup is still available!");
        } catch {
          setError("Could not calculate distances. Choose a branch manually.");
        } finally {
          setLocating(false);
        }
      },
      (err) => {
        setLocating(false);
        // Browsers block geolocation outright on non-HTTPS pages and report it
        // as PERMISSION_DENIED, so saying "you denied it" would be wrong.
        const insecure =
          typeof window !== "undefined" &&
          !window.isSecureContext &&
          location.hostname !== "localhost";
        setError(
          insecure
            ? "Location needs a secure (https) connection — enter your PIN code instead."
            : err.code === err.PERMISSION_DENIED
              ? "Location permission denied — enter your PIN code below instead."
              : err.code === err.TIMEOUT
                ? "Finding your location took too long — enter your PIN code below instead."
                : "Could not read your location — enter your PIN code below instead."
        );
        setManualOpen(true);
      },
      { timeout: 10000 }
    );
  };

  const checkPincode = async () => {
    setError(null);
    if (!/^\d{6}$/.test(pincode)) {
      setError("Enter a valid 6-digit PIN code");
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(`/api/branches?pincode=${encodeURIComponent(pincode)}`);
      const d = await res.json();
      if (!res.ok || !Array.isArray(d.branches))
        throw new Error(d.error ?? "Could not check that PIN code");

      setBranches((prev) => merge(prev, d.branches));
      const ok = d.branches.filter((b: BranchInfo) => b.serviceable && b.open);
      setRecommended(ok[0]?.id ?? null);
      setCrest(`Delivers to ${pincode}`);

      if (ok.length === 0) {
        // Separating these tells the customer something actionable instead of
        // implying we never deliver to them.
        const serviceableButShut = d.branches.some((b: BranchInfo) => b.serviceable && !b.open);
        setError(
          serviceableButShut
            ? `We do deliver to ${pincode}, but the branch is closed right now. Pickup and scheduling are still available.`
            : `PIN ${pincode} is outside our delivery areas right now — pickup is still available.`
        );
      }
    } catch (e) {
      // Leave the existing branch list on screen rather than blanking the page.
      setError(
        e instanceof Error && e.message
          ? e.message
          : "Could not check that PIN code. Please try again."
      );
    } finally {
      setChecking(false);
    }
  };

  const choose = (b: BranchInfo) => {
    if (cart.branchId && cart.branchId !== b.id && cart.lines.length > 0) {
      if (
        !confirm(
          `Your cart has items from ${cart.branchName}. Switching to ${b.name} will clear the cart. Continue?`
        )
      )
        return;
      cart.switchBranch({ id: b.id, slug: b.slug, name: b.name });
    }
    router.push(`/menu/${b.slug}`);
  };

  return (
    <section className="mx-auto max-w-5xl px-4 pb-8" aria-label="Choose a branch">
      {/* ----------------------------------------------------- find controls */}
      <div className="flex flex-col sm:flex-row gap-3 justify-center">
        <button
          onClick={findClosest}
          disabled={locating}
          className={`btn-primary sm:min-w-[15rem] ${locating ? "radar" : ""}`}
        >
          {locating ? "Finding you…" : "📍 Use my location"}
        </button>
        <button
          onClick={() => setManualOpen((v) => !v)}
          className="btn-outline"
          aria-expanded={manualOpen}
        >
          ✏️ Enter a PIN code
        </button>
      </div>

      {/* One line saying what those buttons buy you. Without it the cards look
          complete as they stand and most people press neither. */}
      {!located && (
        <p className="text-center text-sm text-maroon-800/60 mt-3">
          Either one fills in your real distance, delivery time and fee for both branches.
        </p>
      )}

      {manualOpen && (
        <div className="card p-5 max-w-md mx-auto mt-4 animate-fade-up">
          <label className="label" htmlFor="pincode">
            Delivery PIN code
          </label>
          <div className="flex gap-2">
            <input
              id="pincode"
              className="input"
              inputMode="numeric"
              autoFocus
              maxLength={6}
              placeholder="e.g. 110085"
              value={pincode}
              onChange={(e) => setPincode(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => e.key === "Enter" && !checking && checkPincode()}
            />
            <button
              onClick={checkPincode}
              disabled={checking || pincode.length !== 6}
              className="btn-secondary shrink-0"
            >
              {checking ? "Checking…" : "Check"}
            </button>
          </div>
          <p className="text-xs text-maroon-800/60 mt-2">
            You can add your full address with landmark at checkout.
          </p>
        </div>
      )}

      <div className="max-w-md mx-auto my-4">
        <ErrorBox message={error} />
      </div>

      {/* ------------------------------------------------------------- cards */}
      {!ordered ? (
        // The branch card layout is fixed and known, so placeholders in its
        // exact shape beat a spinner — nothing shifts when the data lands.
        <div
          className="grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto"
          role="status"
          aria-label="Loading branches…"
        >
          {[0, 1].map((i) => (
            <div key={i} className="card p-5 flex flex-col gap-3.5" aria-hidden>
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-6 w-1/2" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-12 w-full !rounded-xl" />
              <div className="skeleton h-3.5 w-2/3" />
              <div className="skeleton h-11 w-full mt-1 !rounded-xl" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto">
          {ordered.map((b, i) => (
            <article
              key={b.id}
              className={`branch-card reveal card card-hover overflow-hidden flex flex-col ${
                recommended === b.id
                  ? "!border-mustard-400 shadow-lift ring-1 ring-mustard-400/40"
                  : ""
              }`}
              style={{ "--i": i } as React.CSSProperties}
            >
              {/*
                Brass cap on the recommended branch — the eye needs one place to
                land when both are serviceable, and it names the reason, because
                "recommended by whom" is a fair question.

                It is ALWAYS rendered, and merely made invisible on the branch
                that did not win. Mounting it only on the winner would make that
                card's contents drop by the height of the strip the moment a
                location came back, so the two cards stopped lining up and every
                row below jumped. Reserving the space costs nothing and keeps
                both cards identical whether or not anything is recommended.
              */}
              <p
                aria-hidden={recommended !== b.id}
                className={`px-5 py-1.5 text-center text-[11px] font-bold uppercase tracking-kicker ${
                  recommended === b.id
                    ? "bg-gradient-to-r from-mustard-300 via-mustard-400 to-mustard-300 text-maroon-800"
                    : "invisible"
                }`}
              >
                ⭐ {recommended === b.id ? crest : "Recommended"}
              </p>

              <div className="p-5 flex flex-col gap-3 flex-1">
                {/* Status first: whether the kitchen is on is the one thing that
                    makes every other number on this card moot. */}
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-kicker">
                    <span className="status-pip" data-open={b.open} aria-hidden />
                    <span className={b.open ? "text-leaf-600" : "text-maroon-800/55"}>
                      {b.open ? "Open now" : (b.openReason ?? "Closed")}
                    </span>
                  </span>
                  {b.busyMode && <Badge tone="maroon">Busy</Badge>}
                </div>

                <div>
                  <h3 className="font-display text-fluid-xl font-semibold text-maroon-700 leading-snug sm:min-h-[2.75em]">
                    {b.name}
                  </h3>
                  <p className="text-sm text-maroon-800/65 leading-relaxed mt-1">{b.address}</p>
                </div>

                {/* The measured line. Once we know where the customer is, this
                    is the whole comparison; before that it still answers "how
                    long until food", which is the same question asked earlier. */}
                <div className="measure rounded-xl px-4 py-2.5 flex items-center justify-around gap-3 text-center">
                  {b.distanceKm !== undefined ? (
                    <>
                      <span className="min-w-0">
                        <span className="block font-display text-fluid-base font-semibold text-maroon-700 money">
                          ≈{b.distanceKm} km
                        </span>
                        <span className="block text-[10px] font-bold uppercase tracking-kicker text-maroon-800/55">
                          away
                        </span>
                      </span>
                      <span aria-hidden className="h-8 w-px bg-maroon-800/15" />
                      <span className="min-w-0">
                        <span className="block font-display text-fluid-base font-semibold text-maroon-700 money">
                          ~{b.etaMins} min
                        </span>
                        <span className="block text-[10px] font-bold uppercase tracking-kicker text-maroon-800/55">
                          to your door
                        </span>
                      </span>
                    </>
                  ) : (
                    <span>
                      <span className="block font-display text-fluid-base font-semibold text-maroon-700 money">
                        ~{b.prepTimeMins ?? 25} min
                      </span>
                      <span className="block text-[10px] font-bold uppercase tracking-kicker text-maroon-800/55">
                        kitchen time
                      </span>
                    </span>
                  )}
                </div>

                {/* Fees and limits, one line each — detail for the people who
                    read it, out of the way of the people who do not. */}
                <dl className="flex flex-col gap-1.5">
                  <div className="spec">
                    <dt>Delivery fee</dt>
                    <dd className="spec-fill" aria-hidden />
                    <dd>
                      {inr(b.deliveryFee ?? b.baseDeliveryFee ?? 0)}
                      {b.freeDeliveryAbove ? (
                        <span className="font-normal text-maroon-800/55">
                          {" "}
                          · free over {inr(b.freeDeliveryAbove)}
                        </span>
                      ) : null}
                    </dd>
                  </div>
                  {b.minOrderValue > 0 && (
                    <div className="spec">
                      <dt>Min order</dt>
                      <dd className="spec-fill" aria-hidden />
                      <dd>{inr(b.minOrderValue)}</dd>
                    </div>
                  )}
                  <div className="spec">
                    <dt>Pickup</dt>
                    <dd className="spec-fill" aria-hidden />
                    <dd>{b.pickupEnabled ? "Available" : "No"}</dd>
                  </div>
                </dl>

                {b.serviceable === false && (
                  <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {b.serviceReason ?? "Not serviceable for delivery"}
                  </p>
                )}

                <button
                  onClick={() => choose(b)}
                  className="branch-card__hit btn-primary w-full mt-auto"
                  aria-label={`Browse the menu at ${b.name}`}
                >
                  Browse Menu →
                </button>

                {/* Getting to the dhaba, and reaching someone there. Both sit
                    above the card-wide tap sheet, or it would swallow them. */}
                <div className="branch-card__aside flex items-center justify-center gap-1 -mb-1">
                  <a
                    href={directionsUrl(b)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost !px-3 text-sm"
                  >
                    <span aria-hidden>🧭</span> Directions
                  </a>
                  {b.phone && (
                    <>
                      <span aria-hidden className="h-4 w-px bg-maroon-800/15" />
                      <a href={`tel:${b.phone}`} className="btn-ghost !px-3 text-sm">
                        <span aria-hidden>📞</span> Call
                      </a>
                    </>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
