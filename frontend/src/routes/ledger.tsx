import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Search, Download, Minus } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { PageLayout } from "@/components/layout/PageLayout";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { getLedger, exportLedgerCSV, submitDeduction, overrideRejection } from "@/lib/dataService";
import { fmtINR, fmtTime } from "@/lib/formatters";
import { useToast } from "@/lib/toast";
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

  // ── Penalty Modal state ───────────────────────────────────────────────────
  const [showPenalty, setShowPenalty] = useState(false);
  const [penaltyAmount, setPenaltyAmount] = useState(100);
  const [penaltyReason, setPenaltyReason] = useState("");
  const [penaltyResult, setPenaltyResult] = useState<any>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const penaltyMutation = useMutation({
    mutationFn: submitDeduction,
    onSuccess: (data) => {
      setPenaltyResult(data);
      if (data.verdict !== "REJECTED") {
        qc.invalidateQueries({ queryKey: ["ledger"] });
        qc.invalidateQueries({ queryKey: ["balance"] });
      }
    },
    onError: () => toast("Failed to submit penalty"),
  });

  const overrideMutation = useMutation({
    mutationFn: overrideRejection,
    onSuccess: (data) => {
      toast(`Penalty applied with ${fmtINR(data.stubbornness_tax)} stubbornness tax. Balance: ${fmtINR(data.new_balance)}`);
      qc.invalidateQueries({ queryKey: ["ledger"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
      setPenaltyResult(null);
      setShowPenalty(false);
    },
    onError: () => toast("Override failed"),
  });

  const closePenalty = () => {
    setShowPenalty(false);
    setPenaltyResult(null);
    setPenaltyReason("");
    setPenaltyAmount(100);
  };

  return (
    <PageLayout
      title="Ledger"
      subtitle="Every rupee in, every rupee out."
      actions={
        <div className="flex gap-2">
          <button
            onClick={() => setShowPenalty(true)}
            className="inline-flex items-center gap-2 rounded-xl bg-destructive/10 px-3.5 py-2 text-sm font-medium text-destructive transition active:scale-[0.97] hover:bg-destructive/20"
          >
            <Minus className="size-4" /> Self-Penalty
          </button>
          <button onClick={onExport} className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3.5 py-2 text-sm font-medium text-foreground transition active:scale-[0.97]">
            <Download className="size-4" /> Export
          </button>
        </div>
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

      {/* Self-Penalty Modal */}
      <AnimatePresence>
        {showPenalty && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
            onClick={closePenalty}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="glass w-full max-w-md rounded-3xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              {!penaltyResult ? (
                <>
                  <h3 className="text-base font-semibold">Apply Self-Penalty</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    AI will validate your penalty is fair and proportional. Be specific about what you did.
                  </p>

                  <div className="mt-4">
                    <label className="block text-xs font-medium text-foreground/70 mb-1">
                      Amount: <span className="text-foreground font-semibold">{fmtINR(penaltyAmount)}</span>
                    </label>
                    <input
                      type="range" min={10} max={1000} step={10}
                      value={penaltyAmount}
                      onChange={(e) => setPenaltyAmount(Number(e.target.value))}
                      className="w-full accent-destructive"
                    />
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
                      <span>₹10</span><span>₹1,000</span>
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs font-medium text-foreground/70 mb-1">
                      Reason <span className="text-muted-foreground">(min 20 chars — be specific!)</span>
                    </label>
                    <textarea
                      value={penaltyReason}
                      onChange={(e) => setPenaltyReason(e.target.value)}
                      placeholder="e.g. I spent 2 hours scrolling Reddit instead of studying Chapter 5 of DBMS..."
                      rows={3}
                      className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 resize-none"
                    />
                    <div className={`text-right text-[10px] mt-0.5 ${penaltyReason.length < 20 ? "text-destructive" : "text-muted-foreground"}`}>
                      {penaltyReason.length}/20 min
                    </div>
                  </div>

                  <div className="mt-4 flex gap-2">
                    <button onClick={closePenalty} className="flex-1 rounded-xl bg-white/70 py-2 text-sm font-medium">
                      Cancel
                    </button>
                    <button
                      onClick={() => penaltyMutation.mutate({ amount: penaltyAmount, reason: penaltyReason })}
                      disabled={penaltyMutation.isPending || penaltyReason.length < 20}
                      className="flex-1 rounded-xl bg-destructive px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 active:scale-95 transition"
                    >
                      {penaltyMutation.isPending ? "AI checking..." : "Submit to AI"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className={`text-center mb-4 ${penaltyResult.verdict === "REJECTED" ? "text-destructive" : "text-emerald-600"}`}>
                    {penaltyResult.verdict === "APPROVED" && "✅"}
                    {penaltyResult.verdict === "REDUCED"  && "⚖️"}
                    {penaltyResult.verdict === "REJECTED" && "❌"}
                    <span className="ml-2 text-base font-bold">{penaltyResult.verdict}</span>
                  </div>

                  <p className="text-sm text-center text-muted-foreground mb-4">{penaltyResult.reasoning}</p>

                  {penaltyResult.verdict !== "REJECTED" && (
                    <div className="rounded-2xl bg-destructive/10 p-3 text-center text-sm mb-4">
                      <span className="font-semibold text-destructive">−{fmtINR(penaltyResult.amount_deducted)}</span>
                      {penaltyResult.original_amount !== penaltyResult.amount_deducted && (
                        <span className="ml-2 text-xs text-muted-foreground line-through">−{fmtINR(penaltyResult.original_amount)}</span>
                      )}
                      <div className="text-xs text-muted-foreground mt-1">New balance: {fmtINR(penaltyResult.new_balance ?? 0)}</div>
                    </div>
                  )}

                  {penaltyResult.verdict === "REJECTED" && (
                    <div className="rounded-2xl bg-warning/10 p-3 text-xs text-warning-foreground mb-4">
                      <b>Override available</b> — apply anyway with a 20% stubbornness tax.
                      <br />Total cost: <b>{fmtINR(penaltyResult.override_cost ?? 0)}</b>
                      {" "}(incl. ₹{penaltyResult.override_tax} stubbornness tax)
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={closePenalty} className="flex-1 rounded-xl bg-white/70 py-2 text-sm font-medium">
                      Close
                    </button>
                    {penaltyResult.verdict === "REJECTED" && (
                      <button
                        onClick={() => overrideMutation.mutate(penaltyResult.deduction_id)}
                        disabled={overrideMutation.isPending}
                        className="flex-1 rounded-xl bg-warning px-4 py-2 text-sm font-semibold text-warning-foreground disabled:opacity-50 active:scale-95 transition"
                      >
                        {overrideMutation.isPending ? "Overriding..." : "Override (+20% tax)"}
                      </button>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </PageLayout>
  );
}
