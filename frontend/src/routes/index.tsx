import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { motion } from "framer-motion";
import { Flame, TrendingDown, TrendingUp } from "lucide-react";
import { useMemo } from "react";

import { PageLayout } from "@/components/layout/PageLayout";
import { StatCard } from "@/components/ui/StatCard";
import { BalanceDisplay } from "@/components/ui/BalanceDisplay";
import { CategoryBadge } from "@/components/ui/CategoryBadge";
import { CreditScoreRing } from "@/components/charts/CreditScoreRing";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";

import {
  getBalance, getCreditScore, getLedger, getOaths, getStreak, getSettings,
} from "@/lib/dataService";
import { fmtINR, fmtRelative } from "@/lib/formatters";
import { toISODate } from "@/lib/formatters";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard · Productivity Economy" },
      { name: "description", content: "Track your virtual balance, earnings, and spending at a glance." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const ledger    = useQuery({ queryKey: ["ledger"],   queryFn: getLedger });
  const balance   = useQuery({ queryKey: ["balance"],  queryFn: getBalance });
  const streak    = useQuery({ queryKey: ["streak"],   queryFn: getStreak });
  const credit    = useQuery({ queryKey: ["credit"],   queryFn: getCreditScore });
  const oaths     = useQuery({ queryKey: ["oaths"],    queryFn: getOaths });
  const settings  = useQuery({ queryKey: ["settings"], queryFn: getSettings });

  const todayISO = toISODate(Date.now());
  const todayEntries = useMemo(
    () => (ledger.data ?? []).filter((e) => toISODate(e.timestampMs) === todayISO),
    [ledger.data, todayISO],
  );
  const earnedToday = todayEntries.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0);
  const spentToday  = todayEntries.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0);

  const streakMult =
    (streak.data ?? 0) >= 7 ? 2.0 :
    (streak.data ?? 0) >= 5 ? 1.5 :
    (streak.data ?? 0) >= 3 ? 1.2 : 1.0;

  // Balance history (30 days)
  const series = useMemo(() => {
    const buckets = new Map<string, { earned: number; spent: number }>();
    for (let d = 29; d >= 0; d--) {
      const key = toISODate(Date.now() - d * 86400_000);
      buckets.set(key, { earned: 0, spent: 0 });
    }
    for (const e of ledger.data ?? []) {
      const k = toISODate(e.timestampMs);
      const b = buckets.get(k);
      if (!b) continue;
      if (e.amount > 0) b.earned += e.amount;
      else              b.spent  += -e.amount;
    }
    return Array.from(buckets.entries()).map(([date, v]) => ({
      date: date.slice(5),
      earned: v.earned,
      spent: v.spent,
    }));
  }, [ledger.data]);

  // Monthly discretionary spend
  const monthSpend = useMemo(() => {
    return (ledger.data ?? [])
      .filter((e) => e.spendClass === "DISCRETIONARY")
      .filter((e) => new Date(e.timestampMs).getMonth() === new Date().getMonth())
      .reduce((s, e) => s + Math.abs(e.amount), 0);
  }, [ledger.data]);
  const monthBudget = settings.data?.monthlyDiscretionaryBudget ?? 3000;
  const monthPct = Math.min(100, (monthSpend / monthBudget) * 100);

  const activeOaths = (oaths.data ?? []).filter((o) => o.status === "ACTIVE" || o.status === "OVERDUE");
  const totalDebt   = activeOaths.reduce((s, o) => s + o.currentDebt, 0);

  const bal = balance.data ?? 0;
  const bankrupt = bal < 0;

  return (
    <PageLayout
      title="Dashboard"
      subtitle="Your virtual economy, today."
    >
      {/* Hero stat row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard label="Virtual Balance" accent={bankrupt ? "destructive" : "violet"} index={0}>
          <BalanceDisplay balance={bal} />
        </StatCard>
        <StatCard label="Earned Today" accent="success" index={1}
          hint={<span className="inline-flex items-center gap-1"><TrendingUp className="size-3" /> from focus, steps & loot</span>}>
          <span className="text-success-foreground"><AnimatedCounter value={earnedToday} currency /></span>
        </StatCard>
        <StatCard label="Spent Today" accent="destructive" index={2}
          hint={<span className="inline-flex items-center gap-1"><TrendingDown className="size-3" /> UPI · distraction · tax</span>}>
          <span className="text-destructive"><AnimatedCounter value={Math.abs(spentToday)} currency /></span>
        </StatCard>
        <StatCard label="Streak" accent="warning" index={3}
          hint={<span>Daily target hit</span>}>
          <span className="inline-flex items-center gap-2">
            <Flame className="size-7 text-warning-foreground" fill="currentColor" />
            <span><AnimatedCounter value={streak.data ?? 0} suffix=" days" /></span>
            <span className="chip ml-1 bg-warning/30 text-warning-foreground">{streakMult.toFixed(1)}×</span>
          </span>
        </StatCard>
      </div>

      {/* Balance history */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="glass mt-4 rounded-2xl p-4 md:p-5 min-w-0"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Last 30 days</h2>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><i className="block size-2 rounded-full bg-violet" />Earned</span>
            <span className="inline-flex items-center gap-1.5"><i className="block size-2 rounded-full bg-destructive" />Spent</span>
          </div>
        </div>
        <div className="h-56 md:h-72">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <AreaChart data={series}>
              <defs>
                <linearGradient id="g-earn" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.62 0.2 290)" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="oklch(0.62 0.2 290)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="g-spent" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="oklch(0.68 0.18 25)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="oklch(0.68 0.18 25)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="oklch(0.9 0.015 280 / 50%)" vertical={false} />
              <XAxis dataKey="date" stroke="oklch(0.55 0.02 280)" fontSize={11} tickLine={false} axisLine={false} />
              <YAxis stroke="oklch(0.55 0.02 280)" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(v) => `₹${v}`} />
              <Tooltip content={<ChartTooltip />} />
              <Area type="monotone" dataKey="earned" stroke="oklch(0.55 0.2 290)" strokeWidth={2} fill="url(#g-earn)" animationDuration={900} />
              <Area type="monotone" dataKey="spent"  stroke="oklch(0.6 0.22 25)" strokeWidth={2} fill="url(#g-spent)" animationDuration={900} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </motion.div>

      {/* Activity + Health */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
          className="glass rounded-2xl p-4 md:p-5 lg:col-span-2"
        >
          <h2 className="mb-3 text-sm font-semibold tracking-tight">Today's activity</h2>
          {todayEntries.length === 0 ? (
            <div className="rounded-xl bg-white/55 p-6 text-center text-sm text-muted-foreground">
              Nothing logged today yet.
            </div>
          ) : (
            <ul className="space-y-1.5">
              {todayEntries.slice(0, 8).map((e) => (
                <li
                  key={e.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-2.5 py-2 hover:bg-white/55"
                >
                  <CategoryBadge category={e.category} />
                  <div className="min-w-0">
                    <div className="truncate text-sm text-foreground">
                      {e.merchantName ?? e.description}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {fmtRelative(e.timestampMs)}
                    </div>
                  </div>
                  <div className={`num shrink-0 text-sm font-semibold ${e.amount > 0 ? "text-success-foreground" : "text-destructive"}`}>
                    {e.amount > 0 ? "+" : "−"}{fmtINR(Math.abs(e.amount))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </motion.div>

        <div className="grid gap-4">
          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.3 }}
            className="glass flex items-center gap-5 rounded-2xl p-5"
          >
            {credit.data && <CreditScoreRing score={credit.data.score} tier={credit.data.tier} />}
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Oath credit score
              </div>
              <div className="mt-1 text-sm text-foreground/80">
                Tier unlocks lower interest rates and longer loan terms.
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.35 }}
            className="glass rounded-2xl p-5"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Monthly discretionary
            </div>
            <div className="mt-1 num text-lg font-semibold">
              {fmtINR(monthSpend)} <span className="text-sm font-normal text-muted-foreground">/ {fmtINR(monthBudget)}</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
              <motion.div
                initial={{ width: 0 }} animate={{ width: `${monthPct}%` }}
                transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                className={`h-full rounded-full ${monthPct > 90 ? "bg-destructive" : monthPct > 70 ? "bg-warning" : "bg-violet"}`}
              />
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.4 }}
            className="glass rounded-2xl p-5"
          >
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Active oaths
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-semibold">{activeOaths.length}</span>
              <span className="num text-sm text-destructive">{fmtINR(totalDebt)} debt</span>
            </div>
          </motion.div>
        </div>
      </div>
    </PageLayout>
  );
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-strong rounded-xl px-3 py-2 text-xs shadow">
      <div className="mb-1 font-semibold text-foreground">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="block size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground capitalize">{p.dataKey}</span>
          <span className="num ml-auto font-medium text-foreground">{fmtINR(p.value)}</span>
        </div>
      ))}
    </div>
  );
}
