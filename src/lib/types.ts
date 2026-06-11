export type LedgerCategory =
  | "NFC"
  | "SMS_UPI"
  | "STEP_INCOME"
  | "LAZY_TAX"
  | "DISTRACTION"
  | "OATH"
  | "OATH_REPAY"
  | "REVERSAL"
  | "MANUAL";

export type SpendClass = "ESSENTIAL" | "DISCRETIONARY" | null;
export type LedgerStatus = "VERIFIED" | "PENDING" | "DISPUTED" | "REVERSED";

export interface LedgerEntry {
  id: number;
  amount: number; // positive = earn, negative = spend
  category: LedgerCategory;
  description: string;
  merchantName?: string;
  spendClass?: SpendClass;
  status?: LedgerStatus;
  timestampMs: number;
}

export interface NfcSession {
  id: number;
  tagLabel: string;
  startMs: number;
  endMs: number;
  durationMin: number;
  baseEarned: number;
  multiplier: number;
  finalEarned: number;
}

export type AppCategory = "SOCIAL" | "ENTERTAINMENT" | "SHOPPING" | "GAMING";

export interface DistractionApp {
  packageName: string;
  appName: string;
  category: AppCategory;
  costPerMin: number;
  surgeCostPerMin: number;
  monthlyCapMin: number; // 0 disables
  surgeEnabled: boolean;
  minutesToday: number;
  minutesThisMonth: number;
}

export interface UsageReport {
  totalDrainedToday: number;
  apps: DistractionApp[];
  byCategory: { category: AppCategory; drained: number; minutes: number }[];
}

export type OathStatus = "ACTIVE" | "OVERDUE" | "REPAID_EARLY" | "REPAID_ONTIME" | "DEFAULTED";

export interface Oath {
  id: number;
  task: string;
  loanAmount: number;
  currentDebt: number;
  dailyInterest: number; // 0.02 = 2%/day
  createdMs: number;
  dueMs: number;
  status: OathStatus;
  tier: "PLATINUM" | "GOLD" | "SILVER" | "DEFAULTER";
}

export interface DailyStat {
  dateISO: string; // YYYY-MM-DD
  studyMin: number;
  targetMin: number;
  hit: boolean;
  mercyUsed?: boolean;
}

export interface BossFight {
  id: number;
  title: string;
  deadlineMs: number;
  targetHours: number;
  currentHours: number;
  lootDescription: string;
  lootAmount: number;
}

export interface CreditScore {
  score: number; // 0..900
  tier: "PLATINUM" | "GOLD" | "SILVER" | "DEFAULTER";
  recentEvents: { label: string; delta: number; whenMs: number }[];
}

export interface AppSettings {
  // Earning
  hourlyNfcRate: number;
  stepDailyCap: number;
  dailyStudyHours: number;
  // Penalties
  lazyTaxAmount: number;
  lazyTaxThresholdPct: number;
  unlockTax: number;
  // Budgets
  monthlyDiscretionaryBudget: number;
  categoryCaps: Record<AppCategory, number>;
  // Oath
  defaultDailyInterestPct: number;
  // Schedule
  studyHoursStart: string; // "09:00"
  studyHoursEnd: string;   // "22:00"
  salaryDay: "SUN" | "MON" | "TUE" | "WED" | "THU" | "FRI" | "SAT";
  // Connection
  apiBaseUrl: string;
}

export interface DeviceInfo {
  deviceId: string;
  lastHeartbeatMs: number;
  batteryPct: number;
}
