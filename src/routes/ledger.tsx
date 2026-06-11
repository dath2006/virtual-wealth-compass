import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search, Download } from "lucide-react";

import { PageLayout } from "@/components/layout/PageLayout";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { getLedger, exportLedgerCSV } from "@/lib/dataService";
import { fmtINR, fmtTime } from "@/lib/formatters";
import type { LedgerCategory } from "@/lib/types";

export const Route = createFileRoute("/ledger")({
  head: () => ({
    meta: [
      { title: "Ledger · Productivity Economy" },
      { name: "description", content: "Full transaction history with filters and search." },
    ],
  }),
  component: LedgerPage,
});

const allCategories: LedgerCategory[] = [
  "NFC", "SMS_UPI", "STEP_INCOME", "LAZY_TAX", "DISTRACTION", "OATH", "OATH_REPAY", "REVERSAL", "MANUAL",
];

function LedgerPage() {
  const q = useQuery({ queryKey: ["ledger"], queryFn: getLedger });
  const [search, setSearch] = useState("");
  const [cats, setCats] = useState<LedgerCategory[]>([]);
  const [spendClass, setSpendClass] = useState<"ALL" | "ESSENTIAL" | "DISCRETIONARY">("ALL");
  const [showRunning, setShowRunning] = useState(false);
  const [page, setPage] = useState(1);
  const PER = 20;

  const filtered = useMemo(() => {
    let arr = q.data ?? [];
    if (search.trim()) {
      const s = search.toLowerCase();
      arr = arr.filter((e) =>
        (e.description ?? "").toLowerCase().includes(s) ||
        (e.merchantName ?? "").toLowerCase().includes(s),
      );
    }
    if (cats.length) arr = arr.filter((e) => cats.includes(e.category));
    if (spendClass !== "ALL") arr = arr.filter((e) => e.spendClass === spendClass);
    return arr;
  }, [q.data, search, cats, spendClass]);

  const running = useMemo(() => {
    if (!showRunning) return new Map<number, number>();
    const m = new Map<number, number>();
    // running balance walking oldest -> newest
    const sorted = [...filtered].sort((a, b) => a.timestampMs - b.timestampMs);
    let cum = 0;
    for (const e of sorted) { cum += e.amount; m.set(e.id, cum); }
    return m;
  }, [filtered, showRunning]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PER));
  const slice = filtered.slice((page - 1) * PER, page * PER);

  const toggleCat = (c: LedgerCategory) =>
    setCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));

  const onExport = () => {
    const csv = exportLedgerCSV(filtered);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "ledger.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <PageLayout
      title="Ledger"
      subtitle="Every rupee in, every rupee out."
      actions={
        <button onClick={onExport} className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3.5 py-2 text-sm font-medium text-foreground transition active:scale-[0.97]">
          <Download className="size-4" /> Export
        </button>
      }
    >
      {/* Filters */}
      <div className="glass mb-4 rounded-2xl p-3 md:p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search description or merchant…"
              className="w-full rounded-xl border border-white/70 bg-white/70 py-2 pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
          <select
            value={spendClass}
            onChange={(e) => { setSpendClass(e.target.value as any); setPage(1); }}
            className="rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm"
          >
            <option value="ALL">All spend classes</option>
            <option value="ESSENTIAL">Essential</option>
            <option value="DISCRETIONARY">Discretionary</option>
          </select>
          <label className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={showRunning}
              onChange={(e) => setShowRunning(e.target.checked)}
            />
            Running balance
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {allCategories.map((c) => {
            const on = cats.includes(c);
            return (
              <button
                key={c}
                onClick={() => { toggleCat(c); setPage(1); }}
                className={`chip transition ${on ? "bg-primary text-primary-foreground" : "bg-white/70 text-foreground/70 hover:bg-white"}`}
              >
                {c.replace("_", " ")}
              </button>
            );
          })}
          {(cats.length > 0 || spendClass !== "ALL" || search) && (
            <button
              onClick={() => { setCats([]); setSpendClass("ALL"); setSearch(""); setPage(1); }}
              className="chip bg-destructive/15 text-destructive"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Table - desktop / cards - mobile */}
      <div className="glass overflow-hidden rounded-2xl">
        {/* Desktop table */}
        <div className="hidden md:block">
          <table className="w-full text-sm">
            <thead className="bg-white/60 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5">Time</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5">Description</th>
                <th className="px-4 py-2.5">Class</th>
                <th className="px-4 py-2.5 text-right">Amount</th>
                {showRunning && <th className="px-4 py-2.5 text-right">Balance</th>}
                <th className="px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((e) => (
                <tr key={e.id} className="group border-t border-white/60 transition hover:bg-white/55">
                  <td className="px-4 py-2.5 text-muted-foreground">{fmtTime(e.timestampMs)}</td>
                  <td className="px-4 py-2.5"><CategoryBadge category={e.category} /></td>
                  <td className="px-4 py-2.5 text-foreground">{e.merchantName ?? e.description}</td>
                  <td className="px-4 py-2.5">
                    {e.spendClass === "ESSENTIAL" && <span className="chip bg-success/15 text-success-foreground">Essential</span>}
                    {e.spendClass === "DISCRETIONARY" && <span className="chip bg-warning/20 text-warning-foreground">Discretionary</span>}
                  </td>
                  <td className={`num px-4 py-2.5 text-right font-semibold ${e.amount > 0 ? "text-success-foreground" : "text-destructive"}`}>
                    {e.amount > 0 ? "+" : "−"}{fmtINR(Math.abs(e.amount))}
                  </td>
                  {showRunning && (
                    <td className="num px-4 py-2.5 text-right text-muted-foreground">{fmtINR(running.get(e.id) ?? 0)}</td>
                  )}
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{e.status ?? "VERIFIED"}</td>
                </tr>
              ))}
              {slice.length === 0 && (
                <tr><td colSpan={showRunning ? 7 : 6} className="px-4 py-12 text-center text-sm text-muted-foreground">No entries match your filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="divide-y divide-white/60 md:hidden">
          {slice.map((e) => (
            <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 p-3">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2">
                  <CategoryBadge category={e.category} />
                  <span className="text-[11px] text-muted-foreground">{fmtTime(e.timestampMs)}</span>
                </div>
                <div className="truncate text-sm text-foreground">{e.merchantName ?? e.description}</div>
              </div>
              <div className={`num shrink-0 text-sm font-semibold ${e.amount > 0 ? "text-success-foreground" : "text-destructive"}`}>
                {e.amount > 0 ? "+" : "−"}{fmtINR(Math.abs(e.amount))}
              </div>
            </div>
          ))}
          {slice.length === 0 && (
            <div className="p-10 text-center text-sm text-muted-foreground">No entries.</div>
          )}
        </div>
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
        <span>Showing {slice.length} of {filtered.length}</span>
        <div className="flex items-center gap-1">
          <button
            disabled={page === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg bg-white/70 px-3 py-1.5 font-medium text-foreground disabled:opacity-40"
          >Prev</button>
          <span className="px-2">Page {page} / {pageCount}</span>
          <button
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            className="rounded-lg bg-white/70 px-3 py-1.5 font-medium text-foreground disabled:opacity-40"
          >Next</button>
        </div>
      </div>
    </PageLayout>
  );
}
