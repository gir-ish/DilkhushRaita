"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Modal, Spinner } from "@/components/ui";
import { inr } from "@/lib/utils";

interface Agent {
  id: string;
  name: string | null;
  phone: string | null;
  online: boolean;
  vehicle: string | null;
  codHeld: number;
  active: boolean;
}

export default function AdminAgentsPage() {
  const [agents, setAgents] = useState<Agent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Agent | "new" | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/agents")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || !Array.isArray(d.agents)) throw new Error(d.error ?? "Could not load agents");
        setAgents(d.agents);
        setError(null);
      })
      .catch((e) => {
        setAgents([]);
        setError(e.message);
      });
  }, []);

  useEffect(load, [load]);

  const patch = async (id: string, body: Record<string, unknown>) => {
    const r = await fetch(`/api/admin/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) load();
    else setError((await r.json()).error);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mr-auto">Delivery agents</h1>
        <button onClick={() => setEditing("new")} className="btn-primary !min-h-[38px]">
          + Add agent
        </button>
      </div>

      <ErrorBox message={error} />

      {!agents ? (
        <Spinner label="Loading agents…" />
      ) : agents.length === 0 ? (
        <p className="card p-8 text-center text-maroon-800/60">
          No delivery agents yet — add one to start assigning deliveries.
        </p>
      ) : (
        <div className="card overflow-x-auto mt-2">
          <table className="w-full text-sm min-w-[620px]">
            <thead>
              <tr className="text-left text-maroon-800/50 border-b border-cream-200">
                <th className="p-3">Name</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Vehicle</th>
                <th className="p-3">Cash held</th>
                <th className="p-3">On duty</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr
                  key={a.id}
                  className={`border-b border-cream-100 ${!a.active ? "opacity-45" : ""}`}
                >
                  <td className="p-3 font-semibold">
                    🛵 {a.name ?? "—"}
                    {!a.active && (
                      <span className="ml-2 text-xs font-normal text-red-700">(inactive)</span>
                    )}
                  </td>
                  <td className="p-3">
                    {a.phone ? (
                      <a href={`tel:${a.phone}`} className="underline text-maroon-600">
                        {a.phone}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="p-3">{a.vehicle ?? "—"}</td>
                  <td className="p-3">
                    <span className={a.codHeld > 0 ? "font-semibold text-mustard-600" : ""}>
                      {inr(a.codHeld)}
                    </span>
                  </td>
                  <td className="p-3">
                    <button
                      disabled={!a.active}
                      onClick={() => patch(a.id, { online: !a.online })}
                      className={`text-xs font-bold px-2 py-1 rounded-full disabled:opacity-50 ${
                        a.online ? "bg-green-100 text-leaf-600" : "bg-cream-200 text-maroon-800/60"
                      }`}
                      aria-label={`Mark ${a.name ?? "agent"} ${a.online ? "off" : "on"} duty`}
                    >
                      {a.online ? "On duty" : "Off duty"}
                    </button>
                  </td>
                  <td className="p-3 whitespace-nowrap">
                    <button onClick={() => setEditing(a)} className="underline text-maroon-600">
                      Edit
                    </button>
                    <button
                      onClick={() => {
                        if (a.active && !confirm(`Deactivate ${a.name}? They keep their delivery history.`)) return;
                        patch(a.id, { active: !a.active });
                      }}
                      className={`underline ml-3 ${a.active ? "text-red-700" : "text-leaf-600"}`}
                    >
                      {a.active ? "Deactivate" : "Restore"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-maroon-800/50 mt-3">
        Agents don&apos;t sign in to this dashboard — they&apos;re assigned to orders from the
        Orders page. &ldquo;Cash held&rdquo; is COD money collected but not yet handed in.
      </p>

      {editing && (
        <AgentModal
          agent={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function AgentModal({
  agent,
  onClose,
  onSaved,
}: {
  agent: Agent | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(agent?.name ?? "");
  // Stored as +91XXXXXXXXXX; the form edits the 10 digits.
  const [phone, setPhone] = useState((agent?.phone ?? "").replace(/^\+91/, ""));
  const [vehicle, setVehicle] = useState(agent?.vehicle ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(agent ? `/api/admin/agents/${agent.id}` : "/api/admin/agents", {
        method: agent ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), phone, vehicle: vehicle.trim() || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={agent ? `Edit — ${agent.name}` : "Add delivery agent"}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div>
          <label className="label" htmlFor="a-name">
            Name *
          </label>
          <input
            id="a-name"
            className="input"
            required
            maxLength={60}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Raju Kumar"
          />
        </div>
        <div>
          <label className="label" htmlFor="a-phone">
            Mobile number *
          </label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-cream-300 bg-cream-100 text-sm font-semibold">
              +91
            </span>
            <input
              id="a-phone"
              className="input !rounded-l-none"
              required
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="98XXXXXXXX"
            />
          </div>
          <p className="text-xs text-maroon-800/50 mt-1">
            Customers see this number to call about their delivery.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="a-vehicle">
            Vehicle (optional)
          </label>
          <input
            id="a-vehicle"
            className="input"
            maxLength={40}
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value)}
            placeholder="e.g. Bike — DL 3S AB 1234"
          />
        </div>
        <ErrorBox message={error} />
        <button
          type="submit"
          disabled={busy || name.trim().length < 2 || phone.length !== 10}
          className="btn-primary w-full"
        >
          {busy ? "Saving…" : agent ? "Save changes" : "Add agent"}
        </button>
      </form>
    </Modal>
  );
}
