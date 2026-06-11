import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { useMemo } from "react";

import { PageLayout } from "@/components/layout/PageLayout";
import { StatCard } from "@/components/ui/StatCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { HeatmapCalendar } from "@/components/charts/HeatmapCalendar";
import { getDailyStats, getSessions, getStreak } from "@/lib/dataService";
import { fmtDuration, fmtINR, fmtTime } from "@/lib/formatters";

export const Route = createFileRoute("/focus")({
  head: () => ({
    meta: [
      { title: "Focus Sessions · Productivity Economy" },
      { name: "description", content: "NFC desk-tag focus session history and study heatmap." },
    ],
  }),
  component: FocusPage,
});

function FocusPage() {
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: getSessions });
  const stats    = useQuery({ queryKey: ["stats"],    queryFn: getDailyStats });
  const streak   = useQuery({ queryKey: ["streak"],   queryFn: getStreak });

  const data = sessions.data ?? [];

  const weekMs = Date.now() - 7 * 86400_000;
  const week = data.filter((s) => s.endMs >= weekMs);
  const weekHours = week.reduce((s, x) => s + x.durationMin, 0) / 60;
  const weekEarned = week.reduce((s, x) => s + x.finalEarned, 0);

  const longestToday = useMemo(() => {
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const today = data.filter((s) => s.startMs >= todayStart.getTime());
    return today.reduce((m, s) => Math.max(m, s.durationMin), 0);
  }, [data]);

  const streakMult =
    (streak.data ?? 0) >= 7 ? 2.0 :
    (streak.data ?? 0) >= 5 ? 1.5 :
    (streak.data ?? 0) >= 3 ? 1.2 : 1.0;

  return (
    <PageLayout
      title="Focus Sessions"
      subtitle="NFC desk-tag work, logged minute by minute."
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <StatCard label="This week" index={0}>
          <span><AnimatedCounter value={weekHours} />h</span>
        </StatCard>
        <StatCard label="Earned this week" accent="success" index={1}>
          <span className="text-success-foreground"><AnimatedCounter value={weekEarned} currency /></span>
        </StatCard>
        <StatCard label="Streak multiplier" accent="warning" index={2}>
          <span>{streakMult.toFixed(1)}×</span>
        </StatCard>
        <StatCard label="Longest today" accent="violet" index={3}>
          <span>{fmtDuration(longestToday)}</span>
        </StatCard>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass mt-4 rounded-2xl p-4 md:p-5"
      >
        <h2 className="mb-4 text-sm font-semibold tracking-tight">Study heatmap · last 6 months</h2>
        {stats.data && <HeatmapCalendar data={stats.data} />}
      </motion.div>

      <div className="mt-4 grid gap-3">
        {data.map((s, i) => {
          const start = new Date(s.startMs);
          const startMinOfDay = start.getHours() * 60 + start.getMinutes();
          const widthPct = (s.durationMin / (24 * 60)) * 100;
          const leftPct = (startMinOfDay / (24 * 60)) * 100;
          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              className="glass rounded-2xl p-4 md:p-5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-semibold tracking-tight">{s.tagLabel}</h3>
                <div className="num text-sm text-success-foreground">
                  {fmtINR(s.baseEarned)} × {s.multiplier.toFixed(1)}× = <span className="font-semibold">{fmtINR(s.finalEarned)}</span>
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {fmtTime(s.startMs)} → {fmtTime(s.endMs)} · {fmtDuration(s.durationMin)}
              </div>
              <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute h-full rounded-full bg-gradient-to-r from-violet to-primary"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>00:00</span><span>12:00</span><span>24:00</span>
              </div>
            </motion.div>
          );
        })}
      </div>
    </PageLayout>
  );
}
