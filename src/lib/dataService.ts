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
