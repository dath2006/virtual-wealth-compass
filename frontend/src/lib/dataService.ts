import type {
  AppSettings,
  BossFight,
  CreditScore,
  DailyStat,
  LedgerEntry,
  NfcSession,
  Oath,
  UsageReport,
  MarketplacePass,
  PurchasedPass,
  PassType,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const KEY  = import.meta.env.VITE_API_KEY ?? "";

const apiFetch = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": KEY,
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    let errMsg = `API ${path} failed: ${res.status}`;
    try {
      const errJson = await res.json();
      if (errJson && typeof errJson === "object") {
        errMsg = errJson.detail || errJson.message || errJson.error || errMsg;
      }
    } catch { /* ignore non-JSON error bodies */ }
    throw new Error(errMsg);
  }
  return res.json();
};

// ── Ledger ────────────────────────────────────────────────────────────────────

export async function getLedger(limit = 200, offset = 0, category?: string): Promise<LedgerEntry[]> {
  // Guard against TanStack Query passing QueryFunctionContext as first arg
  const safeLimit  = typeof limit  === "number" ? limit  : 200;
  const safeOffset = typeof offset === "number" ? offset : 0;
  const params = new URLSearchParams({ limit: String(safeLimit), offset: String(safeOffset) });
  if (category) params.set("category", category);
  return apiFetch<LedgerEntry[]>(`/ledger?${params}`);
}

export async function getBalance(): Promise<number> {
  return apiFetch<{ balance: number }>("/balance").then((r) => r.balance);
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function getSessions(): Promise<NfcSession[]> {
  return apiFetch<NfcSession[]>("/sessions");
}

// ── Usage ─────────────────────────────────────────────────────────────────────

export async function getUsageReport(): Promise<UsageReport> {
  return apiFetch<UsageReport>("/usage/today");
}

// ── Oaths ─────────────────────────────────────────────────────────────────────

export async function getOaths(): Promise<Oath[]> {
  return apiFetch<Oath[]>("/oaths");
}

export async function createOath(input: {
  task: string;
  loanAmount: number;
  dueMs: number;
}): Promise<Oath> {
  return apiFetch<Oath>("/oaths", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function repayOath(id: number): Promise<{
  status: string;
  resolved_status: string;
  credit_score_delta: number;
}> {
  return apiFetch<{ status: string; resolved_status: string; credit_score_delta: number }>(
    `/oaths/${id}/repay`,
    { method: "POST" },
  );
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export async function getDailyStats(): Promise<DailyStat[]> {
  return apiFetch<DailyStat[]>("/stats/daily");
}

export async function getStreak(): Promise<number> {
  return apiFetch<{ streak: number }>("/stats/streak").then((r) => r.streak);
}

// ── Credit ────────────────────────────────────────────────────────────────────

export async function getCreditScore(): Promise<CreditScore> {
  return apiFetch<CreditScore>("/credit");
}

// ── Boss fights ───────────────────────────────────────────────────────────────

export async function getBossFights(): Promise<BossFight[]> {
  return apiFetch<BossFight[]>("/bosses");
}

export async function createBossFight(input: {
  title: string;
  target_hours: number;
  deadline_ms: number;
  loot_description: string;
  loot_amount: number;
}): Promise<BossFight> {
  return apiFetch<BossFight>("/bosses", { method: "POST", body: JSON.stringify(input) });
}

export async function deleteBossFight(id: number): Promise<void> {
  await apiFetch(`/bosses/${id}`, { method: "DELETE" });
}

export async function getMercyTokens(): Promise<number> {
  return apiFetch<{ count: number }>("/mercy").then((r) => r.count);
}

// ── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<AppSettings> {
  return apiFetch<AppSettings>("/settings");
}

export async function saveSettings(s: Partial<AppSettings>): Promise<void> {
  await apiFetch("/settings", { method: "PATCH", body: JSON.stringify(s) });
}

export async function testConnection(): Promise<boolean> {
  try {
    await apiFetch<{ ok: boolean }>("/health");
    return true;
  } catch {
    return false;
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

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

// ── Marketplace ───────────────────────────────────────────────────────────────

export async function getMarketplaceCatalogue(): Promise<{
  passes: MarketplacePass[];
  monthly_marketplace_spent: number;
  monthly_marketplace_cap: number;
  current_balance: number;
}> {
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
  guilt_tax: number;
  message: string;
  new_balance: number;
}> {
  return apiFetch<{
    id: number;
    pass_type: string;
    status: string;
    price_paid: number;
    guilt_tax: number;
    message: string;
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
  message: string;
}> {
  return apiFetch<{
    id: number;
    pass_type: string;
    status: string;
    activated_at_ms: number;
    expires_at_ms: number | null;
    duration_minutes: number;
    message: string;
  }>(`/marketplace/activate/${pass_id}`, { method: "POST" });
}

export async function getMyPasses(): Promise<PurchasedPass[]> {
  return apiFetch<PurchasedPass[]>("/marketplace/my-passes");
}

export async function cancelPass(pass_id: number): Promise<{ status: string; message: string }> {
  return apiFetch<{ status: string; message: string }>(`/marketplace/cancel/${pass_id}`, {
    method: "DELETE",
  });
}

export async function endPassEarly(pass_id: number): Promise<{ status: string; message: string }> {
  return apiFetch<{ status: string; message: string }>(`/marketplace/end-early/${pass_id}`, {
    method: "PATCH",
  });
}

// ── Wellness ──────────────────────────────────────────────────────────────────

export async function getWellnessDashboard(): Promise<{
  current_sleep: { is_sleeping: boolean; sleep_at_ms: number | null };
  sleep_history: Array<{
    date: string;
    duration_hours: number | null;
    quality: string | null;
    multiplier: number | null;
  }>;
  exercise_history: Array<{
    date: string;
    exercise_type: string;
    duration_minutes: number;
    earned: number;
  }>;
  step_history: Array<{
    date: string;
    steps: number;
    step_income: number;
  }>;
  sleep_multiplier_today: number;
}> {
  return apiFetch("/wellness/dashboard");
}

export async function getSleepCurrent(): Promise<{
  is_sleeping: boolean;
  sleep_at_ms?: number;
  elapsed_hours?: number;
}> {
  return apiFetch("/wellness/sleep/current");
}

export async function startSleep(): Promise<{ session_id: number; sleep_at_ms: number }> {
  return apiFetch<{ session_id: number; sleep_at_ms: number }>("/wellness/sleep/start", {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function wakeSleep(): Promise<{
  duration_hours: number;
  quality: string;
  multiplier: number;
  message: string;
  skipped?: boolean;
}> {
  return apiFetch<{
    duration_hours: number;
    quality: string;
    multiplier: number;
    message: string;
    skipped?: boolean;
  }>("/wellness/sleep/wake", { method: "POST", body: JSON.stringify({}) });
}

export async function logExercise(input: {
  exercise_type: string;
  duration_minutes: number;
}): Promise<{ earned: number; exercise_type: string; duration_minutes: number; rate_per_10_min: number }> {
  return apiFetch<{ earned: number; exercise_type: string; duration_minutes: number; rate_per_10_min: number }>(
    "/wellness/exercise/log",
    { method: "POST", body: JSON.stringify(input) },
  );
}

// ── Deductions ────────────────────────────────────────────────────────────────

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
  return apiFetch<{
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
  }>("/deductions", { method: "POST", body: JSON.stringify(input) });
}

export async function overrideRejection(deduction_id: number): Promise<{
  amount_deducted: number;
  stubbornness_tax: number;
  new_balance: number;
}> {
  return apiFetch<{ amount_deducted: number; stubbornness_tax: number; new_balance: number }>(
    "/deductions/override",
    { method: "POST", body: JSON.stringify({ deduction_id }) },
  );
}

export async function getDeductions(limit = 50): Promise<Array<{
  id: number;
  amount: number;
  reason: string;
  category: string | null;
  verdict: string;
  amount_deducted: number | null;
  original_amount: number;
  reasoning: string;
  created_at_ms: number;
  can_override: boolean;
}>> {
  const safeLimit = typeof limit === "number" ? limit : 50;
  return apiFetch(`/deductions?limit=${safeLimit}`);
}

// ── Rate suggestions ──────────────────────────────────────────────────────────

export async function getRateSuggestions(): Promise<any[]> {
  return apiFetch<any[]>("/settings/suggestions");
}

export async function applyRateSuggestion(id: number): Promise<{ status: string; field: string; new_value: number }> {
  return apiFetch<{ status: string; field: string; new_value: number }>(
    `/settings/suggestions/${id}/apply`,
    { method: "POST" },
  );
}

export async function dismissRateSuggestion(id: number): Promise<{ status: string }> {
  return apiFetch<{ status: string }>(`/settings/suggestions/${id}/dismiss`, { method: "POST" });
}
