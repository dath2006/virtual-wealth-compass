import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Flame, Sparkles, Trophy } from "lucide-react";

import { PageLayout } from "@/components/layout/PageLayout";
import { getBossFights, getDailyStats, getMercyTokens, getStreak } from "@/lib/dataService";
import { fmtINR } from "@/lib/formatters";

export const Route = createFileRoute("/achievements")({
  head: () => ({
    meta: [
      { title: "Achievements · Productivity Economy" },
      { name: "description", content: "Streaks, boss fights, mercy tokens, and loot drops." },
    ],
  }),
  component: AchievementsPage,
});

function AchievementsPage() {
  const bosses = useQuery({ queryKey: ["bosses"], queryFn: getBossFights });
  const streak = useQuery({ queryKey: ["streak"], queryFn: getStreak });
  const mercy  = useQuery({ queryKey: ["mercy"],  queryFn: getMercyTokens });
  const stats  = useQuery({ queryKey: ["stats"],  queryFn: getDailyStats });

  const last30 = (stats.data ?? []).slice(0, 30).reverse();

  return (
    <PageLayout
      title="Achievements"
      subtitle="Streaks, boss fights, and the loot you've earned."
    >
      {/* Boss fights */}
      <div className="grid gap-3 md:grid-cols-2">
        {(bosses.data ?? []).map((b, i) => {
          const daysLeft = Math.max(0, Math.ceil((b.deadlineMs - Date.now()) / 86400_000));
          const pct = Math.min(100, (b.currentHours / b.targetHours) * 100);
          return (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="glass relative overflow-hidden rounded-2xl p-5"
            >
              <div className="absolute right-4 top-4 flex items-center gap-1 text-warning-foreground">
                <Trophy className="size-4" />
              </div>
              <h3 className="text-base font-semibold tracking-tight">{b.title}</h3>
              <div className="mt-1 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold">{daysLeft}</span>
                <span className="text-sm text-muted-foreground">days left</span>
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Target: study <b className="text-foreground">{b.targetHours}h</b> before deadline
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                <motion.div
                  initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                  className="h-full bg-gradient-to-r from-violet to-primary"
                />
              </div>
              <div className="num mt-1 text-right text-[11px] text-muted-foreground">
                {b.currentHours.toFixed(1)}h / {b.targetHours}h
              </div>
              <div className="mt-3 rounded-xl bg-warning/15 p-2.5 text-xs text-warning-foreground">
                <Sparkles className="mr-1 inline size-3" />
                Loot: {b.lootDescription} ({fmtINR(b.lootAmount)})
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Streak */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass rounded-2xl p-6 text-center"
        >
          <Flame className="mx-auto size-12 animate-pulse text-warning-foreground" fill="currentColor" />
          <div className="mt-2 text-5xl font-semibold">{streak.data ?? 0}</div>
          <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">day streak</div>

          <div className="mt-5 grid grid-cols-15 gap-1" style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}>
            {last30.map((d, i) => (
              <div
                key={i}
                title={`${d.dateISO}: ${d.studyMin}m`}
                className={`aspect-square rounded ${
                  d.hit ? "bg-success/70"
                    : d.mercyUsed ? "bg-warning/70"
                    : "bg-destructive/40"
                }`}
              />
            ))}
          </div>
          <div className="mt-2 flex justify-center gap-3 text-[10px] text-muted-foreground">
            <span className="inline-flex items-center gap-1"><i className="block size-2 rounded bg-success/70" /> hit</span>
            <span className="inline-flex items-center gap-1"><i className="block size-2 rounded bg-warning/70" /> mercy</span>
            <span className="inline-flex items-center gap-1"><i className="block size-2 rounded bg-destructive/40" /> missed</span>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="glass rounded-2xl p-6"
        >
          <h3 className="text-sm font-semibold tracking-tight">Mercy Tokens</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Skip a day without breaking your streak. Earn one for every 14-day streak.
          </p>
          <div className="mt-4 flex items-center gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={`grid size-12 place-items-center rounded-full border-2 ${
                  i < (mercy.data ?? 0)
                    ? "border-warning bg-gradient-to-br from-warning to-warning-foreground/30 text-warning-foreground shadow-sm"
                    : "border-dashed border-muted-foreground/40 text-muted-foreground/40"
                }`}
              >
                ✦
              </div>
            ))}
            <span className="num ml-3 text-2xl font-semibold">{mercy.data ?? 0} / 3</span>
          </div>
          <div className="mt-4 text-[11px] text-muted-foreground">Last used: never</div>
        </motion.div>
      </div>

      {/* Loot history */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="glass mt-4 rounded-2xl p-5"
      >
        <h3 className="mb-3 text-sm font-semibold tracking-tight">Loot drop log</h3>
        <ul className="space-y-1.5 text-sm">
          {[
            { d: "5 days ago", t: "Free Scroll Pass (Instagram, 15 min)" },
            { d: "12 days ago", t: "₹250 payout — DSA contest victory" },
            { d: "24 days ago", t: "Mercy Token + ₹100 — 14-day streak" },
          ].map((l, i) => (
            <li key={i} className="flex items-center justify-between rounded-lg bg-white/55 px-3 py-2">
              <span>{l.t}</span>
              <span className="text-xs text-muted-foreground">{l.d}</span>
            </li>
          ))}
        </ul>
      </motion.div>
    </PageLayout>
  );
}
