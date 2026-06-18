import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useState } from "react";
import { Plus, FileSignature, AlertTriangle } from "lucide-react";

import { PageLayout } from "@/components/layout/PageLayout";
import { Modal } from "@/components/ui/Modal";
import { CreditScoreRing } from "@/components/charts/CreditScoreRing";
import { createOath, getCreditScore, getOaths, repayOath } from "@/lib/dataService";
import { fmtDate, fmtINR } from "@/lib/formatters";
import { useToast } from "@/lib/toast";
import type { Oath } from "@/lib/types";

export const Route = createFileRoute("/oaths")({
  head: () => ({
    meta: [
      { title: "Oaths · Productivity Economy" },
      { name: "description", content: "Loan smart contracts that fund real-world spending." },
    ],
  }),
  component: OathsPage,
});

function OathsPage() {
  const oaths  = useQuery({ queryKey: ["oaths"], queryFn: getOaths });
  const credit = useQuery({ queryKey: ["credit"], queryFn: getCreditScore });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const all = oaths.data ?? [];
  const active = all.filter((o) => o.status === "ACTIVE" || o.status === "OVERDUE");
  const history = all.filter((o) => o.status !== "ACTIVE" && o.status !== "OVERDUE");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["oaths"] });
    qc.invalidateQueries({ queryKey: ["balance"] });
  };

  return (
    <PageLayout
      title="Oaths"
      subtitle="Borrow virtual ₹ now, study it off later. Or pay interest forever."
      actions={
        <button
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition active:scale-[0.97]"
        >
          <Plus className="size-4" /> Take New Oath
        </button>
      }
    >
      {/* Active oaths */}
      <div className="grid gap-3 md:grid-cols-2">
        {active.length === 0 ? (
          <div className="glass col-span-full grid place-items-center rounded-2xl p-10 text-center">
            <FileSignature className="mb-3 size-9 text-muted-foreground" />
            <div className="text-base font-semibold">No active oaths</div>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Take a loan to fund real-world spending. Pay it down with focus sessions.
            </p>
            <button
              onClick={() => setOpen(true)}
              className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Take an Oath
            </button>
          </div>
        ) : (
          active.map((o, i) => <OathCard key={o.id} oath={o} index={i} onRepay={async () => {
            try {
              const result = await repayOath(o.id);
              refresh();
              const delta = result.credit_score_delta;
              const deltaStr = delta > 0 ? ` (+${delta} credit)` : delta < 0 ? ` (${delta} credit)` : "";
              toast(`Oath repaid — ${result.resolved_status?.replace(/_/g, " ").toLowerCase() ?? "done"}${deltaStr}`);
            } catch (err: any) {
              toast(`Repay failed: ${err.message ?? "insufficient balance or server error"}`);
            }
          }} />)
        )}
      </div>

      {/* Credit score */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass mt-4 grid items-center gap-6 rounded-2xl p-5 md:grid-cols-[auto_1fr]"
      >
        {credit.data && <CreditScoreRing score={credit.data.score} tier={credit.data.tier} />}
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight">Oath Credit Score</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Higher tiers unlock lower daily interest and longer loan terms.
          </p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {(credit.data?.recentEvents ?? []).map((ev, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="text-foreground/80">{ev.label}</span>
                <span className={`num font-semibold ${ev.delta > 0 ? "text-success-foreground" : "text-destructive"}`}>
                  {ev.delta > 0 ? "+" : ""}{ev.delta}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </motion.div>

      {/* History */}
      <div className="mt-4">
        <h2 className="mb-2 text-sm font-semibold tracking-tight text-muted-foreground">History</h2>
        <div className="grid gap-2 md:grid-cols-3">
          {history.map((o) => (
            <div key={o.id} className="glass rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{o.task}</div>
                  <div className="text-[11px] text-muted-foreground">{fmtDate(o.dueMs)}</div>
                </div>
                <StatusPill status={o.status} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <NewOathModal
        open={open}
        onClose={() => setOpen(false)}
        creditTier={credit.data?.tier ?? "GOLD"}
        onCreated={(o) => {
          refresh();
          toast(`Oath taken: ${fmtINR(o.loanAmount)} added to balance.`);
        }}
      />
    </PageLayout>
  );
}

function OathCard({ oath, onRepay, index }: { oath: Oath; onRepay: () => void; index: number }) {
  const totalDays = Math.max(1, Math.ceil((oath.dueMs - oath.createdMs) / 86400_000));
  const daysLeft  = Math.ceil((oath.dueMs - Date.now()) / 86400_000);
  const pct = Math.max(0, Math.min(100, ((totalDays - daysLeft) / totalDays) * 100));
  const overdue = oath.status === "OVERDUE";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="glass relative overflow-hidden rounded-2xl p-5"
    >
      {overdue && (
        <span className="chip absolute right-4 top-4 bg-destructive/15 text-destructive">
          <AlertTriangle className="size-3" /> OVERDUE
        </span>
      )}
      <h3 className="pr-20 text-base font-semibold tracking-tight">{oath.task}</h3>
      <div className="mt-1 text-xs text-muted-foreground">Due {fmtDate(oath.dueMs)}</div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Original</div>
          <div className="num text-lg font-semibold">{fmtINR(oath.loanAmount)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current debt</div>
          <div className={`num text-lg font-semibold ${oath.currentDebt > oath.loanAmount ? "text-destructive" : ""}`}>
            {fmtINR(oath.currentDebt)}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>{daysLeft > 0 ? `${daysLeft} days left` : `${Math.abs(daysLeft)} days overdue`}</span>
          <span>{(oath.dailyInterest * 100).toFixed(1)}%/day · {oath.tier}</span>
        </div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full ${overdue ? "bg-destructive" : "bg-primary"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <button
        onClick={onRepay}
        className="mt-4 w-full rounded-xl bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition active:scale-[0.97]"
      >
        Repay {fmtINR(oath.currentDebt)} now
      </button>
    </motion.div>
  );
}

function StatusPill({ status }: { status: Oath["status"] }) {
  const map: Record<string, string> = {
    ACTIVE:         "bg-primary/15 text-primary",
    OVERDUE:        "bg-destructive/15 text-destructive",
    REPAID_EARLY:   "bg-success/15 text-success-foreground",
    REPAID_ONTIME:  "bg-sky-500/15 text-sky-700",
    REPAID_ON_TIME: "bg-sky-500/15 text-sky-700",
    DEFAULTED:      "bg-destructive/15 text-destructive",
  };
  const label = status.replace(/_/g, " ").toLowerCase();
  return <span className={`chip ${map[status]}`}>{label}</span>;
}

function NewOathModal({
  open, onClose, onCreated, creditTier,
}: { open: boolean; onClose: () => void; onCreated: (o: Oath) => void; creditTier: string }) {
  const [task, setTask] = useState("");
  const [amount, setAmount] = useState(500);
  const [due, setDue] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().slice(0, 10);
  });

  const rate = creditTier === "PLATINUM" ? 0.01 : creditTier === "GOLD" ? 0.02 : creditTier === "SILVER" ? 0.035 : 0.06;
  const days = Math.max(1, Math.ceil((new Date(due).getTime() - Date.now()) / 86400_000));
  const ifDefaulted = Math.round(amount * Math.pow(1 + rate, days));

  return (
    <Modal open={open} onClose={onClose} title="Take a new oath">
      <div className="space-y-3">
        <Field label="Task description">
          <input
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="What will you finish?"
            className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Loan amount (₹)">
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(+e.target.value)}
              className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm"
            />
          </Field>
          <Field label="Due date">
            <input
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm"
            />
          </Field>
        </div>
        <div className="rounded-xl bg-muted/60 p-3 text-xs text-foreground/70">
          <div>Tier: <b>{creditTier}</b> · daily rate <b>{(rate * 100).toFixed(2)}%</b></div>
          <div className="mt-0.5">If defaulted after {days} days: <b className="text-destructive">{fmtINR(ifDefaulted)}</b></div>
        </div>
        <button
          disabled={!task.trim() || amount <= 0}
          onClick={async () => {
            const o = await createOath({ task, loanAmount: amount, dueMs: new Date(due).getTime() });
            onCreated(o);
            onClose();
            setTask("");
          }}
          className="w-full rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          Confirm oath
        </button>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
