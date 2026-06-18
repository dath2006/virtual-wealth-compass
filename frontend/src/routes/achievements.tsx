import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Flame, Sparkles, Trophy, Plus, X } from "lucide-react";
import { useState } from "react";
import { PageLayout } from "@/components/layout/PageLayout";
import {
  getBossFights, getDailyStats, getMercyTokens, getStreak,
  createBossFight, deleteBossFight,
} from "@/lib/dataService";
import { fmtINR } from "@/lib/formatters";

export const Route = createFileRoute("/achievements")({
  head: () => ({
    meta: [
      { title: "Achievements · Effex" },
      { name: "description", content: "Streaks, boss fights, mercy tokens, and loot drops." },
    ],
  }),
  component: AchievementsPage,
});

function AchievementsPage() {
  const qc     = useQueryClient();
  const bosses = useQuery({ queryKey: ["bosses"], queryFn: getBossFights });
  const streak = useQuery({ queryKey: ["streak"], queryFn: getStreak });
  const mercy  = useQuery({ queryKey: ["mercy"],  queryFn: getMercyTokens });
  const stats  = useQuery({ queryKey: ["stats"],  queryFn: getDailyStats });

  const [showNewBoss, setShowNewBoss] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: deleteBossFight,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bosses"] }),
  });

  const last30      = (stats.data ?? []).slice(0, 30).reverse();
  const mercyCount  = mercy.data ?? 0;
  // Show as many circles as tokens (min 3, max actual count)
  const circleCount = Math.max(3, mercyCount);

  return (
    <PageLayout
      title="Achievements"
      subtitle="Streaks, boss fights, and loot."
      actions={
        <button
          onClick={() => setShowNewBoss(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition active:scale-[0.97]"
        >
          <Plus className="size-4" /> New Boss Fight
        </button>
      }
    >
      {/* Boss fights */}
      <div className="grid gap-3 md:grid-cols-2">
        {(bosses.data ?? []).length === 0 ? (
          <div className="glass col-span-full grid place-items-center rounded-2xl p-10 text-center">
            <Trophy className="mb-3 size-9 text-muted-foreground" />
            <div className="text-base font-semibold">No active boss fights</div>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Set a study goal with loot — complete it before the deadline to claim your reward.
            </p>
            <button
              onClick={() => setShowNewBoss(true)}
              className="mt-4 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Create Boss Fight
            </button>
          </div>
        ) : (
          (bosses.data ?? []).map((b: any, i: number) => {
            const daysLeft = Math.max(0, Math.ceil((b.deadlineMs - Date.now()) / 86400_000));
            const pct      = Math.min(100, (b.currentHours / b.targetHours) * 100);
            const beaten   = b.status === "BEATEN";
            const failed   = b.status === "FAILED";

            return (
              <motion.div
                key={b.id}
                initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06 }}
                className={`glass relative overflow-hidden rounded-2xl p-5 ${
                  beaten ? "ring-2 ring-emerald-400" : failed ? "opacity-60" : ""
                }`}
              >
                <div className="absolute right-4 top-4 flex items-center gap-2">
                  {beaten && <span className="chip bg-emerald-100 text-emerald-700 text-[10px]">BEATEN</span>}
                  {failed && <span className="chip bg-destructive/15 text-destructive text-[10px]">FAILED</span>}
                  {!beaten && !failed && (
                    <button
                      onClick={() => deleteMutation.mutate(b.id)}
                      disabled={deleteMutation.isPending}
                      className="rounded-lg p-1 text-muted-foreground hover:text-destructive transition"
                      title="Abandon boss fight"
                    >
                      <X className="size-3.5" />
                    </button>
                  )}
                  <Trophy className="size-4 text-warning-foreground" />
                </div>

                <h3 className="text-base font-semibold tracking-tight pr-16">{b.title}</h3>
                {!beaten && !failed && (
                  <div className="mt-1 flex items-baseline gap-1.5">
                    <span className="text-4xl font-semibold">{daysLeft}</span>
                    <span className="text-sm text-muted-foreground">days left</span>
                  </div>
                )}
                <div className="mt-3 text-xs text-muted-foreground">
                  Target: <b className="text-foreground">{b.targetHours}h</b> of focus before deadline
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <motion.div
                    initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                    className={`h-full ${beaten ? "bg-emerald-400" : "bg-linear-to-r from-violet to-primary"}`}
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
          })
        )}
      </div>

      {/* Streak + Mercy row */}
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {/* Streak calendar */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="glass rounded-2xl p-6 text-center"
        >
          <Flame className="mx-auto size-12 animate-pulse text-warning-foreground" fill="currentColor" />
          <div className="mt-2 text-5xl font-semibold">{streak.data ?? 0}</div>
          <div className="text-xs uppercase tracking-[0.15em] text-muted-foreground">day streak</div>

          <div className="mt-5 grid gap-1" style={{ gridTemplateColumns: "repeat(15, minmax(0, 1fr))" }}>
            {last30.map((d, i) => (
              <div
                key={i}
                title={`${d.dateISO}: ${d.studyMin}m`}
                className={`aspect-square rounded ${
                  d.hit        ? "bg-success/70"
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

        {/* Mercy tokens */}
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="glass rounded-2xl p-6"
        >
          <h3 className="text-sm font-semibold tracking-tight">Mercy Tokens</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Skip a day without breaking your streak. Earn one for every 14-day streak.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {Array.from({ length: circleCount }).map((_, i) => (
              <div
                key={i}
                className={`grid size-12 place-items-center rounded-full border-2 ${
                  i < mercyCount
                    ? "border-warning bg-linear-to-br from-warning to-warning-foreground/30 text-warning-foreground shadow-sm"
                    : "border-dashed border-muted-foreground/40 text-muted-foreground/40"
                }`}
              >
                ✦
              </div>
            ))}
            <span className="num ml-2 text-2xl font-semibold">{mercyCount}</span>
          </div>
        </motion.div>
      </div>

      {/* New Boss Fight modal */}
      {showNewBoss && (
        <NewBossFightModal
          onClose={() => setShowNewBoss(false)}
          onCreated={() => {
            setShowNewBoss(false);
            qc.invalidateQueries({ queryKey: ["bosses"] });
          }}
        />
      )}
    </PageLayout>
  );
}

function NewBossFightModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title,    setTitle]    = useState("");
  const [hours,    setHours]    = useState(10);
  const [days,     setDays]     = useState(7);
  const [lootDesc, setLootDesc] = useState("");
  const [lootAmt,  setLootAmt]  = useState(200);

  const mutation = useMutation({
    mutationFn: createBossFight,
    onSuccess: onCreated,
  });

  const submit = () => {
    if (!title.trim() || !lootDesc.trim()) return;
    mutation.mutate({
      title:            title.trim(),
      target_hours:     hours,
      deadline_ms:      Date.now() + days * 86_400_000,
      loot_description: lootDesc.trim(),
      loot_amount:      lootAmt,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.4)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        className="glass w-full max-w-sm rounded-3xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold tracking-tight">New Boss Fight</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>

        <div className="space-y-3">
          <label className="block">
            <span className="block text-xs font-medium text-foreground/70 mb-1">Title</span>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Finish OS assignment"
              className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-medium text-foreground/70 mb-1">Target hours</span>
              <input
                type="number" min={1} max={100} value={hours}
                onChange={(e) => setHours(+e.target.value)}
                className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
            <label className="block">
              <span className="block text-xs font-medium text-foreground/70 mb-1">Deadline (days)</span>
              <input
                type="number" min={1} max={30} value={days}
                onChange={(e) => setDays(+e.target.value)}
                className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </label>
          </div>

          <label className="block">
            <span className="block text-xs font-medium text-foreground/70 mb-1">Loot description</span>
            <input
              value={lootDesc} onChange={(e) => setLootDesc(e.target.value)}
              placeholder="e.g. Movie night pass"
              className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>

          <label className="block">
            <span className="block text-xs font-medium text-foreground/70 mb-1">Loot amount (₹)</span>
            <input
              type="number" min={0} value={lootAmt}
              onChange={(e) => setLootAmt(+e.target.value)}
              className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </label>
        </div>

        {mutation.error && (
          <p className="mt-3 text-xs text-destructive">{(mutation.error as any).message}</p>
        )}

        <div className="mt-5 flex gap-2">
          <button onClick={onClose} className="flex-1 rounded-xl bg-white/70 py-2 text-sm font-medium">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={mutation.isPending || !title.trim() || !lootDesc.trim()}
            className="flex-1 rounded-xl bg-primary py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50 active:scale-95 transition"
          >
            {mutation.isPending ? "Creating..." : "Create Boss"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
