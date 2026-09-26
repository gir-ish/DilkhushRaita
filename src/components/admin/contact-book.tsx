"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { istDateTime } from "@/lib/utils";

/**
 * The contact book: the numbers a campaign can be sent to, and where they
 * came from.
 *
 * Its whole job is to make the list knowable before a single credit is spent
 * on it. Upload a phone-book export and it says what it kept, what it already
 * had, and what it threw out with the reason; after that the numbers are here
 * to search, correct and opt out one at a time.
 */

interface Contact {
  id: string;
  phone: string;
  name: string | null;
  optedOut: boolean;
  createdAt: string;
  lastSentAt: string | null;
  list: { id: string; filename: string } | null;
}

interface ContactList {
  id: string;
  filename: string;
  uploadedAt: string;
  uploadedBy: string | null;
  rowsRead: number;
  added: number;
  updated: number;
  duplicates: number;
  rejected: number;
  rejectedSample: { raw: string; why: string }[];
}

interface UploadResult {
  filename: string;
  rowsRead: number;
  valid: number;
  added: number;
  alreadyHad: number;
  duplicates: number;
  rejected: number;
  rejectedSample: { raw: string; why: string }[];
  nameless: number;
}

const PAGE = 100;

export function ContactBook() {
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [lists, setLists] = useState<ContactList[]>([]);
  const [totals, setTotals] = useState({ all: 0, sendable: 0, optedOut: 0 });
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [listId, setListId] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ take: String(PAGE), skip: String(page * PAGE) });
    if (q.trim()) params.set("q", q.trim());
    if (listId) params.set("listId", listId);
    fetch(`/api/admin/marketing/contacts?${params}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setContacts(d.contacts);
        setLists(d.lists);
        setTotals(d.totals);
        setTotal(d.total);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [q, listId, page]);

  // Debounced, so typing a number is one request rather than ten.
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const r = await fetch("/api/admin/marketing/contacts", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setResult(d);
      setPage(0);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const patch = async (id: string, data: Record<string, unknown>) => {
    await fetch(`/api/admin/marketing/contacts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    load();
  };

  const remove = async (c: Contact) => {
    if (!confirm(`Remove ${c.phone} from the contact book?`)) return;
    await fetch(`/api/admin/marketing/contacts/${c.id}`, { method: "DELETE" });
    load();
  };

  const pages = Math.ceil(total / PAGE);

  return (
    <section className="card p-4 sm:p-5 mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-bold text-maroon-700">📇 Contact book</h2>
        <span className="text-sm text-maroon-800/60">
          {totals.sendable.toLocaleString("en-IN")} to send to
          {totals.optedOut > 0 && ` · ${totals.optedOut} opted out`}
        </span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="btn-primary ml-auto !min-h-[40px] !px-4"
        >
          {busy ? "Reading…" : "📄 Upload phone book"}
        </button>
      </div>

      <p className="mt-1.5 text-sm text-maroon-800/60">
        A CSV exported from your phone or Google Contacts. Every number is checked as it comes in:
        landlines, foreign numbers and half-typed ones are left out, and the same number twice
        becomes one. Nothing is sent by uploading.
      </p>

      <ErrorBox message={error} />

      {result && (
        <div className="mt-3 rounded-xl border-2 border-leaf-500/40 bg-leaf-50 p-3">
          <p className="font-bold text-maroon-700">
            {result.filename} · {result.rowsRead.toLocaleString("en-IN")} rows read
          </p>
          <ul className="mt-1.5 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <li>
              ✅ <strong>{result.added.toLocaleString("en-IN")}</strong> new number
              {result.added === 1 ? "" : "s"} added
            </li>
            <li>♻️ {result.alreadyHad.toLocaleString("en-IN")} already in the book</li>
            <li>🔁 {result.duplicates.toLocaleString("en-IN")} repeated in the file</li>
            <li>🚫 {result.rejected.toLocaleString("en-IN")} not usable</li>
            {result.nameless > 0 && (
              <li className="sm:col-span-2 text-maroon-800/70">
                {result.nameless.toLocaleString("en-IN")} had no name we could use — those are
                greeted as &ldquo;Customer&rdquo;.
              </li>
            )}
          </ul>
          {result.rejectedSample.length > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold">What was left out</summary>
              <ul className="mt-1 max-h-40 overflow-y-auto font-mono text-xs">
                {result.rejectedSample.map((r, i) => (
                  <li key={i} className="py-0.5">
                    {r.raw} — <span className="text-maroon-800/60">{r.why}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button onClick={() => setResult(null)} className="mt-2 text-sm underline font-semibold">
            Dismiss
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------ history */}
      {lists.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setShowHistory((v) => !v)}
            className="text-sm font-semibold text-maroon-700 underline"
          >
            {showHistory ? "Hide" : "Show"} upload history ({lists.length})
          </button>
          {showHistory && (
            <div className="mt-2 overflow-x-auto scroll-x">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-maroon-800/50">
                  <tr>
                    <th className="py-1 pr-3">File</th>
                    <th className="py-1 pr-3">When</th>
                    <th className="py-1 pr-3">By</th>
                    <th className="py-1 pr-3 text-right">Rows</th>
                    <th className="py-1 pr-3 text-right">Added</th>
                    <th className="py-1 pr-3 text-right">Dupes</th>
                    <th className="py-1 pr-3 text-right">Left out</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {lists.map((l) => (
                    <tr key={l.id} className="border-t border-cream-200">
                      <td className="py-1.5 pr-3 font-semibold">{l.filename}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap text-maroon-800/70">
                        {istDateTime(l.uploadedAt)}
                      </td>
                      <td className="py-1.5 pr-3 text-maroon-800/70">{l.uploadedBy ?? "—"}</td>
                      <td className="py-1.5 pr-3 text-right">{l.rowsRead}</td>
                      <td className="py-1.5 pr-3 text-right font-bold text-leaf-600">{l.added}</td>
                      <td className="py-1.5 pr-3 text-right">{l.duplicates}</td>
                      <td className="py-1.5 pr-3 text-right">{l.rejected}</td>
                      <td className="py-1.5">
                        <button
                          onClick={() => {
                            setListId(listId === l.id ? "" : l.id);
                            setPage(0);
                          }}
                          className="text-xs underline font-semibold whitespace-nowrap"
                        >
                          {listId === l.id ? "showing" : "show these"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------- the list */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="input !w-full sm:!w-64"
          placeholder="Search a name or number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          aria-label="Search the contact book"
        />
        {listId && (
          <button
            onClick={() => {
              setListId("");
              setPage(0);
            }}
            className="text-sm underline text-maroon-600"
          >
            Clear upload filter
          </button>
        )}
        <span className="ml-auto text-sm text-maroon-800/60">
          {total.toLocaleString("en-IN")} shown
        </span>
      </div>

      {!contacts ? (
        <Spinner label="Loading the contact book…" />
      ) : contacts.length === 0 ? (
        <p className="py-10 text-center text-maroon-800/50">
          {totals.all === 0
            ? "Nothing here yet — upload a phone book to start."
            : "No contact matches that."}
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-maroon-800/50">
              <tr>
                <th className="py-1 pr-3">Name</th>
                <th className="py-1 pr-3">Number</th>
                <th className="py-1 pr-3">From</th>
                <th className="py-1 pr-3">Last texted</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className={`border-t border-cream-200 ${c.optedOut ? "opacity-50" : ""}`}>
                  <td className="py-1.5 pr-3 font-semibold">{c.name ?? "Customer"}</td>
                  <td className="py-1.5 pr-3 font-mono whitespace-nowrap">{c.phone}</td>
                  <td className="py-1.5 pr-3 text-maroon-800/60 truncate max-w-[14rem]">
                    {c.list?.filename ?? "—"}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap text-maroon-800/60">
                    {c.lastSentAt ? istDateTime(c.lastSentAt) : "never"}
                  </td>
                  <td className="py-1.5 whitespace-nowrap">
                    <button
                      onClick={() => patch(c.id, { optedOut: !c.optedOut })}
                      className="text-xs underline font-semibold"
                      title={
                        c.optedOut
                          ? "Start including them in campaigns again"
                          : "Keep the number, but never text it"
                      }
                    >
                      {c.optedOut ? "opted out" : "stop texting"}
                    </button>
                    <button
                      onClick={() => remove(c)}
                      className="ml-3 text-xs underline font-semibold text-red-700"
                    >
                      remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
            disabled={page === 0}
            className="btn-outline !min-h-[36px] text-sm disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-sm text-maroon-800/60">
            Page {page + 1} of {pages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(p + 1, pages - 1))}
            disabled={page >= pages - 1}
            className="btn-outline !min-h-[36px] text-sm disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}
