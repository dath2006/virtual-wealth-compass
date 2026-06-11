import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Download, Plug, Save } from "lucide-react";

import { PageLayout } from "@/components/layout/PageLayout";
import {
  exportLedgerCSV, getDevice, getLedger, getSettings, isMockMode,
  saveSettings, testConnection,
} from "@/lib/dataService";
import { mockUsageReport } from "@/lib/mockData";
import { fmtINR, fmtRelative } from "@/lib/formatters";
import { useToast } from "@/lib/toast";
import type { AppCategory, AppSettings } from "@/lib/types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings · Productivity Economy" },
      { name: "description", content: "Configure earning rates, penalties, distraction rules, budgets, oaths, and schedule." },
    ],
  }),
  component: SettingsPage,
});

const SECTIONS = [
  { id: "earning",    label: "Earning Rates" },
  { id: "penalties",  label: "Penalties" },
  { id: "apps",       label: "Distraction Apps" },
  { id: "budgets",    label: "Budgets & Caps" },
  { id: "oath",       label: "Oath Economy" },
  { id: "schedule",   label: "Schedule" },
  { id: "device",     label: "Connection" },
  { id: "backup",     label: "Backup & Export" },
];

function SettingsPage() {
  const settingsQ = useQuery({ queryKey: ["settings"], queryFn: getSettings });
  const ledgerQ   = useQuery({ queryKey: ["ledger"],   queryFn: getLedger });
  const deviceQ   = useQuery({ queryKey: ["device"],   queryFn: getDevice });
  const qc = useQueryClient();
  const { toast } = useToast();

  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => { if (settingsQ.data) setS(settingsQ.data); }, [settingsQ.data]);

  if (!s) {
    return (
      <PageLayout title="Settings"><div className="glass h-40 animate-pulse rounded-2xl" /></PageLayout>
    );
  }

  const update = <K extends keyof AppSettings>(k: K, v: AppSettings[K]) =>
    setS({ ...s, [k]: v });

  const handleSave = async () => {
    await saveSettings(s);
    qc.invalidateQueries({ queryKey: ["settings"] });
    toast("Settings saved");
  };

  return (
    <PageLayout
      title="Settings"
      subtitle="The constitution of your virtual economy."
      actions={
        <button
          onClick={handleSave}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm transition active:scale-[0.97]"
        >
          <Save className="size-4" /> Save changes
        </button>
      }
    >
      <div className="grid gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        {/* Sticky sub-nav */}
        <aside className="hidden md:block">
          <nav className="glass sticky top-4 rounded-2xl p-2 text-sm">
            {SECTIONS.map((sec) => (
              <a
                key={sec.id}
                href={`#${sec.id}`}
                className="block rounded-lg px-3 py-1.5 text-foreground/70 transition hover:bg-white/70 hover:text-foreground"
              >
                {sec.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="space-y-5 min-w-0">
          {/* Earning */}
          <Section id="earning" title="Earning Rates">
            <div className="grid gap-3 md:grid-cols-2">
              <NumberField label="Hourly NFC earn rate (₹/hr)" value={s.hourlyNfcRate} onChange={(v) => update("hourlyNfcRate", v)} />
              <NumberField label="Step income daily cap (₹/day)" value={s.stepDailyCap} onChange={(v) => update("stepDailyCap", v)} />
              <NumberField label="Daily study target (hours)" value={s.dailyStudyHours} step={0.5} onChange={(v) => update("dailyStudyHours", v)} />
            </div>
            <InfoTable
              title="Step income tiers"
              rows={[
                ["10,000+ steps", "100% of cap"],
                ["8,000–9,999",   "80% of cap"],
                ["5,000–7,999",   "50% of cap"],
                ["< 5,000",       "₹0"],
              ]}
            />
            <InfoTable
              title="Streak multipliers"
              rows={[["Day 1", "1.0×"], ["Day 3", "1.2×"], ["Day 5", "1.5×"], ["Day 7+", "2.0×"]]}
            />
          </Section>

          {/* Penalties */}
          <Section id="penalties" title="Penalties">
            <div className="grid gap-3 md:grid-cols-2">
              <NumberField label="Lazy Tax amount (₹)" value={s.lazyTaxAmount} onChange={(v) => update("lazyTaxAmount", v)} />
              <NumberField label="Unlock tax (when bankrupt, ₹)" value={s.unlockTax} onChange={(v) => update("unlockTax", v)} />
            </div>
            <div className="mt-3">
              <label className="block text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Lazy Tax threshold: applied when daily completion is below <b>{s.lazyTaxThresholdPct}%</b>
              </label>
              <input
                type="range" min={0} max={100}
                value={s.lazyTaxThresholdPct}
                onChange={(e) => update("lazyTaxThresholdPct", +e.target.value)}
                className="mt-2 w-full accent-[var(--primary)]"
              />
            </div>
            <div className="mt-3 rounded-xl bg-muted/60 p-3 text-xs text-muted-foreground">
              Over-cap distraction multiplier: <b>2×</b> the base rate when a monthly cap is exceeded.
            </div>
          </Section>

          {/* Apps */}
          <Section id="apps" title="Distraction App Rules">
            <AppRulesTable />
          </Section>

          {/* Budgets */}
          <Section id="budgets" title="Monthly Budgets & Spending Caps">
            <NumberField label="Monthly discretionary budget (real ₹)" value={s.monthlyDiscretionaryBudget} onChange={(v) => update("monthlyDiscretionaryBudget", v)} />
            <div className="mt-4 space-y-2">
              {(Object.keys(s.categoryCaps) as AppCategory[]).map((cat) => {
                const spent = ledgerQ.data?.filter(e =>
                  e.category === "DISTRACTION" &&
                  new Date(e.timestampMs).getMonth() === new Date().getMonth()
                ).reduce((sum, e) => sum + Math.abs(e.amount), 0) ?? 0;
                const cap = s.categoryCaps[cat];
                const pct = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
                return (
                  <div key={cat} className="rounded-xl bg-white/55 p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{cat}</span>
                      <input
                        type="number"
                        value={cap}
                        onChange={(e) => update("categoryCaps", { ...s.categoryCaps, [cat]: +e.target.value })}
                        className="w-24 rounded-lg border border-white/70 bg-white/70 px-2 py-1 text-right text-sm"
                      />
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Estimated month spend: {fmtINR(spent)}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* Oath */}
          <Section id="oath" title="Oath Economy">
            <NumberField label="Default daily interest rate (%)" value={s.defaultDailyInterestPct} step={0.1} onChange={(v) => update("defaultDailyInterestPct", v)} />
            <InfoTable
              title="Credit score events"
              rows={[
                ["Early repayment",  "+50"],
                ["On-time repayment", "+25"],
                ["Default",          "−100"],
                ["7-day streak",     "+30"],
              ]}
            />
          </Section>

          {/* Schedule */}
          <Section id="schedule" title="Schedule">
            <div className="grid gap-3 md:grid-cols-3">
              <TimeField label="Study hours start" value={s.studyHoursStart} onChange={(v) => update("studyHoursStart", v)} />
              <TimeField label="Study hours end"   value={s.studyHoursEnd}   onChange={(v) => update("studyHoursEnd", v)} />
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Salary day</span>
                <select
                  value={s.salaryDay}
                  onChange={(e) => update("salaryDay", e.target.value as AppSettings["salaryDay"])}
                  className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm"
                >
                  {["SUN","MON","TUE","WED","THU","FRI","SAT"].map((d) => <option key={d}>{d}</option>)}
                </select>
              </label>
            </div>
          </Section>

          {/* Device */}
          <Section id="device" title="Connection & Device">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">API base URL</span>
                <input
                  value={s.apiBaseUrl}
                  onChange={(e) => update("apiBaseUrl", e.target.value)}
                  className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm"
                />
              </label>
              <div className="rounded-xl bg-white/55 p-3">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Mock mode</div>
                <span className={`chip mt-2 ${isMockMode() ? "bg-success/15 text-success-foreground" : "bg-destructive/15 text-destructive"}`}>
                  {isMockMode() ? "MOCK DATA — ON" : "LIVE API"}
                </span>
              </div>
            </div>
            {deviceQ.data && (
              <div className="mt-3 rounded-xl bg-white/55 p-3 text-sm">
                <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Device</div>
                <div className="mt-1 font-mono text-xs text-foreground/80">{deviceQ.data.deviceId}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Last heartbeat {fmtRelative(deviceQ.data.lastHeartbeatMs)} · battery {deviceQ.data.batteryPct}%
                </div>
              </div>
            )}
            <button
              onClick={async () => {
                const ok = await testConnection();
                toast(ok ? "Connection OK" : "Connection failed", ok ? "success" : "error");
              }}
              className="mt-3 inline-flex items-center gap-2 rounded-xl bg-white/70 px-3.5 py-2 text-sm font-medium text-foreground transition active:scale-[0.97]"
            >
              <Plug className="size-4" /> Test connection
            </button>
          </Section>

          {/* Backup */}
          <Section id="backup" title="Backup & Export">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => {
                  const csv = exportLedgerCSV(ledgerQ.data ?? []);
                  download(csv, "ledger.csv", "text/csv");
                  toast("Ledger CSV downloaded");
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3.5 py-2 text-sm font-medium text-foreground active:scale-[0.97]"
              >
                <Download className="size-4" /> Export Ledger
              </button>
              <button
                onClick={() => {
                  const data = JSON.stringify({ settings: s, ledger: ledgerQ.data, device: deviceQ.data }, null, 2);
                  download(data, "backup.json", "application/json");
                  toast("Full backup downloaded");
                }}
                className="inline-flex items-center gap-2 rounded-xl bg-white/70 px-3.5 py-2 text-sm font-medium text-foreground active:scale-[0.97]"
              >
                <Download className="size-4" /> Export Full Backup
              </button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Note: actual encrypted backup is managed from the Android app.
            </p>
          </Section>
        </div>
      </div>
    </PageLayout>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="glass rounded-2xl p-5 scroll-mt-6">
      <h2 className="mb-3 text-base font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function NumberField({ label, value, onChange, step = 1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="number" value={value} step={step}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </label>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <input
        type="time" value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/70 bg-white/70 px-3 py-2 text-sm"
      />
    </label>
  );
}

function InfoTable({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="mt-3 rounded-xl bg-muted/60 p-3 text-xs">
      <div className="mb-1.5 font-semibold text-foreground/80">{title}</div>
      <div className="grid grid-cols-2 gap-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <span className="text-muted-foreground">{k}</span>
            <span className="num text-right text-foreground">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AppRulesTable() {
  const [apps, setApps] = useState(mockUsageReport.apps.map((a) => ({ ...a })));

  const update = (i: number, patch: Partial<typeof apps[number]>) => {
    setApps((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-2 pr-2">App</th>
            <th className="py-2 pr-2">Category</th>
            <th className="py-2 pr-2">₹/min</th>
            <th className="py-2 pr-2">Surge ₹/min</th>
            <th className="py-2 pr-2">Cap (min)</th>
            <th className="py-2 pr-2">Surge</th>
            <th className="py-2"></th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a, i) => (
            <tr key={a.packageName} className="border-t border-white/60">
              <td className="py-2 pr-2">
                <input value={a.appName} onChange={(e) => update(i, { appName: e.target.value })}
                  className="w-full rounded-lg border border-white/70 bg-white/70 px-2 py-1" />
                <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{a.packageName}</div>
              </td>
              <td className="py-2 pr-2">
                <select value={a.category} onChange={(e) => update(i, { category: e.target.value as any })}
                  className="rounded-lg border border-white/70 bg-white/70 px-2 py-1">
                  {["SOCIAL","ENTERTAINMENT","SHOPPING","GAMING"].map(c => <option key={c}>{c}</option>)}
                </select>
              </td>
              <td className="py-2 pr-2">
                <input type="number" value={a.costPerMin} step={0.5}
                  onChange={(e) => update(i, { costPerMin: +e.target.value })}
                  className="w-20 rounded-lg border border-white/70 bg-white/70 px-2 py-1" />
              </td>
              <td className="py-2 pr-2">
                <input type="number" value={a.surgeCostPerMin} step={0.5}
                  onChange={(e) => update(i, { surgeCostPerMin: +e.target.value })}
                  className="w-20 rounded-lg border border-white/70 bg-white/70 px-2 py-1" />
              </td>
              <td className="py-2 pr-2">
                <input type="number" value={a.monthlyCapMin}
                  onChange={(e) => update(i, { monthlyCapMin: +e.target.value })}
                  className="w-24 rounded-lg border border-white/70 bg-white/70 px-2 py-1" />
              </td>
              <td className="py-2 pr-2">
                <button
                  onClick={() => update(i, { surgeEnabled: !a.surgeEnabled })}
                  className={`relative h-5 w-9 rounded-full transition ${a.surgeEnabled ? "bg-primary" : "bg-muted"}`}
                >
                  <span className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition ${a.surgeEnabled ? "left-[18px]" : "left-0.5"}`} />
                </button>
              </td>
              <td className="py-2 text-right">
                <button onClick={() => setApps(apps.filter((_, j) => j !== i))}
                  className="rounded-lg p-1 text-destructive hover:bg-destructive/10">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        onClick={() => setApps([...apps, {
          packageName: "com.new.app", appName: "New App", category: "SOCIAL",
          costPerMin: 2, surgeCostPerMin: 4, monthlyCapMin: 300,
          surgeEnabled: true, minutesToday: 0, minutesThisMonth: 0,
        }])}
        className="mt-3 rounded-xl bg-white/70 px-3 py-1.5 text-xs font-medium"
      >+ Add app</button>
    </div>
  );
}

function download(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
