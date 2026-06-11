import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { useMemo, useState, useEffect } from "react";

import { PageLayout } from "@/components/layout/PageLayout";
import { StatCard } from "@/components/ui/StatCard";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { HeatmapCalendar } from "@/components/charts/HeatmapCalendar";
import { getDailyStats, getSessions, getStreak } from "@/lib/dataService";
import { fmtDuration, fmtINR, fmtTime } from "@/lib/formatters";
import type { NfcSession } from "@/lib/types";

export const Route = createFileRoute("/focus")({
  head: () => ({
    meta: [
      { title: "Focus Sessions · Productivity Economy" },
      { name: "description", content: "NFC desk-tag focus session history and study heatmap." },
    ],
  }),
  component: FocusPage,
});

// ── Live elapsed timer (updates every second for open sessions) ───────────────
function useLiveElapsed(startMs: number, isOpen: boolean) {
  const [elapsed, setElapsed] = useState(() =>
    isOpen ? Math.floor((Date.now() - startMs) / 1000) : 0
  );

  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startMs) / 1000)),
      1000
    );
    return () => clearInterval(id);
  }, [startMs, isOpen]);

  return elapsed; // seconds
}

function fmtElapsed(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m ${s.toString().padStart(2, "0")}s`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

// ── Session card with a live pulsing timer for open sessions ─────────────────
function SessionCard({ s, i }: { s: NfcSession; i: number }) {
  const elapsed = useLiveElapsed(s.startMs, s.isOpen);

  const start = new Date(s.startMs);
  const startMinOfDay = start.getHours() * 60 + start.getMinutes();

  // For the day-bar: use live elapsed for open sessions
  const durationForBar = s.isOpen ? elapsed / 60 : s.durationMin;
  const widthPct = Math.min((durationForBar / (24 * 60)) * 100, 100);
  const leftPct = (startMinOfDay / (24 * 60)) * 100;

  return (
    <motion.div
      key={s.id}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.04 }}
      className={`glass rounded-2xl p-4 md:p-5 ${s.isOpen ? "ring-2 ring-violet/60" : ""}`}
      style={s.isOpen ? { background: "rgba(124,58,237,0.07)" } : undefined}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold tracking-tight">{s.tagLabel}</h3>
          {s.isOpen ? (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-400">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400"
                style={{ animation: "pulse 1s infinite" }}
              />
              RUNNING
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              STOPPED
            </span>
          )}
        </div>
        <div className="num text-sm text-success-foreground">
          {s.isOpen ? (
            <span className="text-muted-foreground italic text-xs">earning in progress…</span>
          ) : (
            <>
              {fmtINR(s.baseEarned)} × {s.multiplier.toFixed(1)}× ={" "}
              <span className="font-semibold">{fmtINR(s.finalEarned)}</span>
            </>
          )}
        </div>
      </div>

      {/* Time row */}
      <div className="mt-1 text-xs text-muted-foreground">
        {s.isOpen ? (
          <>
            Started: {fmtTime(s.startMs)} &nbsp;·&nbsp;
            <span className="font-mono text-emerald-400 font-semibold">
              ⏱ {fmtElapsed(elapsed)}
            </span>
          </>
        ) : (
          <>
            {fmtTime(s.startMs)} → {s.endMs != null ? fmtTime(s.endMs) : "—"} ·{" "}
            {fmtDuration(s.durationMin)}
          </>
        )}
      </div>

      {/* Day-bar */}
      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute h-full rounded-full bg-gradient-to-r from-violet to-primary transition-all duration-1000"
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>00:00</span>
        <span>12:00</span>
        <span>24:00</span>
      </div>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
function FocusPage() {
  const sessions = useQuery({
    queryKey: ["sessions"],
    queryFn: getSessions,
    refetchInterval: 10_000,   // poll every 10s to catch new taps
  });
  const stats  = useQuery({ queryKey: ["stats"],  queryFn: getDailyStats });
  const streak = useQuery({ queryKey: ["streak"], queryFn: getStreak });

  const data = sessions.data ?? [];

  // Open sessions should always appear; for "this week" also include them
  const weekMs = Date.now() - 7 * 86400_000;
  const week = data.filter((s) => s.isOpen || (s.endMs != null && s.endMs >= weekMs));
  const weekHours  = week.filter((s) => !s.isOpen).reduce((a, x) => a + x.durationMin, 0) / 60;
  const weekEarned = week.filter((s) => !s.isOpen).reduce((a, x) => a + x.finalEarned, 0);

  const longestToday = useMemo(() => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const today = data.filter((s) => s.startMs >= todayStart.getTime() && !s.isOpen);
    return today.reduce((m, s) => Math.max(m, s.durationMin), 0);
  }, [data]);

  const streakMult =
    (streak.data ?? 0) >= 7 ? 2.0 :
    (streak.data ?? 0) >= 5 ? 1.5 :
    (streak.data ?? 0) >= 3 ? 1.2 : 1.0;

  const hasLive = data.some((s) => s.isOpen);

  return (
    <PageLayout
      title="Focus Sessions"
      subtitle="NFC desk-tag work, logged minute by minute."
    >
      {/* Live session banner */}
      <AnimatePresence>
        {hasLive && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
          >
            <span
              className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400"
              style={{ animation: "pulse 1s infinite" }}
            />
            <span className="text-sm font-semibold text-emerald-400">
              Focus session in progress — tap your desk tag again to stop and earn.
            </span>
          </motion.div>
        )}
      </AnimatePresence>

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
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass mt-4 rounded-2xl p-4 md:p-5"
      >
        <h2 className="mb-4 text-sm font-semibold tracking-tight">Study heatmap · last 6 months</h2>
        {stats.data && <HeatmapCalendar data={stats.data} />}
      </motion.div>

      <div className="mt-4 grid gap-3">
        {data.length === 0 && (
          <p className="text-center text-sm text-muted-foreground py-8">
            No sessions yet. Tap your NFC desk tag to start tracking.
          </p>
        )}
        {data.map((s, i) => (
          <SessionCard key={s.id} s={s} i={i} />
        ))}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </PageLayout>
  );
}
