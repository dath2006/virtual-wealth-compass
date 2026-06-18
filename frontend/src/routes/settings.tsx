import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  Download, Plug, Save, Bot, CheckCircle, XCircle,
  TrendingUp, Shield, Clock, Wifi, Zap, Info,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { PageLayout } from "@/components/layout/PageLayout";
import {
  exportLedgerCSV, getLedger, getSettings, getUsageReport,
  saveSettings, testConnection, getRateSuggestions,
  applyRateSuggestion, dismissRateSuggestion,
} from "@/lib/dataService";
import { fmtINR } from "@/lib/formatters";
import { useToast } from "@/lib/toast";
import type { AppCategory, AppSettings } from "@/lib/types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Effex" },
      { name: "description", content: "Configure your virtual economy rules, schedule, and earning rates." },
    ],
  }),
  component: SettingsPage,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function Card({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-2xl p-5 md:p-6"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="size-5" />
        </div>
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </motion.div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-foreground/80">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function NumInput({
  value,
  onChange,
  step = 1,
  min = 0,
  prefix,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {prefix && <span className="text-sm text-muted-foreground">{prefix}</span>}
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
      {suffix && <span className="text-sm text-muted-foreground">{suffix}</span>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function SettingsPage() {
  const qc       = useQueryClient();
  const { toast } = useToast();

  const settingsQ    = useQuery({ queryKey: ["settings"],    queryFn: getSettings });
  const ledgerQ      = useQuery({ queryKey: ["ledger"],      queryFn: () => getLedger() });
  const usageQ       = useQuery({ queryKey: ["usage"],       queryFn: getUsageReport });
  const suggestionsQ = useQuery({ queryKey: ["suggestions"], queryFn: getRateSuggestions, refetchInterval: 300_000 });

  const [s, setS]         = useState<AppSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty,  setIsDirty]  = useState(false);
  const [connOk,   setConnOk]   = useState<boolean | null>(null);
  const [testing,  setTesting]  = useState(false);

  useEffect(() => {
    if (settingsQ.data && !isDirty) setS(settingsQ.data);
  }, [settingsQ.data]);

  const update = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) => {
    setS((prev) => prev ? { ...prev, [k]: v } : prev);
    setIsDirty(true);
  };

  const handleSave = async () => {
    if (!s) return;
    setIsSaving(true);
    try {
      await saveSettings(s);
      qc.invalidateQueries({ queryKey: ["settings"] });
      setIsDirty(false);
      toast("Settings saved ✓", "success");
    } catch (err: any) {
      toast(`Save failed: ${err.message ?? "server error"}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setConnOk(null);
    const ok = await testConnection();
    setConnOk(ok);
    setTesting(false);
    toast(ok ? "Server reachable ✓" : "Cannot reach server ✗", ok ? "success" : "error");
  };

  const applyMutation = useMutation({
    mutationFn: applyRateSuggestion,
    onSuccess: (data) => {
      toast(`Applied: ${data.field.replace(/_/g, " ")} → ${data.new_value}`);
      qc.invalidateQueries({ queryKey: ["suggestions"] });
      qc.invalidateQueries({ queryKey: ["settings"] });
      setIsDirty(false);
    },
    onError: () => toast("Failed to apply suggestion"),
  });

  const dismissMutation = useMutation({
    mutationFn: dismissRateSuggestion,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["suggestions"] }),
  });

  if (!s) {
    return (
      <PageLayout title="Settings">
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="glass h-48 animate-pulse rounded-2xl" />
          ))}
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      title="Settings"
      subtitle="Configure your economy rules, schedule, and rates."
      actions={
        <button
          onClick={handleSave}
          disabled={isSaving || !isDirty}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium shadow-sm transition active:scale-[0.97] ${
            isDirty
              ? "bg-primary text-primary-foreground"
              : "bg-white/60 text-muted-foreground cursor-default"
          } disabled:opacity-60`}
        >
          <Save className="size-4" />
          {isSaving ? "Saving…" : isDirty ? "Save changes" : "No changes"}
        </button>
      }
    >
      {/* ── AI Rate Advisor ───────────────────────────────────────────────── */}
      <AnimatePresence>
        {(suggestionsQ.data?.length ?? 0) > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="mb-5 rounded-2xl bg-violet/5 p-5 ring-2 ring-violet/25"
          >
            <div className="mb-3 flex items-center gap-2">
              <Bot className="size-5 text-violet" />
              <h2 className="text-sm font-semibold">AI Rate Advisor</h2>
              <span className="rounded-full bg-violet/15 px-2 py-0.5 text-[10px] font-medium text-violet">
                {suggestionsQ.data!.length} suggestion{suggestionsQ.data!.length > 1 ? "s" : ""}
              </span>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Based on your last 7 days of economy data. Review and apply what makes sense.
            </p>
            <div className="space-y-2">
              {suggestionsQ.data!.map((sug: any) => (
                <div key={sug.id} className="rounded-xl bg-white/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">
                        {sug.field.replace(/_/g, " ")}
                        {sug.target_package && (
                          <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                            ({sug.target_package.split(".").pop()})
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{sug.reason}</div>
                      <div className="mt-2 flex items-center gap-2 text-sm">
                        <span className="line-through text-muted-foreground">{fmtINR(sug.current_value)}</span>
                        <span className="text-muted-foreground">→</span>
                        <span className={`font-semibold ${sug.suggested_value > sug.current_value ? "text-emerald-600" : "text-destructive"}`}>
                          {fmtINR(sug.suggested_value)}
                        </span>
                      </div>
                      {sug.impact && (
                        <p className="mt-1 text-[11px] italic text-muted-foreground">{sug.impact}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col gap-1.5">
                      <button
                        onClick={() => applyMutation.mutate(sug.id)}
                        disabled={applyMutation.isPending}
                        className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition active:scale-95 disabled:opacity-50"
                      >
                        <CheckCircle className="size-3.5" /> Apply
                      </button>
                      <button
                        onClick={() => dismissMutation.mutate(sug.id)}
                        className="flex items-center gap-1 rounded-lg bg-white/70 px-3 py-1.5 text-xs font-medium text-foreground/70 transition active:scale-95"
                      >
                        <XCircle className="size-3.5" /> Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="space-y-4">

        {/* ── 1. Earning Rates ─────────────────────────────────────────────── */}
        <Card
          icon={TrendingUp}
          title="Earning Rates"
          description="How much virtual ₹ you earn per hour of focus, steps, and study."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Focus earn rate" hint="₹ earned per hour of NFC desk-tag focus">
              <NumInput value={s.hourlyNfcRate} onChange={(v) => update("hourlyNfcRate", v)} prefix="₹" suffix="/hr" />
            </Field>
            <Field label="Step income cap" hint="Max ₹ earned from steps per day">
              <NumInput value={s.stepDailyCap} onChange={(v) => update("stepDailyCap", v)} prefix="₹" suffix="/day" />
            </Field>
            <Field label="Daily study target" hint="Hours needed to hit streak and avoid lazy tax">
              <NumInput value={s.dailyStudyHours} onChange={(v) => update("dailyStudyHours", v)} step={0.5} min={0.5} suffix="hrs" />
            </Field>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "5k+ steps",   value: "50% cap" },
              { label: "8k+ steps",   value: "80% cap" },
              { label: "10k+ steps",  value: "100% cap" },
              { label: "Day 7+ streak", value: "2.0× earn" },
            ].map(({ label, value }) => (
              <div key={label} className="rounded-xl bg-white/40 px-3 py-2 text-xs">
                <div className="font-medium text-foreground/80">{label}</div>
                <div className="mt-0.5 font-semibold text-primary">{value}</div>
              </div>
            ))}
          </div>
        </Card>

        {/* ── 2. Penalties ─────────────────────────────────────────────────── */}
        <Card
          icon={Shield}
          title="Penalties & Taxes"
          description="Automatic deductions when you miss targets or go into debt."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Lazy Tax amount" hint="Deducted each midnight when daily target not reached">
              <NumInput value={s.lazyTaxAmount} onChange={(v) => update("lazyTaxAmount", v)} prefix="₹" />
            </Field>
            <Field label="Bankrupt unlock tax" hint="Extra cost to spend while your balance is negative">
              <NumInput value={s.unlockTax} onChange={(v) => update("unlockTax", v)} prefix="₹" />
            </Field>
            <Field label="Monthly discretionary budget" hint="Real ₹ — used for the spend progress bar on Dashboard">
              <NumInput value={s.monthlyDiscretionaryBudget} onChange={(v) => update("monthlyDiscretionaryBudget", v)} prefix="₹" suffix="/month" />
            </Field>
            <Field label="Oath daily interest rate" hint="% charged per day on active oath loans">
              <NumInput value={s.defaultDailyInterestPct} step={0.1} onChange={(v) => update("defaultDailyInterestPct", v)} suffix="%" />
            </Field>
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-foreground/80">Lazy Tax threshold</span>
              <span className="font-semibold text-primary">{s.lazyTaxThresholdPct}% completion required</span>
            </div>
            <input
              type="range" min={0} max={100} value={s.lazyTaxThresholdPct}
              onChange={(e) => update("lazyTaxThresholdPct", +e.target.value)}
              className="w-full accent-primary"
            />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span>0% — never trigger</span>
              <span>100% — always trigger if under target</span>
            </div>
          </div>

          {/* Category spending caps */}
          <div className="mt-4">
            <div className="mb-2 text-xs font-medium text-foreground/80">Monthly distraction drain caps per category</div>
            <div className="grid gap-2 md:grid-cols-2">
              {(Object.keys(s.categoryCaps) as AppCategory[]).map((cat) => (
                <div key={cat} className="flex items-center gap-3 rounded-xl bg-white/40 px-3 py-2">
                  <span className="flex-1 text-sm font-medium capitalize">{cat.toLowerCase()}</span>
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-muted-foreground">₹</span>
                    <input
                      type="number"
                      value={s.categoryCaps[cat]}
                      onChange={(e) => update("categoryCaps", { ...s.categoryCaps, [cat]: +e.target.value })}
                      className="w-20 rounded-lg border border-white/70 bg-white/70 px-2 py-1 text-right text-sm focus:outline-none focus:ring-1 focus:ring-primary/40"
                    />
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* ── 3. Schedule ──────────────────────────────────────────────────── */}
        <Card
          icon={Clock}
          title="Schedule"
          description="Study window and salary day determine when surge pricing applies and when streaks reset."
        >
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Study window start" hint="Surge pricing activates at this time">
              <input
                type="time" value={s.studyHoursStart}
                onChange={(e) => update("studyHoursStart", e.target.value)}
                className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </Field>
            <Field label="Study window end" hint="Surge pricing ends at this time">
              <input
                type="time" value={s.studyHoursEnd}
                onChange={(e) => update("studyHoursEnd", e.target.value)}
                className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </Field>
            <Field label="Salary day" hint="Day of week when weekly bonuses and streak resets are evaluated">
              <select
                value={s.salaryDay}
                onChange={(e) => update("salaryDay", e.target.value as AppSettings["salaryDay"])}
                className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {["SUN","MON","TUE","WED","THU","FRI","SAT"].map((d) => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
            </Field>
          </div>

          {/* Visual surge window bar */}
          {(() => {
            const toMins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + (m ?? 0); };
            const start = toMins(s.studyHoursStart);
            const end   = toMins(s.studyHoursEnd);
            const leftPct  = (start / 1440) * 100;
            const widthPct = ((end - start) / 1440) * 100;
            return (
              <div className="mt-4">
                <div className="mb-1 text-xs text-muted-foreground flex items-center gap-1.5">
                  <Zap className="size-3 text-amber-500" />
                  Surge pricing window: <span className="font-medium text-foreground">{s.studyHoursStart} – {s.studyHoursEnd}</span>
                </div>
                <div className="relative h-3 overflow-hidden rounded-full bg-muted">
                  <div
                    className="absolute h-full rounded-full bg-gradient-to-r from-amber-400 to-red-400"
                    style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                  />
                </div>
                <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
                  <span>12am</span><span>6am</span><span>12pm</span><span>6pm</span><span>12am</span>
                </div>
              </div>
            );
          })()}
        </Card>

        {/* ── 4. Distraction App Rates (read-only) ─────────────────────────── */}
        <Card
          icon={Zap}
          title="Distraction App Rates"
          description="Live rates from your backend. Use AI suggestions above to adjust rates — they take effect immediately."
        >
          {usageQ.isLoading ? (
            <div className="h-24 animate-pulse rounded-xl bg-muted/50" />
          ) : (usageQ.data?.apps ?? []).length === 0 ? (
            <div className="rounded-xl bg-muted/30 py-6 text-center text-sm text-muted-foreground">
              No app data yet — rates will appear after the Android app sends its first usage report.
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50/80 px-3 py-2 text-xs text-amber-700">
                <Info className="size-3.5 shrink-0" />
                Rates are read-only here. Use the AI Advisor suggestions (above) to request rate changes.
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] text-sm">
                  <thead>
                    <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                      <th className="pb-2 pr-3">App</th>
                      <th className="pb-2 pr-3">Category</th>
                      <th className="pb-2 pr-3">Base ₹/min</th>
                      <th className="pb-2 pr-3">Surge ₹/min</th>
                      <th className="pb-2">Today</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(usageQ.data?.apps ?? []).map((app) => (
                      <tr key={app.packageName} className="border-t border-white/50">
                        <td className="py-2 pr-3">
                          <div className="font-medium">{app.appName}</div>
                          <div className="text-[10px] text-muted-foreground">{app.packageName}</div>
                        </td>
                        <td className="py-2 pr-3">
                          <span className="chip text-[10px]">{app.category}</span>
                        </td>
                        <td className="py-2 pr-3 font-mono text-sm">{fmtINR(app.costPerMin)}</td>
                        <td className="py-2 pr-3">
                          <span className="font-mono text-sm text-amber-700">{fmtINR(app.surgeCostPerMin)}</span>
                          {app.surgeEnabled && <Zap className="ml-1 inline size-3 text-amber-500" />}
                        </td>
                        <td className="py-2 font-mono text-sm text-muted-foreground">
                          {app.minutesToday > 0 ? `${app.minutesToday}m` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card>

        {/* ── 5. Connection & Export ───────────────────────────────────────── */}
        <Card
          icon={Wifi}
          title="Connection & Export"
          description="Test your server connection and export your data."
        >
          <div className="space-y-4">
            {/* Connection test */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleTestConnection}
                disabled={testing}
                className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-4 py-2 text-sm font-medium text-foreground transition active:scale-[0.97] disabled:opacity-50"
              >
                <Plug className="size-4" />
                {testing ? "Testing…" : "Test connection"}
              </button>
              {connOk === true  && <span className="flex items-center gap-1 text-sm text-emerald-600"><CheckCircle className="size-4" /> Connected</span>}
              {connOk === false && <span className="flex items-center gap-1 text-sm text-destructive"><XCircle className="size-4" /> Unreachable</span>}
            </div>

            {/* API URL — read-only display */}
            <div className="rounded-xl bg-muted/30 px-4 py-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Server URL</div>
              <div className="mt-1 font-mono text-sm text-foreground/80">
                {import.meta.env.VITE_API_BASE_URL || "(set VITE_API_BASE_URL at build time)"}
              </div>
            </div>

            {/* Export buttons */}
            <div className="flex flex-wrap gap-2 border-t border-white/40 pt-4">
              <button
                onClick={() => {
                  const csv = exportLedgerCSV(ledgerQ.data ?? []);
                  dl(csv, "ledger.csv", "text/csv");
                  toast("Ledger exported as CSV");
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3.5 py-2 text-sm font-medium text-foreground transition active:scale-[0.97]"
              >
                <Download className="size-4" /> Export Ledger (CSV)
              </button>
              <button
                onClick={() => {
                  const data = JSON.stringify({ settings: s, ledger: ledgerQ.data }, null, 2);
                  dl(data, "effex-backup.json", "application/json");
                  toast("Full backup downloaded");
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3.5 py-2 text-sm font-medium text-foreground transition active:scale-[0.97]"
              >
                <Download className="size-4" /> Full Backup (JSON)
              </button>
            </div>
          </div>
        </Card>

      </div>
    </PageLayout>
  );
}

function dl(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
