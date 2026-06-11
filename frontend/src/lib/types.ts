export type LedgerCategory =
  | "NFC"
  | "SMS_UPI"
  | "NOTIFICATION_UPI"
  | "STEP_INCOME"
  | "LAZY_TAX"
  | "DISTRACTION"
  | "OATH"
  | "OATH_LOAN"
  | "OATH_INTEREST"
  | "OATH_REPAY"
  | "REVERSAL"
  | "MANUAL"
  | "BOSS_REWARD"
  | "SURGE"
  | "MERCY_SPEND";

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
  endMs: number | null;   // null = session still running
  isOpen: boolean;
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

export type PassCategory = "TIME" | "ACTIVITY" | "COOLDOWN";
export type PassStatus = "PURCHASED" | "ACTIVE" | "EXPIRED" | "CONSUMED" | "CANCELLED";
export type PassType =
  | "MOVIE"
  | "GAMING"
  | "BINGE"
  | "NAP"
  | "STUDY_BREAK"
  | "RESTAURANT"
  | "WEEKEND_OUTING"
  | "BOOK_PURCHASE"
  | "WEEKEND_MODE"
  | "VACATION_MODE";

export interface MarketplacePass {
  pass_type: PassType;
  display_name: string;
  description: string;
  category: PassCategory;
  virtual_price: number;
  duration_minutes: number | null;
  can_purchase: boolean;
  blocked_reason: string | null;
  guilt_tax_amount: number;
  total_price: number;
  weekly_used: number;
  weekly_limit: number;
  locked_until_streak: number;
  valid_after_hour: number;
  blocked_during_study_hours: boolean;
}

export interface PurchasedPass {
  id: number;
  pass_type: PassType;
  status: PassStatus;
  category: PassCategory;
  price_paid: number;
  purchased_at_ms: number;
  activated_at_ms: number | null;
  expires_at_ms: number | null;
  ms_remaining: number | null;
  notes: string | null;
  loot_bonus_minutes: number;
}
