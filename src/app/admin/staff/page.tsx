"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Modal, Spinner } from "@/components/ui";

interface StaffRow {
  id: string; email: string | null; name: string | null; role: string;
  blocked: boolean; createdAt: string; branchIds: string[];
}
interface BranchLite { id: string; name: string }

const ROLE_LABEL: Record<string, string> = {
  OWNER: "Owner",
  BRANCH_MANAGER: "Branch manager",
  KITCHEN: "Kitchen",
  CASHIER: "Cashier",
  DELIVERY_MANAGER: "Delivery manager",
  MARKETING: "Marketing",
};

/** Roles whose reach is limited to the branches assigned to them. */
const BRANCH_SCOPED = ["BRANCH_MANAGER", "KITCHEN", "CASHIER"];

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffRow[] | null>(null);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [editing, setEditing] = useState<StaffRow | "new" | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/staff")
      .then(async (r) => {
        if (r.status === 403) { setDenied(true); return null; }
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        return d;
      })
      .then((d) => {
        if (!d) return;
        setStaff(d.staff);
        setBranches(d.branches ?? []);
        setRoles(d.assignableRoles ?? []);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  if (denied)
    return (
      <div className="card p-6">
        <h1 className="font-display text-xl font-bold text-maroon-700">Staff</h1>
        <p className="text-sm text-maroon-800/60 mt-2">Only the owner can manage staff accounts.</p>
      </div>
    );

  const setBlocked = async (u: StaffRow, blocked: boolean) => {
    if (blocked && !confirm(`Block ${u.email}? They will not be able to sign in.`)) return;
    const r = await fetch(`/api/admin/staff/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocked }),
    });
    if (!r.ok) setError((await r.json()).error);
    load();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mr-auto">Staff</h1>
        <button onClick={() => setEditing("new")} className="btn-primary !min-h-[38px]">+ Add staff</button>
      </div>
      <p className="text-sm text-maroon-800/60 mb-3">
        Everyone who can sign in at <code>/admin/login</code>. Blocking keeps their history
        and stops them signing in — safer than deleting.
      </p>
      <ErrorBox message={error} />

      {!staff ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[680px]">
            <thead>
              <tr className="text-left text-maroon-800/50 border-b border-cream-200">
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Role</th>
                <th className="p-3">Branches</th>
                <th className="p-3">Status</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((u) => {
                const isOwner = u.role === "OWNER";
                return (
                  <tr key={u.id} className={`border-b border-cream-100 ${u.blocked ? "opacity-50" : ""}`}>
                    <td className="p-3 font-semibold">{u.name ?? "—"}</td>
                    <td className="p-3 font-mono text-xs">{u.email}</td>
                    <td className="p-3">{ROLE_LABEL[u.role] ?? u.role}</td>
                    <td className="p-3 text-xs text-maroon-800/60">
                      {isOwner || !BRANCH_SCOPED.includes(u.role)
                        ? "All branches"
                        : u.branchIds.length === 0
                          ? "— none assigned —"
                          : u.branchIds
                              .map((id) => branches.find((b) => b.id === id)?.name ?? "?")
                              .map((n) => n.replace(/^DilKhush Dhaba\s*[–-]\s*/, ""))
                              .join(", ")}
                    </td>
                    <td className="p-3">
                      <span className={`text-xs font-bold ${u.blocked ? "text-red-700" : "text-leaf-600"}`}>
                        {u.blocked ? "BLOCKED" : "ACTIVE"}
                      </span>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      {isOwner ? (
                        <span className="text-xs text-maroon-800/40">set-owner.mjs</span>
                      ) : (
                        <>
                          <button className="underline text-maroon-600" onClick={() => setEditing(u)}>Edit</button>
                          <span className="text-maroon-800/30 px-2">·</span>
                          <button
                            className={`underline ${u.blocked ? "text-leaf-600" : "text-red-700"}`}
                            onClick={() => setBlocked(u, !u.blocked)}
                          >
                            {u.blocked ? "Unblock" : "Block"}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <StaffEditor
          key={editing === "new" ? "new" : editing.id}
          staff={editing === "new" ? null : editing}
          branches={branches}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

function StaffEditor({
  staff, branches, roles, onClose, onSaved,
}: {
  staff: StaffRow | null;
  branches: BranchLite[];
  roles: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isNew = !staff;
  const [f, setF] = useState({
    email: staff?.email ?? "",
    name: staff?.name ?? "",
    role: staff?.role ?? roles[0] ?? "KITCHEN",
    password: "",
    branchIds: staff?.branchIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scoped = BRANCH_SCOPED.includes(f.role);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = isNew
        ? { email: f.email.trim().toLowerCase(), name: f.name.trim(), role: f.role, password: f.password, branchIds: scoped ? f.branchIds : [] }
        : {
            name: f.name.trim(),
            role: f.role,
            branchIds: scoped ? f.branchIds : [],
            // Only sent when actually typed — an empty box means "leave it alone".
            ...(f.password ? { password: f.password } : {}),
          };
      const r = await fetch(isNew ? "/api/admin/staff" : `/api/admin/staff/${staff!.id}`, {
        method: isNew ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Could not save");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={isNew ? "Add staff" : `Edit — ${staff!.email}`}>
      <form onSubmit={save} className="space-y-3 text-sm">
        <div>
          <label className="label" htmlFor="s-name">Name *</label>
          <input id="s-name" className="input" maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="s-email">Email *</label>
          <input
            id="s-email"
            type="email"
            className="input"
            value={f.email}
            disabled={!isNew}
            onChange={(e) => setF({ ...f, email: e.target.value })}
          />
          {!isNew && <p className="text-xs text-maroon-800/50 mt-1">The sign-in email cannot be changed — add a new account instead.</p>}
        </div>
        <div>
          <label className="label" htmlFor="s-role">Role *</label>
          <select id="s-role" className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>)}
          </select>
          <p className="text-xs text-maroon-800/50 mt-1">
            Owner cannot be assigned here — a second owner could lock out the first.
          </p>
        </div>
        {scoped && (
          <div>
            <span className="label">Branches this person can see</span>
            <div className="flex flex-wrap gap-3 mt-1">
              {branches.map((b) => (
                <label key={b.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-maroon-600"
                    checked={f.branchIds.includes(b.id)}
                    onChange={(e) =>
                      setF({
                        ...f,
                        branchIds: e.target.checked
                          ? [...f.branchIds, b.id]
                          : f.branchIds.filter((x) => x !== b.id),
                      })
                    }
                  />
                  {b.name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")}
                </label>
              ))}
            </div>
            {f.branchIds.length === 0 && (
              <p className="text-xs text-red-700 mt-1">With no branch assigned they will see nothing.</p>
            )}
          </div>
        )}
        <div>
          <label className="label" htmlFor="s-pass">{isNew ? "Password *" : "New password"}</label>
          <input
            id="s-pass"
            type="text"
            className="input font-mono"
            autoComplete="new-password"
            placeholder={isNew ? "at least 8 characters" : "leave blank to keep the current one"}
            value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })}
          />
          <p className="text-xs text-maroon-800/50 mt-1">
            Shown as you type so you can pass it on — it is stored hashed and can never be read back.
          </p>
        </div>
        <ErrorBox message={error} />
        <button
          type="submit"
          disabled={busy || !f.name.trim() || (isNew && (!f.email.trim() || f.password.length < 8))}
          className="btn-primary w-full"
        >
          {busy ? "Saving…" : isNew ? "Create account" : "Save changes"}
        </button>
      </form>
    </Modal>
  );
}
