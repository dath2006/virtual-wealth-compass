import {
  defaultSettings,
  mockBossFights,
  mockCreditScore,
  mockDailyStats,
  mockDevice,
  mockLedger,
  mockMercyTokens,
  mockOaths,
  mockSessions,
  mockStreakDays,
  mockUsageReport,
  mockMarketplaceCatalogue,
  mockPurchasedPasses,
} from "./mockData";
import { useMockDelay } from "./hooks/useMockDelay";
import type {
  AppSettings,
  BossFight,
  CreditScore,
  DailyStat,
  DeviceInfo,
  LedgerEntry,
  NfcSession,
  Oath,
  UsageReport,
  MarketplacePass,
  PurchasedPass,
  PassType,
} from "./types";

const USE_MOCK =
  (import.meta.env.VITE_USE_MOCK_DATA ?? "true").toString() === "true";

export const isMockMode = () => USE_MOCK;

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const KEY = import.meta.env.VITE_API_KEY ?? "";

const SETTINGS_KEY = "productivity_settings";

const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": KEY,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
};

// ---------- Ledger
export async function getLedger(): Promise<LedgerEntry[]> {
  await useMockDelay();
  if (USE_MOCK) return mockLedger;
  return apiFetch<LedgerEntry[]>("/ledger");
}

export async function getBalance(): Promise<number> {
  await useMockDelay();
  if (USE_MOCK) return mockLedger.reduce((s, e) => s + e.amount, 0);
  return apiFetch<{ balance: number }>("/balance").then((r) => r.balance);
}

// ---------- Sessions
export async function getSessions(): Promise<NfcSession[]> {
  await useMockDelay();
  if (USE_MOCK) return mockSessions;
  return apiFetch<NfcSession[]>("/sessions");
}

// ---------- Usage
export async function getUsageReport(): Promise<UsageReport> {
  await useMockDelay();
  if (USE_MOCK) return mockUsageReport;
  return apiFetch<UsageReport>("/usage/today");
}

// ---------- Oaths
export async function getOaths(): Promise<Oath[]> {
  await useMockDelay();
  if (USE_MOCK) return mockOaths;
  return apiFetch<Oath[]>("/oaths");
}

export async function createOath(input: {
  task: string;
  loanAmount: number;
  dueMs: number;
}): Promise<Oath> {
  await useMockDelay();
  if (USE_MOCK) {
    const o: Oath = {
      id: Math.floor(Math.random() * 100000),
      task: input.task,
      loanAmount: input.loanAmount,
      currentDebt: input.loanAmount,
      dailyInterest: 0.02,
      createdMs: Date.now(),
      dueMs: input.dueMs,
      status: "ACTIVE",
      tier: "GOLD",
    };
    mockOaths.unshift(o);
    return o;
  }
  return apiFetch<Oath>("/oaths", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function repayOath(id: number): Promise<void> {
  await useMockDelay();
  if (USE_MOCK) {
    const o = mockOaths.find((x) => x.id === id);
    if (o) {
      o.currentDebt = 0;
      o.status = o.dueMs >= Date.now() ? "REPAID_ONTIME" : "DEFAULTED";
    }
    return;
  }
  await apiFetch(`/oaths/${id}/repay`, { method: "POST" });
}

// ---------- Stats
export async function getDailyStats(): Promise<DailyStat[]> {
  await useMockDelay();
  if (USE_MOCK) return mockDailyStats;
  return apiFetch<DailyStat[]>("/stats/daily");
}

export async function getStreak(): Promise<number> {
  await useMockDelay();
  if (USE_MOCK) return mockStreakDays;
  return apiFetch<{ streak: number }>("/stats/streak").then((r) => r.streak);
}

// ---------- Credit
export async function getCreditScore(): Promise<CreditScore> {
  await useMockDelay();
  if (USE_MOCK) return mockCreditScore;
  return apiFetch<CreditScore>("/credit");
}

// ---------- Bosses
export async function getBossFights(): Promise<BossFight[]> {
  await useMockDelay();
  if (USE_MOCK) return mockBossFights;
  return apiFetch<BossFight[]>("/bosses");
}

export async function getMercyTokens(): Promise<number> {
  await useMockDelay();
  if (USE_MOCK) return mockMercyTokens;
  return apiFetch<{ count: number }>("/mercy").then((r) => r.count);
}

// ---------- Device
export async function getDevice(): Promise<DeviceInfo> {
  await useMockDelay();
  if (USE_MOCK) return mockDevice;
  return apiFetch<DeviceInfo>("/device");
}

export async function testConnection(): Promise<boolean> {
  if (USE_MOCK) {
    await useMockDelay();
    return true;
  }
  try {
    await apiFetch<{ ok: boolean }>("/health");
    return true;
  } catch {
    return false;
  }
}

// ---------- Settings (localStorage in mock; PATCH in real)
export async function getSettings(): Promise<AppSettings> {
  await useMockDelay();
  if (typeof window !== "undefined") {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      try {
        return { ...defaultSettings, ...JSON.parse(raw) };
      } catch {
        /* ignore */
      }
    }
  }
  if (USE_MOCK) return defaultSettings;
  return apiFetch<AppSettings>("/settings");
}

export async function saveSettings(s: AppSettings): Promise<void> {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }
  if (USE_MOCK) {
    await useMockDelay();
    return;
  }
  await apiFetch("/settings", { method: "PATCH", body: JSON.stringify(s) });
}

// ---------- Export
export function exportLedgerCSV(entries: LedgerEntry[]): string {
  const head = ["id", "timestampMs", "category", "description", "merchant", "spendClass", "amount", "status"];
  const rows = entries.map((e) =>
    [
      e.id,
      e.timestampMs,
      e.category,
      JSON.stringify(e.description ?? ""),
      JSON.stringify(e.merchantName ?? ""),
      e.spendClass ?? "",
      e.amount,
      e.status ?? "",
    ].join(","),
  );
  return [head.join(","), ...rows].join("\n");
}

// ---------- Marketplace
export async function getMarketplaceCatalogue(): Promise<{
  passes: MarketplacePass[];
  monthly_marketplace_spent: number;
  monthly_marketplace_cap: number;
  current_balance: number;
}> {
  await useMockDelay();
  if (USE_MOCK) {
    return {
      passes: mockMarketplaceCatalogue,
      monthly_marketplace_spent: 340,
      monthly_marketplace_cap: 1500,
      current_balance: 1240,
    };
  }
  return apiFetch<{
    passes: MarketplacePass[];
    monthly_marketplace_spent: number;
    monthly_marketplace_cap: number;
    current_balance: number;
  }>("/marketplace/catalogue");
}

export async function purchasePass(pass_type: PassType, notes?: string): Promise<{
  id: number;
  pass_type: string;
  status: string;
  price_paid: number;
  new_balance: number;
}> {
  await useMockDelay();
  if (USE_MOCK) {
    const pass = mockMarketplaceCatalogue.find((p: MarketplacePass) => p.pass_type === pass_type);
    const cost = pass ? pass.total_price : 0;
    const newPass: PurchasedPass = {
      id: Math.floor(Math.random() * 10000),
      pass_type,
      status: "PURCHASED",
      category: pass?.category || "TIME",
      price_paid: cost,
      purchased_at_ms: Date.now(),
      activated_at_ms: null,
      expires_at_ms: null,
      ms_remaining: null,
      notes: notes || null,
      loot_bonus_minutes: 0,
    };
    mockPurchasedPasses.unshift(newPass);
    return {
      id: newPass.id,
      pass_type,
      status: "PURCHASED",
      price_paid: cost,
      new_balance: 1240 - cost,
    };
  }
  return apiFetch<{
    id: number;
    pass_type: string;
    status: string;
    price_paid: number;
    new_balance: number;
  }>("/marketplace/purchase", {
    method: "POST",
    body: JSON.stringify({ pass_type, notes }),
  });
}

export async function activatePass(pass_id: number): Promise<{
  id: number;
  pass_type: string;
  status: string;
  activated_at_ms: number;
  expires_at_ms: number | null;
  duration_minutes: number;
}> {
  await useMockDelay();
  if (USE_MOCK) {
    const pass = mockPurchasedPasses.find((p: PurchasedPass) => p.id === pass_id);
    const now = Date.now();
    if (pass) {
      pass.status = "ACTIVE";
      pass.activated_at_ms = now;
      const passDef = mockMarketplaceCatalogue.find((p: MarketplacePass) => p.pass_type === pass.pass_type);
      const dur = passDef?.duration_minutes || 0;
      pass.expires_at_ms = dur ? now + dur * 60000 : null;
      pass.ms_remaining = dur ? dur * 60000 : null;
      return {
        id: pass_id,
        pass_type: pass.pass_type,
        status: "ACTIVE",
        activated_at_ms: now,
        expires_at_ms: pass.expires_at_ms,
        duration_minutes: dur,
      };
    }
  }
  return apiFetch<{
    id: number;
    pass_type: string;
    status: string;
    activated_at_ms: number;
    expires_at_ms: number | null;
    duration_minutes: number;
  }>(`/marketplace/activate/${pass_id}`, { method: "POST" });
}

export async function getMyPasses(): Promise<PurchasedPass[]> {
  await useMockDelay();
  if (USE_MOCK) return mockPurchasedPasses;
  return apiFetch<PurchasedPass[]>("/marketplace/my-passes");
}

export async function cancelPass(pass_id: number): Promise<{ status: string; message: string }> {
  await useMockDelay();
  if (USE_MOCK) {
    const pass = mockPurchasedPasses.find((p: PurchasedPass) => p.id === pass_id);
    if (pass) {
      pass.status = "CANCELLED";
    }
    return { status: "cancelled", message: "Pass cancelled. No refund issued." };
  }
  return apiFetch<{ status: string; message: string }>(`/marketplace/cancel/${pass_id}`, {
    method: "DELETE",
  });
}

export async function endPassEarly(pass_id: number): Promise<{ status: string; message: string }> {
  await useMockDelay();
  if (USE_MOCK) {
    const pass = mockPurchasedPasses.find((p: PurchasedPass) => p.id === pass_id);
    if (pass) {
      pass.status = "EXPIRED";
      pass.expires_at_ms = Date.now();
      pass.ms_remaining = 0;
    }
    return { status: "ok", message: "Pass ended early." };
  }
  return apiFetch<{ status: string; message: string }>(`/marketplace/end-early/${pass_id}`, {
    method: "PATCH",
  });
}

// ---------- Wellness
export async function getWellnessDashboard() {
  if (USE_MOCK) return {
    current_sleep: { is_sleeping: false, sleep_at_ms: null },
    sleep_history: [],
    exercise_history: [],
    step_history: [],
    sleep_multiplier_today: 1.0,
  };
  return apiFetch<any>("/wellness/dashboard");
}

export async function startSleep(): Promise<{ session_id: number; sleep_at_ms: number }> {
  if (USE_MOCK) return { session_id: 1, sleep_at_ms: Date.now() };
  return apiFetch<any>("/wellness/sleep/start", { method: "POST", body: JSON.stringify({}) });
}

export async function wakeSleep(): Promise<{ duration_hours: number; quality: string; multiplier: number; message: string }> {
  if (USE_MOCK) return { duration_hours: 7.5, quality: "GOOD", multiplier: 1.0, message: "Good morning!" };
  return apiFetch<any>("/wellness/sleep/wake", { method: "POST", body: JSON.stringify({}) });
}

export async function logExercise(input: {
  exercise_type: string;
  duration_minutes: number;
}): Promise<{ earned: number; exercise_type: string; duration_minutes: number }> {
  if (USE_MOCK) return { earned: 50, exercise_type: input.exercise_type, duration_minutes: input.duration_minutes };
  return apiFetch<any>("/wellness/exercise/log", { method: "POST", body: JSON.stringify(input) });
}

// ---------- Manual Deductions
export async function submitDeduction(input: {
  amount: number;
  reason: string;
  category?: string;
}): Promise<{
  verdict: string;
  amount_deducted?: number;
  original_amount: number;
  reasoning: string;
  new_balance?: number;
  deduction_id: number;
  can_override?: boolean;
  override_cost?: number;
  override_tax?: number;
  message?: string;
}> {
  if (USE_MOCK) return {
    verdict: "APPROVED",
    amount_deducted: input.amount,
    original_amount: input.amount,
    reasoning: "Mock: penalty approved.",
    new_balance: 1000,
    deduction_id: 1,
  };
  return apiFetch<any>("/deductions", { method: "POST", body: JSON.stringify(input) });
}

export async function overrideRejection(deduction_id: number): Promise<{
  amount_deducted: number;
  stubbornness_tax: number;
  new_balance: number;
}> {
  if (USE_MOCK) return { amount_deducted: 120, stubbornness_tax: 20, new_balance: 880 };
  return apiFetch<any>("/deductions/override", { method: "POST", body: JSON.stringify({ deduction_id }) });
}

// ---------- AI Challenges
export async function getAIChallenges(): Promise<any[]> {
  if (USE_MOCK) return [
    {
      id: 1,
      title: "Instagram Detox",
      description: "Keep total Instagram drain under ₹80 this week",
      metric_type: "DISTRACTION_DRAIN_MAX",
      metric_target: 80,
      current_value: 34,
      status: "ACTIVE",
      reward_type: "RUPEE_PAYOUT",
      reward_value: 200,
      expires_at: new Date(Date.now() + 5 * 86400_000).toISOString().split("T")[0],
      ai_rationale: "Instagram was your top drain last week at ₹240",
    },
    {
      id: 2,
      title: "5-Day Streak",
      description: "Hit your study target 5 days in a row",
      metric_type: "STREAK_DAYS",
      metric_target: 5,
      current_value: 2,
      status: "ACTIVE",
      reward_type: "MERCY_TOKEN",
      reward_value: 1,
      expires_at: new Date(Date.now() + 5 * 86400_000).toISOString().split("T")[0],
      ai_rationale: "You broke your streak 3 times last fortnight",
    },
  ];
  return apiFetch<any[]>("/bosses");   // reuses bosses query key for now
}

// ---------- Rate Suggestions
export async function getRateSuggestions(): Promise<any[]> {
  if (USE_MOCK) return [];
  return apiFetch<any[]>("/settings/suggestions");
}

export async function applyRateSuggestion(id: number): Promise<{ status: string; field: string; new_value: number }> {
  if (USE_MOCK) return { status: "applied", field: "hourly_earn_rate", new_value: 120 };
  return apiFetch<any>(`/settings/suggestions/${id}/apply`, { method: "POST" });
}

export async function dismissRateSuggestion(id: number): Promise<{ status: string }> {
  if (USE_MOCK) return { status: "dismissed" };
  return apiFetch<any>(`/settings/suggestions/${id}/dismiss`, { method: "POST" });
}
