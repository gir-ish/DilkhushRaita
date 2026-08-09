"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/utils";
import { Badge, ErrorBox } from "./ui";
import { useCart } from "./cart-context";

interface BranchInfo {
  id: string;
  slug: string;
  name: string;
  address: string;
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

export function BranchPicker() {
  const router = useRouter();
  const cart = useCart();
  const [branches, setBranches] = useState<BranchInfo[] | null>(null);
  const [recommended, setRecommended] = useState<string | null>(null);
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

  const findClosest = () => {
    setError(null);
    if (!navigator.geolocation) {
      setError("Location is not supported on this device — use the PIN code option below.");
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
          setBranches(d.branches);
          setRecommended(d.recommendedBranchId);
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

      setBranches(d.branches);
      const ok = d.branches.filter((b: BranchInfo) => b.serviceable && b.open);
      setRecommended(ok[0]?.id ?? null);

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
      <div className="flex flex-col sm:flex-row gap-3 justify-center mb-5">
        <button onClick={findClosest} disabled={locating} className="btn-primary">
          {locating ? "Finding you…" : "📍 Find the Closest Branch"}
        </button>
        <button
          onClick={() => setManualOpen((v) => !v)}
          className="btn-outline"
          aria-expanded={manualOpen}
        >
          ✏️ Enter Address Manually
        </button>
      </div>

      {manualOpen && (
        <div className="card p-5 max-w-md mx-auto mb-4 animate-fade-up">
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

      <div className="max-w-md mx-auto mb-4">
        <ErrorBox message={error} />
      </div>

      {!branches ? (
        // The branch card layout is fixed and known, so placeholders in its
        // exact shape beat a spinner — nothing shifts when the data lands.
        <div
          className="grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto"
          role="status"
          aria-label="Loading branches…"
        >
          {[0, 1].map((i) => (
            <div key={i} className="card p-5 flex flex-col gap-3.5" aria-hidden>
              <div className="skeleton h-6 w-1/2" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-4/5" />
              <div className="rule-ornament my-1" />
              <div className="skeleton h-3.5 w-2/3" />
              <div className="skeleton h-3.5 w-3/5" />
              <div className="skeleton h-11 w-full mt-2 !rounded-xl" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-5 max-w-3xl mx-auto items-start">
          {branches.map((b) => (
            <article
              key={b.id}
              className={`card card-hover overflow-hidden flex flex-col ${
                recommended === b.id
                  ? "!border-mustard-400 shadow-lift ring-1 ring-mustard-400/40"
                  : ""
              }`}
            >
              {/* Brass cap on the recommended branch — the eye needs one place
                  to land when both branches are serviceable. */}
              {recommended === b.id && (
                <p className="bg-gradient-to-r from-mustard-300 via-mustard-400 to-mustard-300 px-5 py-1.5 text-center text-[11px] font-bold uppercase tracking-kicker text-maroon-800">
                  ⭐ Recommended
                </p>
              )}

              <div className="p-5 flex flex-col gap-3 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-display text-fluid-xl font-semibold text-maroon-700 leading-snug">
                    {b.name}
                  </h3>
                  <div className="flex gap-1 flex-wrap justify-end shrink-0">
                    <Badge tone={b.open ? "green" : "gray"}>
                      {b.open ? "Open now" : (b.openReason ?? "Closed")}
                    </Badge>
                    {b.busyMode && <Badge tone="maroon">Busy</Badge>}
                  </div>
                </div>

                <p className="text-sm text-maroon-800/65 leading-relaxed">{b.address}</p>

                <div className="rule-ornament my-1" />

                <dl className="flex flex-col gap-1.5">
                  {b.distanceKm !== undefined && (
                    <>
                      <div className="spec">
                        <dt>Distance</dt>
                        <dd className="spec-fill" aria-hidden />
                        <dd>≈{b.distanceKm} km</dd>
                      </div>
                      <div className="spec">
                        <dt>Delivery in</dt>
                        <dd className="spec-fill" aria-hidden />
                        <dd>~{b.etaMins} min</dd>
                      </div>
                    </>
                  )}
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
                  <div className="spec">
                    <dt>Pickup</dt>
                    <dd className="spec-fill" aria-hidden />
                    <dd>{b.pickupEnabled ? "Available" : "No"}</dd>
                  </div>
                  {b.minOrderValue > 0 && (
                    <div className="spec">
                      <dt>Min order</dt>
                      <dd className="spec-fill" aria-hidden />
                      <dd>{inr(b.minOrderValue)}</dd>
                    </div>
                  )}
                </dl>

                {b.serviceable === false && (
                  <p className="text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {b.serviceReason ?? "Not serviceable for delivery"}
                  </p>
                )}

                <button
                  onClick={() => choose(b)}
                  className="btn-primary w-full mt-auto"
                  aria-label={`Order from ${b.name}`}
                >
                  Browse Menu →
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
