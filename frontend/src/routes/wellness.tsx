import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { Moon, Sun, Dumbbell, Flame, Zap, TrendingUp, Clock, Star } from "lucide-react";
import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import { getWellnessDashboard, startSleep, wakeSleep, logExercise } from "@/lib/dataService";
import { useToast } from "@/lib/toast";
import { fmtINR } from "@/lib/formatters";

export const Route = createFileRoute("/wellness")({
  head: () => ({
    meta: [
      { title: "Wellness · Productivity Economy" },
      { name: "description", content: "Sleep quality, exercise earnings, and your physical economy." },
    ],
  }),
  component: WellnessPage,
});

const QUALITY_CONFIG = {
  EXCELLENT: { label: "Excellent", color: "bg-emerald-400", textColor: "text-emerald-700", mult: "+15%" },
  GOOD:      { label: "Good",      color: "bg-green-300",   textColor: "text-green-700",   mult: "±0%" },
  ADEQUATE:  { label: "Adequate",  color: "bg-yellow-300",  textColor: "text-yellow-700",  mult: "−5%" },
  POOR:      { label: "Poor",      color: "bg-orange-400",  textColor: "text-orange-700",  mult: "−15%" },
  BAD:       { label: "Bad",       color: "bg-red-400",     textColor: "text-red-700",     mult: "−25%" },
} as const;

const EXERCISE_TYPES = [
  { value: "RUNNING", label: "🏃 Running", icon: "🏃" },
  { value: "CYCLING", label: "🚴 Cycling", icon: "🚴" },
  { value: "GYM",     label: "🏋️ Gym",     icon: "🏋️" },
  { value: "YOGA",    label: "🧘 Yoga",    icon: "🧘" },
  { value: "SPORTS",  label: "⚽ Sports",  icon: "⚽" },
  { value: "WALK",    label: "🚶 Walk",    icon: "🚶" },
  { value: "OTHER",   label: "💪 Other",   icon: "💪" },
];

function SleepQualityDot({ quality }: { quality: string | null }) {
  if (!quality) return <div className="aspect-square rounded bg-muted/40" />;
  const cfg = QUALITY_CONFIG[quality as keyof typeof QUALITY_CONFIG] ?? QUALITY_CONFIG.GOOD;
  return <div className={`aspect-square rounded ${cfg.color} opacity-80`} title={cfg.label} />;
}

function ExerciseModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [type, setType] = useState("RUNNING");
  const [mins, setMins] = useState(30);

  const mutation = useMutation({
    mutationFn: logExercise,
    onSuccess: (data) => {
      toast(`🏋️ Logged! Earned ${fmtINR(data.earned)} for ${data.duration_minutes}min of ${data.exercise_type}`);
      qc.invalidateQueries({ queryKey: ["wellness"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
      onClose();
    },
    onError: () => toast("Failed to log exercise"),
  });

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="glass w-full max-w-sm rounded-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold tracking-tight">Log Exercise Session</h3>
        <p className="mt-1 text-xs text-muted-foreground">Earn virtual ₹ for physical activity</p>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {EXERCISE_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`flex flex-col items-center gap-1 rounded-2xl p-3 text-center text-xs font-medium transition active:scale-95 ${
                type === t.value
                  ? "bg-primary text-primary-foreground shadow-md"
                  : "bg-white/70 text-foreground/70 hover:bg-white"
              }`}
            >
              <span className="text-xl">{t.icon}</span>
              <span>{t.label.split(" ").slice(1).join(" ")}</span>
            </button>
          ))}
        </div>

        <div className="mt-4">
          <label className="block text-xs font-medium text-foreground/70 mb-1">
            Duration: <span className="text-foreground font-semibold">{mins} min</span>
          </label>
          <input
            type="range"
            min={10} max={180} step={5}
            value={mins}
            onChange={(e) => setMins(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
            <span>10 min</span><span>3 hrs</span>
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl bg-white/70 px-4 py-2 text-sm font-medium text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate({ exercise_type: type, duration_minutes: mins })}
            disabled={mutation.isPending}
            className="flex-1 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60 active:scale-95 transition"
          >
            {mutation.isPending ? "Logging..." : "Log & Earn"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function WellnessPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [showExerciseModal, setShowExerciseModal] = useState(false);

  const dashboard = useQuery({
    queryKey: ["wellness"],
    queryFn: getWellnessDashboard,
    refetchInterval: 60_000,
  });

  const data = dashboard.data;
  const isSleeping = data?.current_sleep?.is_sleeping ?? false;

  const sleepMutation = useMutation({
    mutationFn: isSleeping ? wakeSleep : startSleep,
    onSuccess: (result: any) => {
      if (isSleeping) {
        if (result.skipped) {
          toast(`⚠️ ${result.message}`);
        } else {
          // wake result
          const cfg = QUALITY_CONFIG[result.quality as keyof typeof QUALITY_CONFIG];
          toast(`🌅 Slept ${result.duration_hours}h — ${cfg?.label ?? result.quality} (${cfg?.mult ?? ""})`);
        }
      } else {
        toast("🌙 Good night! Sleep tracker started.");
      }
      qc.invalidateQueries({ queryKey: ["wellness"] });
    },
    onError: () => toast("Sleep action failed"),
  });

  const sleepHistory = data?.sleep_history ?? [];
  const exerciseHistory = data?.exercise_history ?? [];
  const multiplierToday = data?.sleep_multiplier_today ?? 1.0;

  return (
    <PageLayout
      title="Wellness"
      subtitle="Sleep & exercise power your earning multiplier."
      actions={
        <button
          onClick={() => setShowExerciseModal(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition active:scale-[0.97]"
        >
          <Dumbbell className="size-4" /> Log Exercise
        </button>
      }
    >
      {/* Sleep Card */}
      <div className="grid gap-4 md:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="glass relative overflow-hidden rounded-3xl p-6"
        >
          {/* Animated bg gradient */}
          <div
            className="pointer-events-none absolute inset-0 rounded-3xl opacity-30"
            style={{
              background: isSleeping
                ? "radial-gradient(ellipse at center, #1a1a4e 0%, transparent 70%)"
                : "radial-gradient(ellipse at center, #fcd34d30 0%, transparent 70%)",
            }}
          />

          <div className="relative">
            <div className="flex items-center gap-3">
              {isSleeping
                ? <Moon className="size-10 text-indigo-400" fill="currentColor" />
                : <Sun className="size-10 text-yellow-400" fill="currentColor" />
              }
              <div>
                <div className="text-lg font-semibold">
                  {isSleeping ? "Currently Sleeping" : "Awake"}
                </div>
                {isSleeping && data?.current_sleep?.sleep_at_ms && (
                  <div className="text-sm text-muted-foreground">
                    Started {new Date(data.current_sleep.sleep_at_ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={() => sleepMutation.mutate()}
              disabled={sleepMutation.isPending}
              className={`mt-4 w-full rounded-2xl py-3 text-sm font-semibold transition active:scale-95 disabled:opacity-50 ${
                isSleeping
                  ? "bg-linear-to-r from-amber-400 to-yellow-300 text-amber-900"
                  : "bg-linear-to-r from-indigo-500 to-violet-600 text-white"
              }`}
            >
              {sleepMutation.isPending
                ? "..."
                : isSleeping ? "☀️ Good Morning" : "🌙 Going to Sleep"
              }
            </button>

            {/* Today's multiplier */}
            <div className={`mt-4 rounded-2xl px-4 py-3 text-sm flex items-center gap-2 ${
              multiplierToday >= 1.1 ? "bg-emerald-50 text-emerald-700"
              : multiplierToday < 1.0 ? "bg-red-50 text-red-700"
              : "bg-muted/50 text-muted-foreground"
            }`}>
              <Zap className="size-4 shrink-0" />
              <span>
                Today's earn multiplier: <strong>×{multiplierToday.toFixed(2)}</strong>
                {multiplierToday >= 1.1 && " 🚀"}
                {multiplierToday < 1.0 && " 😴"}
              </span>
            </div>
          </div>
        </motion.div>

        {/* Sleep Stats */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass rounded-3xl p-5"
        >
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Star className="size-4 text-violet" /> Sleep Quality — Last 30 Nights
          </h3>
          {sleepHistory.length === 0 ? (
            <div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
              No sleep sessions tracked yet.
            </div>
          ) : (
            <>
              <div className="grid gap-1" style={{ gridTemplateColumns: "repeat(15, minmax(0,1fr))" }}>
                {[...sleepHistory].reverse().slice(0, 30).map((s: any, i: number) => (
                  <SleepQualityDot key={i} quality={s.quality} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                {Object.entries(QUALITY_CONFIG).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1">
                    <i className={`block size-2 rounded ${v.color}`} /> {v.label} ({v.mult})
                  </span>
                ))}
              </div>
            </>
          )}

          {sleepHistory.length > 0 && (
            <div className="mt-3 border-t border-white/60 pt-3 space-y-1">
              {sleepHistory.slice(0, 5).map((s: any, i: number) => {
                const cfg = QUALITY_CONFIG[s.quality as keyof typeof QUALITY_CONFIG];
                return (
                  <div key={i} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{s.date}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3 text-muted-foreground" />
                      {s.duration_hours?.toFixed(1)}h
                    </span>
                    <span className={`font-semibold ${cfg?.textColor ?? ""}`}>{cfg?.label ?? s.quality}</span>
                    <span className={`text-[10px] ${s.multiplier >= 1 ? "text-emerald-600" : "text-red-600"}`}>
                      {s.multiplier >= 1 ? "+" : ""}{((s.multiplier - 1) * 100).toFixed(0)}%
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </motion.div>
      </div>

      {/* Exercise History */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass mt-4 rounded-3xl p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Flame className="size-4 text-orange-500" /> Exercise Earnings
          </h3>
          <button
            onClick={() => setShowExerciseModal(true)}
            className="text-xs text-primary font-medium hover:underline"
          >
            + Log Session
          </button>
        </div>

        {exerciseHistory.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No exercise sessions logged yet. Log your first workout!
          </div>
        ) : (
          <div className="space-y-2">
            {exerciseHistory.slice(0, 10).map((e: any, i: number) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="flex items-center justify-between rounded-2xl bg-white/55 px-4 py-2.5"
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">
                    {EXERCISE_TYPES.find(t => t.value === e.exercise_type)?.icon ?? "💪"}
                  </span>
                  <div>
                    <div className="text-sm font-medium capitalize">
                      {e.exercise_type.toLowerCase()}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {e.date} · {e.duration_minutes}min
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-emerald-600 font-semibold text-sm">
                  <TrendingUp className="size-3.5" />
                  +{fmtINR(e.earned)}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>

      {/* Exercise Modal */}
      <AnimatePresence>
        {showExerciseModal && <ExerciseModal onClose={() => setShowExerciseModal(false)} />}
      </AnimatePresence>
    </PageLayout>
  );
}
