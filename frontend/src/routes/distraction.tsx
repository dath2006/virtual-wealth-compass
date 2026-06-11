import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { motion } from "framer-motion";

import { PageLayout } from "@/components/layout/PageLayout";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { getSettings, getUsageReport, saveSettings } from "@/lib/dataService";
import { fmtINR, fmtNumber } from "@/lib/formatters";
import { useToast } from "@/lib/toast";

export const Route = createFileRoute("/distraction")({
  head: () => ({
    meta: [
      { title: "Distraction · Productivity Economy" },
      { name: "description", content: "Track every minute drained by distraction apps." },
    ],
  }),
  component: DistractionPage,
});

const CAT_COLORS: Record<string, string> = {
  SOCIAL: "oklch(0.62 0.2 290)",
  ENTERTAINMENT: "oklch(0.68 0.18 25)",
  SHOPPING: "oklch(0.78 0.14 70)",
  GAMING: "oklch(0.7 0.16 155)",
};

function DistractionPage() {
  const usage = useQuery({ queryKey: ["usage"], queryFn: getUsageReport });
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const qc = useQueryClient();
  const { toast } = useToast();

  const u = usage.data;

  return (
    <PageLayout
      title="Distraction Usage"
      subtitle="Every minute on a distraction app costs you virtual ₹."
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          className="glass rounded-2xl p-5 min-w-0"
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Drained today
          </div>
          <div className="mt-1 text-4xl font-semibold text-destructive">
            <AnimatedCounter value={u?.totalDrainedToday ?? 0} currency />
          </div>
          <div className="mt-5 h-56">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie
                  data={u?.byCategory ?? []}
                  dataKey="drained"
                  nameKey="category"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={3}
                  stroke="white"
                  strokeWidth={3}
                  animationDuration={900}
                >
                  {(u?.byCategory ?? []).map((c) => (
                    <Cell key={c.category} fill={CAT_COLORS[c.category]} />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) =>
                    active && payload?.[0] ? (
                      <div className="glass-strong rounded-xl px-3 py-2 text-xs">
                        <div className="font-semibold">{(payload[0].payload as any).category}</div>
                        <div className="num text-muted-foreground">{fmtINR((payload[0].value as number) ?? 0)}</div>
                      </div>
                    ) : null
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs">
            {(u?.byCategory ?? []).map((c) => (
              <span key={c.category} className="inline-flex items-center gap-1.5 text-muted-foreground">
                <i className="block size-2 rounded-full" style={{ background: CAT_COLORS[c.category] }} />
                {c.category}
              </span>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass rounded-2xl p-4 md:p-5"
        >
          <h2 className="mb-3 text-sm font-semibold tracking-tight">App usage today</h2>
          <ul className="space-y-2">
            {(u?.apps ?? []).map((app) => {
              const cost = app.surgeEnabled ? app.surgeCostPerMin : app.costPerMin;
              const capPct = app.monthlyCapMin > 0
                ? Math.min(100, (app.minutesThisMonth / app.monthlyCapMin) * 100)
                : 0;
              return (
                <li key={app.packageName} className="rounded-xl bg-white/55 p-3">
                  <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3">
                    <div
                      className="grid size-9 shrink-0 place-items-center rounded-xl text-sm font-semibold text-white"
                      style={{ background: CAT_COLORS[app.category] }}
                    >
                      {app.appName.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{app.appName}</div>
                      <div className="truncate text-[11px] text-muted-foreground">{app.packageName}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-sm font-semibold text-destructive">
                        −{fmtINR(app.minutesToday * app.costPerMin)}
                      </div>
                      <div className="num text-[11px] text-muted-foreground">{app.minutesToday} min · ₹{cost}/min</div>
                    </div>
                  </div>
                  {app.monthlyCapMin > 0 && (
                    <div className="mt-2.5">
                      <div className="flex justify-between text-[10px] text-muted-foreground">
                        <span>Monthly cap</span>
                        <span>{fmtNumber(app.minutesThisMonth)} / {fmtNumber(app.monthlyCapMin)} min</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${capPct > 90 ? "bg-destructive" : capPct > 70 ? "bg-warning" : "bg-primary"}`}
                          style={{ width: `${capPct}%` }}
                        />
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </motion.div>
      </div>

      {/* Surge schedule */}
      <motion.div
        initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="glass mt-4 rounded-2xl p-4 md:p-5"
      >
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold tracking-tight">Surge pricing window</h2>
          <span className="text-xs text-muted-foreground">
            {settingsQ.data?.studyHoursStart ?? "09:00"} – {settingsQ.data?.studyHoursEnd ?? "22:00"}
          </span>
        </div>
        {(() => {
          const start = parseHM(settingsQ.data?.studyHoursStart ?? "09:00");
          const end   = parseHM(settingsQ.data?.studyHoursEnd ?? "22:00");
          const leftPct  = (start / 1440) * 100;
          const widthPct = ((end - start) / 1440) * 100;
          return (
            <>
              <div className="relative h-4 overflow-hidden rounded-full bg-muted">
                <div
                  className="absolute h-full rounded-full bg-linear-to-r from-warning to-destructive/70"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Inside the study window, every minute on a distraction app costs the <em>surge</em> rate.
              </p>
            </>
          );
        })()}
      </motion.div>

      <div className="mt-3 text-right">
        <button
          onClick={async () => {
            const s = await getSettings();
            await saveSettings(s); // no-op to demonstrate persistence
            qc.invalidateQueries({ queryKey: ["settings"] });
            toast("Distraction settings synced");
          }}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          Edit app rules in Settings →
        </button>
      </div>
    </PageLayout>
  );
}

function parseHM(s: string) {
  const [h, m] = s.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
