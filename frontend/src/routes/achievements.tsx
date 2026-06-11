import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Flame, Sparkles, Trophy, Bot, Target, Clock, CheckCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import {
  getBossFights, getDailyStats, getMercyTokens, getStreak,
  getAIChallenges,
} from "@/lib/dataService";
import { fmtINR } from "@/lib/formatters";

export const Route = createFileRoute("/achievements")({
  head: () => ({
    meta: [
      { title: "Achievements · Productivity Economy" },
      { name: "description", content: "Streaks, boss fights, AI challenges, mercy tokens, and loot drops." },
    ],
  }),
  component: AchievementsPage,
});

const METRIC_LABEL: Record<string, string> = {
  DISTRACTION_DRAIN_MAX:  "Max distraction drain",
  STUDY_HOURS_MIN:        "Min study hours",
  STREAK_DAYS:            "Streak days",
  EXERCISE_COUNT:         "Exercise sessions",
  SLEEP_QUALITY_MIN:      "Min sleep quality",
};

const REWARD_EMOJI: Record<string, string> = {
  RUPEE_PAYOUT:     "💰",
  MERCY_TOKEN:      "✦",
  MULTIPLIER_BOOST: "⚡",
};

function ChallengeCard({ c, idx }: { c: any; idx: number }) {
  const isMax = c.metric_type === "DISTRACTION_DRAIN_MAX";
  // For DISTRACTION_DRAIN_MAX: progress is how far BELOW the target we are (inverted)
  const pct = isMax
    ? Math.min(100, Math.max(0, ((c.metric_target - c.current_value) / c.metric_target) * 100))
    : Math.min(100, (c.current_value / c.metric_target) * 100);

  const daysLeft = Math.max(0, Math.ceil(
    (new Date(c.expires_at).getTime() - Date.now()) / 86400_000
  ));

  const isComplete = c.status === "COMPLETED";
  const isFailed   = c.status === "FAILED";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: idx * 0.07 }}
      className={`glass relative overflow-hidden rounded-2xl p-5 ${isComplete ? "ring-2 ring-emerald-400" : isFailed ? "opacity-60" : ""}`}
    >
      {isComplete && (
        <div className="absolute right-3 top-3 flex items-center gap-1 text-emerald-600 text-xs font-bold">
          <CheckCircle className="size-4" /> Complete!
        </div>
      )}
      {isFailed && (
        <div className="absolute right-3 top-3 flex items-center gap-1 text-destructive text-xs font-bold">
          <XCircle className="size-4" /> Failed
        </div>
      )}

      <div className="flex items-center gap-2 mb-1">
        <Bot className="size-4 shrink-0 text-violet" />
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">AI Challenge</span>
      </div>

      <h3 className="text-base font-semibold tracking-tight leading-snug">{c.title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>

      {/* Progress */}
      <div className="mt-3">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-muted-foreground">{METRIC_LABEL[c.metric_type] ?? c.metric_type}</span>
          <span className="font-medium">
            {isMax
              ? `${fmtINR(c.current_value)} / ₹${c.metric_target} cap`
              : `${typeof c.current_value === "number" && c.current_value < 10
                  ? c.current_value.toFixed(1) : Math.floor(c.current_value)
                } / ${c.metric_target}`
            }
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            className={`h-full ${isComplete ? "bg-emerald-400" : "bg-linear-to-r from-violet to-primary"}`}
          />
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="size-3" /> {daysLeft}d left
          </span>
          <span className="font-medium">{pct.toFixed(0)}%</span>
        </div>
      </div>

      {/* Reward */}
      <div className="mt-3 rounded-xl bg-warning/15 p-2.5 text-xs text-warning-foreground">
        <Sparkles className="mr-1 inline size-3" />
        <span className="font-semibold">{REWARD_EMOJI[c.reward_type] ?? "🎁"} Reward:</span>{" "}
        {c.reward_type === "RUPEE_PAYOUT"     && `₹${c.reward_value} payout`}
        {c.reward_type === "MERCY_TOKEN"      && `${c.reward_value} Mercy Token`}
        {c.reward_type === "MULTIPLIER_BOOST" && `+0.2× earning multiplier for 3 days`}
      </div>

      {/* AI Rationale */}
      {c.ai_rationale && (
        <div className="mt-2 text-[11px] text-muted-foreground italic">
          <Bot className="mr-1 inline size-3 opacity-50" />{c.ai_rationale}
        </div>
      )}
    </motion.div>
  );
}

function AchievementsPage() {
  const bosses     = useQuery({ queryKey: ["bosses"],     queryFn: getBossFights });
  const streak     = useQuery({ queryKey: ["streak"],     queryFn: getStreak });
  const mercy      = useQuery({ queryKey: ["mercy"],      queryFn: getMercyTokens });
  const stats      = useQuery({ queryKey: ["stats"],      queryFn: getDailyStats });
  const challenges = useQuery({ queryKey: ["ai_challenges"], queryFn: getAIChallenges });

  const last30 = (stats.data ?? []).slice(0, 30).reverse();
  const activeChallenges    = (challenges.data ?? []).filter((c: any) => c.status === "ACTIVE");
  const completedChallenges = (challenges.data ?? []).filter((c: any) => c.status === "COMPLETED");
  const failedChallenges    = (challenges.data ?? []).filter((c: any) => c.status === "FAILED" || c.status === "EXPIRED");

  return (
    <PageLayout
      title="Achievements"
      subtitle="Streaks, AI challenges, boss fights, and loot."
    >
      {/* AI Challenges */}
      {activeChallenges.length > 0 && (
        <section className="mb-4">
          <div className="mb-3 flex items-center gap-2">
            <Bot className="size-5 text-violet" />
            <h2 className="text-sm font-semibold tracking-tight">AI Weekly Challenges</h2>
            <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[10px] font-medium text-violet">
              {activeChallenges.length} active
            </span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {activeChallenges.map((c: any, i: number) => (
              <ChallengeCard key={c.id} c={c} idx={i} />
            ))}
          </div>
        </section>
      )}

      {/* Boss fights */}
      <div className="grid gap-3 md:grid-cols-2">
        {(bosses.data ?? []).map((b: any, i: number) => {
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
                  className="h-full bg-linear-to-r from-violet to-primary"
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
                    ? "border-warning bg-linear-to-br from-warning to-warning-foreground/30 text-warning-foreground shadow-sm"
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

      {/* Completed Challenges */}
      {completedChallenges.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="glass mt-4 rounded-2xl p-5"
        >
          <h3 className="mb-3 text-sm font-semibold tracking-tight flex items-center gap-2">
            <CheckCircle className="size-4 text-emerald-500" /> Completed This Week
          </h3>
          <ul className="space-y-1.5 text-sm">
            {completedChallenges.map((c: any) => (
              <li key={c.id} className="flex items-center justify-between rounded-lg bg-emerald-50/80 px-3 py-2">
                <span className="font-medium">{c.title}</span>
                <span className="text-xs text-emerald-600 font-semibold">
                  {REWARD_EMOJI[c.reward_type]} {c.reward_type === "RUPEE_PAYOUT" ? `+₹${c.reward_value}` : "Claimed"}
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </PageLayout>
  );
}
