"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { inr, istDate } from "@/lib/utils";
import {
  EXPENSE_CATEGORIES,
  PAID_BY,
  categoryLabel,
  istMonthKey,
  type ExpenseCategory,
  type PaidBy,
} from "@/lib/expenses";

/**
 * The owner's account book.
 *
 * Money going out of the shop — groceries, wages, gas, rent — against what
 * came in, a month at a time and day by day. Not the customer khata, which is
 * money owed to the shop; this is the other direction.
 *
 * Built for the way it is actually kept: a single line typed at the end of a
 * shift, and a table afterwards that can be read down a column or corrected
 * in place.
 */

interface Expense {
  id: string;
  date: string;
  branchId: string | null;
  branchName: string | null;
  category: string;
  payee: string | null;
  note: string | null;
  amount: number;
  paidBy: string;
  unpaid: boolean;
  createdBy: string | null;
}

interface Summary {
  total: number;
  paid: number;
  unpaid: number;
  byCategory: { key: string; amount: number; count: number }[];
  byPayee: { payee: string; amount: number; count: number }[];
  byBranch: Record<string, number>;
  byPaidBy: Record<string, number>;
  byDay: Record<string, number>;
}

interface Data {
  month: string;
  expenses: Expense[];
  summary: Summary;
  sales: { total: number; byDay: Record<string, number>; orders: number };
  branches: { id: string; name: string; slug: string }[];
  payees: string[];
}

const shortBranch = (name: string) => name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "");

export default function ExpensesPage() {
  const [data, setData] = useState<Data | null>(null);
  const [month, setMonth] = useState(() => istMonthKey());
  const [branchId, setBranchId] = useState("");
  const [category, setCategory] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [openDays, setOpenDays] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    const params = new URLSearchParams({ month });
    if (branchId) params.set("branchId", branchId);
    if (category) params.set("category", category);
    if (q.trim()) params.set("q", q.trim());
    fetch(`/api/admin/expenses?${params}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setData(d);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [month, branchId, category, q]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  /** Every day that has something on it, newest first — the book's spine. */
  const days = useMemo(() => {
    if (!data) return [];
    const keys = new Set([
      ...data.expenses.map((e) => e.date),
      ...Object.keys(data.sales.byDay),
    ]);
    return [...keys].sort().reverse();
  }, [data]);

  const toggleDay = (day: string) =>
    setOpenDays((open) => {
      const next = new Set(open);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  const net = data ? data.sales.total - data.summary.total : 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-maroon-700">
          📒 Accounts
        </h1>
        <span className="text-sm text-maroon-800/60">
          What the shop spends, day by day
        </span>

        <input
          type="month"
          className="input !w-auto ml-auto"
          value={month}
          onChange={(e) => setMonth(e.target.value || istMonthKey())}
          aria-label="Month"
        />
        <select
          className="input !w-auto"
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          aria-label="Branch"
        >
          <option value="">Both restaurants</option>
          {(data?.branches ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {shortBranch(b.name)}
            </option>
          ))}
          <option value="both">Shared / neither</option>
        </select>
        <a
          href={`/api/admin/expenses/export?month=${month}${branchId ? `&branchId=${branchId}` : ""}`}
          className="btn-outline !min-h-[40px] text-sm"
        >
          ⬇️ Excel
        </a>
      </div>

      <ErrorBox message={error} />

      {/* ------------------------------------------------- the month at a glance */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Tile label="Money in" value={inr(data?.sales.total ?? 0)} hint={`${data?.sales.orders ?? 0} orders`} tone="good" />
        <Tile label="Money out" value={inr(data?.summary.total ?? 0)} hint={`${data?.expenses.length ?? 0} entries`} tone="spend" />
        <Tile
          label={net >= 0 ? "Left over" : "Short by"}
          value={inr(Math.abs(net))}
          hint="In minus out"
          tone={net >= 0 ? "good" : "bad"}
        />
        <Tile
          label="Still to pay"
          value={inr(data?.summary.unpaid ?? 0)}
          hint="Taken on credit"
          tone={data && data.summary.unpaid > 0 ? "bad" : "plain"}
        />
      </div>

      <AddRow
        branches={data?.branches ?? []}
        payees={data?.payees ?? []}
        onSaved={load}
        onError={setError}
      />

      <div className="grid lg:grid-cols-[minmax(0,1fr)_320px] gap-4 mt-4">
        {/* ----------------------------------------------------- the day book */}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h2 className="font-semibold text-maroon-700">Day by day</h2>
            <select
              className="input !w-auto !min-h-[36px] text-sm ml-auto"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Category filter"
            >
              <option value="">All categories</option>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.icon} {c.label}
                </option>
              ))}
            </select>
            <input
              type="search"
              className="input !w-auto !min-h-[36px] text-sm"
              placeholder="Name or note"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search entries"
            />
          </div>

          {!data ? (
            <Spinner label="Loading the book…" />
          ) : days.length === 0 ? (
            <p className="card p-8 text-center text-maroon-800/50">
              Nothing written down for this month yet. Add the first line above.
            </p>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-cream-100 text-left text-xs uppercase tracking-wide text-maroon-800/60">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2 text-right">In</th>
                    <th className="px-3 py-2 text-right">Out</th>
                    <th className="px-3 py-2 text-right">Net</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => {
                    const out = data.summary.byDay[day] ?? 0;
                    const inAmt = data.sales.byDay[day] ?? 0;
                    const rows = data.expenses.filter((e) => e.date === day);
                    const open = openDays.has(day);
                    const dayNet = inAmt - out;
                    return (
                      <FragmentRow
                        key={day}
                        day={day}
                        inAmt={inAmt}
                        out={out}
                        dayNet={dayNet}
                        open={open}
                        rows={rows}
                        branches={data.branches}
                        onToggle={() => toggleDay(day)}
                        onEdit={setEditing}
                      />
                    );
                  })}
                </tbody>
                <tfoot className="border-t-2 border-cream-300 bg-cream-100 font-bold">
                  <tr>
                    <td className="px-3 py-2">Month</td>
                    <td className="px-3 py-2 text-right text-leaf-600">{inr(data.sales.total)}</td>
                    <td className="px-3 py-2 text-right text-maroon-700">{inr(data.summary.total)}</td>
                    <td className={`px-3 py-2 text-right ${net >= 0 ? "text-leaf-600" : "text-red-700"}`}>
                      {inr(net)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- breakdowns */}
        <aside className="space-y-4">
          <Breakdown
            title="Where it went"
            empty="Nothing spent yet."
            rows={(data?.summary.byCategory ?? []).map((c) => ({
              key: c.key,
              label: categoryLabel(c.key),
              amount: c.amount,
              hint: `${c.count} entr${c.count === 1 ? "y" : "ies"}`,
            }))}
            total={data?.summary.total ?? 0}
          />
          <Breakdown
            title="Paid to helpers"
            empty="No wages written down this month."
            rows={(data?.summary.byPayee ?? []).map((p) => ({
              key: p.payee,
              label: `🧑‍🍳 ${p.payee}`,
              amount: p.amount,
              hint: `${p.count} payment${p.count === 1 ? "" : "s"}`,
            }))}
            total={
              (data?.summary.byCategory ?? []).find((c) => c.key === "HELPER")?.amount ?? 0
            }
          />
          {data && (
            <div className="card p-4">
              <h3 className="font-semibold text-maroon-700 mb-2">By restaurant</h3>
              <ul className="space-y-1 text-sm">
                {data.branches.map((b) => (
                  <li key={b.id} className="flex justify-between">
                    <span>🏪 {shortBranch(b.name)}</span>
                    <span className="font-bold">{inr(data.summary.byBranch[b.id] ?? 0)}</span>
                  </li>
                ))}
                <li className="flex justify-between text-maroon-800/70">
                  <span>Shared / neither</span>
                  <span className="font-bold">{inr(data.summary.byBranch.both ?? 0)}</span>
                </li>
              </ul>
              <h3 className="font-semibold text-maroon-700 mt-3 mb-2">How it was paid</h3>
              <ul className="space-y-1 text-sm">
                {PAID_BY.map((m) => (
                  <li key={m} className="flex justify-between">
                    <span>{m === "CASH" ? "💵 Cash" : m === "UPI" ? "📱 UPI" : m === "CARD" ? "💳 Card" : "🏦 Bank"}</span>
                    <span className="font-bold">{inr(data.summary.byPaidBy[m] ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      {editing && (
        <EditModal
          entry={editing}
          branches={data?.branches ?? []}
          payees={data?.payees ?? []}
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

/* ------------------------------------------------------------------ pieces */

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: "good" | "bad" | "spend" | "plain";
}) {
  const tones = {
    good: "border-leaf-500 bg-leaf-50 text-leaf-600",
    bad: "border-red-600 bg-red-50 text-red-700",
    spend: "border-mustard-400 bg-mustard-100 text-maroon-700",
    plain: "border-cream-300 bg-white text-maroon-700",
  };
  return (
    <div className={`card border-l-4 p-3 sm:p-4 ${tones[tone]}`}>
      <span className="block text-xs font-bold uppercase tracking-wide opacity-70">{label}</span>
      <span className="block font-display text-2xl sm:text-3xl font-bold leading-tight">{value}</span>
      <span className="block text-xs opacity-60">{hint}</span>
    </div>
  );
}

/** One day, and its entries underneath when opened. */
function FragmentRow({
  day,
  inAmt,
  out,
  dayNet,
  open,
  rows,
  branches,
  onToggle,
  onEdit,
}: {
  day: string;
  inAmt: number;
  out: number;
  dayNet: number;
  open: boolean;
  rows: Expense[];
  branches: { id: string; name: string }[];
  onToggle: () => void;
  onEdit: (e: Expense) => void;
}) {
  return (
    <>
      <tr
        className="border-t border-cream-200 cursor-pointer hover:bg-mustard-100/50"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-semibold whitespace-nowrap">
          <span aria-hidden className="inline-block w-4 text-maroon-800/40">
            {open ? "▾" : "▸"}
          </span>
          {istDate(`${day}T12:00:00+05:30`)}
        </td>
        <td className="px-3 py-2 text-right text-leaf-600">{inAmt > 0 ? inr(inAmt) : "—"}</td>
        <td className="px-3 py-2 text-right text-maroon-700 font-semibold">
          {out > 0 ? inr(out) : "—"}
        </td>
        <td className={`px-3 py-2 text-right font-bold ${dayNet >= 0 ? "text-leaf-600" : "text-red-700"}`}>
          {inr(dayNet)}
        </td>
        <td className="px-3 py-2 text-right text-xs text-maroon-800/50 whitespace-nowrap">
          {rows.length > 0 && `${rows.length} entr${rows.length === 1 ? "y" : "ies"}`}
        </td>
      </tr>
      {open &&
        rows.map((e) => (
          <tr key={e.id} className="border-t border-cream-100 bg-cream-50/60 text-[13px]">
            <td className="px-3 py-1.5 pl-9 text-maroon-800/80">
              {categoryLabel(e.category)}
              {e.unpaid && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                  UNPAID
                </span>
              )}
            </td>
            <td className="px-3 py-1.5 text-maroon-800/70" colSpan={2}>
              {e.payee && <strong>{e.payee}</strong>}
              {e.payee && e.note ? " · " : ""}
              {e.note}
              {e.branchId && (
                <span className="ml-2 text-xs text-maroon-800/50">
                  🏪 {shortBranch(branches.find((b) => b.id === e.branchId)?.name ?? "")}
                </span>
              )}
            </td>
            <td className="px-3 py-1.5 text-right font-bold text-maroon-700">{inr(e.amount)}</td>
            <td className="px-3 py-1.5 text-right whitespace-nowrap">
              <button onClick={() => onEdit(e)} className="text-xs underline font-semibold">
                edit
              </button>
            </td>
          </tr>
        ))}
      {open && rows.length === 0 && (
        <tr className="border-t border-cream-100 bg-cream-50/60">
          <td colSpan={5} className="px-3 py-2 pl-9 text-xs text-maroon-800/50">
            Nothing spent this day.
          </td>
        </tr>
      )}
    </>
  );
}

function Breakdown({
  title,
  rows,
  total,
  empty,
}: {
  title: string;
  rows: { key: string; label: string; amount: number; hint: string }[];
  total: number;
  empty: string;
}) {
  return (
    <div className="card p-4">
      <h3 className="font-semibold text-maroon-700 mb-2">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-maroon-800/50">{empty}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate">{r.label}</span>
                <span className="font-bold whitespace-nowrap">{inr(r.amount)}</span>
              </div>
              {/* A bar, because a column of numbers does not say which one is
                  the problem. */}
              <div className="mt-0.5 h-1.5 rounded-full bg-cream-200">
                <div
                  className="h-1.5 rounded-full bg-maroon-600"
                  style={{ width: `${total > 0 ? Math.max((r.amount / total) * 100, 2) : 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- entry row */

const todayIst = () =>
  new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(new Date());

interface Draft {
  date: string;
  branchId: string;
  category: ExpenseCategory;
  payee: string;
  note: string;
  amount: string;
  paidBy: PaidBy;
  unpaid: boolean;
}

const emptyDraft = (): Draft => ({
  date: todayIst(),
  branchId: "",
  category: "GROCERIES",
  payee: "",
  note: "",
  amount: "",
  paidBy: "CASH",
  unpaid: false,
});

/** One line, typed left to right, Enter to save — the way a book is kept. */
function AddRow({
  branches,
  payees,
  onSaved,
  onError,
}: {
  branches: { id: string; name: string }[];
  payees: string[];
  onSaved: () => void;
  onError: (m: string | null) => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const amount = Number(draft.amount);
    if (!(amount > 0)) return onError("Put an amount on it first.");
    setBusy(true);
    onError(null);
    try {
      const r = await fetch("/api/admin/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: draft.date,
          branchId: draft.branchId || null,
          category: draft.category,
          payee: draft.payee || null,
          note: draft.note || null,
          amount,
          paidBy: draft.paidBy,
          unpaid: draft.unpaid,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      // The date, branch and category stay: the next line is usually the same
      // day and the same kind of thing.
      setDraft((p) => ({ ...p, payee: "", note: "", amount: "" }));
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Could not save that line");
    } finally {
      setBusy(false);
    }
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  return (
    <div className="card p-3 sm:p-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-12">
        <input
          type="date"
          className="input lg:col-span-2"
          value={draft.date}
          onChange={(e) => set("date", e.target.value)}
          aria-label="Date"
        />
        <select
          className="input lg:col-span-2"
          value={draft.category}
          onChange={(e) => set("category", e.target.value as ExpenseCategory)}
          aria-label="What it was for"
        >
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {c.icon} {c.label}
            </option>
          ))}
        </select>
        <input
          className="input lg:col-span-2"
          list="dk-payees"
          placeholder={draft.category === "HELPER" ? "Helper's name" : "Paid to (optional)"}
          value={draft.payee}
          onChange={(e) => set("payee", e.target.value)}
          aria-label="Paid to"
        />
        <datalist id="dk-payees">
          {payees.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <input
          className="input lg:col-span-2"
          placeholder="Note (optional)"
          value={draft.note}
          onChange={(e) => set("note", e.target.value)}
          aria-label="Note"
        />
        <select
          className="input lg:col-span-2"
          value={draft.branchId}
          onChange={(e) => set("branchId", e.target.value)}
          aria-label="Restaurant"
        >
          <option value="">Both / shared</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              🏪 {shortBranch(b.name)}
            </option>
          ))}
        </select>
        <input
          className="input lg:col-span-2 !text-lg !font-bold"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          placeholder="₹ amount"
          value={draft.amount}
          onChange={(e) => set("amount", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !busy && save()}
          aria-label="Amount"
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {PAID_BY.map((m) => (
          <button
            key={m}
            onClick={() => set("paidBy", m)}
            className={`chip ${draft.paidBy === m ? "chip-active" : ""}`}
          >
            {m === "CASH" ? "💵 Cash" : m === "UPI" ? "📱 UPI" : m === "CARD" ? "💳 Card" : "🏦 Bank"}
          </button>
        ))}
        <label className="flex items-center gap-2 text-sm font-semibold ml-1">
          <input
            type="checkbox"
            className="h-4 w-4 accent-maroon-600"
            checked={draft.unpaid}
            onChange={(e) => set("unpaid", e.target.checked)}
          />
          Not paid yet
        </label>
        <button onClick={save} disabled={busy} className="btn-primary ml-auto !min-h-[44px] !px-6">
          {busy ? "Saving…" : "Add line"}
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- correcting */

function EditModal({
  entry,
  branches,
  payees,
  onClose,
  onSaved,
}: {
  entry: Expense;
  branches: { id: string; name: string }[];
  payees: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>({
    date: entry.date,
    branchId: entry.branchId ?? "",
    category: entry.category as ExpenseCategory,
    payee: entry.payee ?? "",
    note: entry.note ?? "",
    amount: String(entry.amount),
    paidBy: entry.paidBy as PaidBy,
    unpaid: entry.unpaid,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const amount = Number(draft.amount);
    if (!(amount > 0)) return setError("Put an amount on it first.");
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/expenses/${entry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: draft.date,
          branchId: draft.branchId || null,
          category: draft.category,
          payee: draft.payee || null,
          note: draft.note || null,
          amount,
          paidBy: draft.paidBy,
          unpaid: draft.unpaid,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete this ${inr(entry.amount)} entry?`)) return;
    setBusy(true);
    await fetch(`/api/admin/expenses/${entry.id}`, { method: "DELETE" });
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-maroon-950/55 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-lg rounded-t-plaque sm:rounded-plaque bg-cream-50 p-5 shadow-lift max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Edit entry"
      >
        <h2 className="font-display text-xl font-bold text-maroon-700 mb-3">Edit this line</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <input type="date" className="input" value={draft.date} onChange={(e) => set("date", e.target.value)} aria-label="Date" />
          <select
            className="input"
            value={draft.category}
            onChange={(e) => set("category", e.target.value as ExpenseCategory)}
            aria-label="Category"
          >
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.icon} {c.label}
              </option>
            ))}
          </select>
          <input className="input" list="dk-payees-edit" placeholder="Paid to" value={draft.payee} onChange={(e) => set("payee", e.target.value)} aria-label="Paid to" />
          <datalist id="dk-payees-edit">
            {payees.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
          <select className="input" value={draft.branchId} onChange={(e) => set("branchId", e.target.value)} aria-label="Restaurant">
            <option value="">Both / shared</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                🏪 {shortBranch(b.name)}
              </option>
            ))}
          </select>
          <input className="input sm:col-span-2" placeholder="Note" value={draft.note} onChange={(e) => set("note", e.target.value)} aria-label="Note" />
          <input
            className="input sm:col-span-2 !text-lg !font-bold"
            type="number"
            min={0}
            step="0.01"
            value={draft.amount}
            onChange={(e) => set("amount", e.target.value)}
            aria-label="Amount"
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {PAID_BY.map((m) => (
            <button key={m} onClick={() => set("paidBy", m)} className={`chip ${draft.paidBy === m ? "chip-active" : ""}`}>
              {m === "CASH" ? "💵 Cash" : m === "UPI" ? "📱 UPI" : m === "CARD" ? "💳 Card" : "🏦 Bank"}
            </button>
          ))}
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={draft.unpaid} onChange={(e) => set("unpaid", e.target.checked)} />
            Not paid yet
          </label>
        </div>

        <ErrorBox message={error} />

        <div className="mt-4 flex gap-2">
          <button onClick={remove} disabled={busy} className="btn-outline !text-red-700 !border-red-700">
            Delete
          </button>
          <button onClick={onClose} className="btn-ghost ml-auto">
            Cancel
          </button>
          <button onClick={save} disabled={busy} className="btn-primary !px-6">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
