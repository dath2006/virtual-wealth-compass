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
import { toISODate } from "./formatters";

const now = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ----- Ledger: ~60 entries spread over last 30 days
let id = 1;
const make = (
  daysAgo: number,
  hoursAgo: number,
  e: Omit<LedgerEntry, "id" | "timestampMs">,
): LedgerEntry => ({
  id: id++,
  timestampMs: now - daysAgo * DAY - hoursAgo * HOUR,
  status: "VERIFIED",
  ...e,
});

const merchants = ["Swiggy", "Zomato", "Blinkit", "Amazon", "Uber", "BookMyShow", "Starbucks", "Decathlon"];
const distractApps = ["Instagram", "YouTube", "Netflix", "Reddit"];

const seedEntries: LedgerEntry[] = [];
for (let d = 0; d < 30; d++) {
  // morning NFC focus
  if (d % 1 === 0 && Math.random() > 0.15) {
    const mult = d < 6 ? [1, 1.2, 1.5][Math.min(2, Math.floor(d / 2))] : 1.4;
    const hrs = 1 + Math.random() * 2;
    seedEntries.push(
      make(d, 9, {
        amount: Math.round(100 * hrs * mult),
        category: "NFC",
        description: `Focus session: ${Math.floor(hrs)}h ${Math.round((hrs % 1) * 60)}m`,
      }),
    );
  }
  // step income evening
  if (Math.random() > 0.2) {
    const steps = 4000 + Math.floor(Math.random() * 9000);
    const earn =
      steps >= 10000 ? 50 : steps >= 8000 ? 40 : steps >= 5000 ? 25 : 0;
    if (earn > 0) {
      seedEntries.push(
        make(d, 4, {
          amount: earn,
          category: "STEP_INCOME",
          description: `${steps.toLocaleString("en-IN")} steps today`,
        }),
      );
    }
  }
  // upi spends
  const spendCount = Math.floor(Math.random() * 3);
  for (let i = 0; i < spendCount; i++) {
    const m = merchants[Math.floor(Math.random() * merchants.length)];
    const amt = -(50 + Math.floor(Math.random() * 600));
    seedEntries.push(
      make(d, 6 + i * 2, {
        amount: amt,
        category: "SMS_UPI",
        description: "UPI debit",
        merchantName: m,
        spendClass: ["Swiggy", "Zomato", "BookMyShow", "Starbucks"].includes(m)
          ? "DISCRETIONARY"
          : "ESSENTIAL",
      }),
    );
  }
  // distraction drain
  if (Math.random() > 0.3) {
    const app = distractApps[Math.floor(Math.random() * distractApps.length)];
    const mins = 10 + Math.floor(Math.random() * 50);
    seedEntries.push(
      make(d, 14, {
        amount: -mins * 2,
        category: "DISTRACTION",
        description: `${mins}min on ${app} (₹2/min)`,
      }),
    );
  }
  // occasional lazy tax
  if (d > 0 && d % 7 === 3) {
    seedEntries.push(
      make(d, 23, {
        amount: -100,
        category: "LAZY_TAX",
        description: "Missed daily target",
      }),
    );
  }
}

// Today bonus oath repay
seedEntries.push(
  make(0, 1, {
    amount: -500,
    category: "OATH_REPAY",
    description: "Repaid: Finish DAA assignment",
  }),
);

export const mockLedger: LedgerEntry[] = seedEntries.sort(
  (a, b) => b.timestampMs - a.timestampMs,
);

// ----- NFC Sessions
export const mockSessions: NfcSession[] = Array.from({ length: 15 }, (_, i) => {
  const dur = 25 + Math.floor(Math.random() * 155); // 25..180 min
  const start = now - i * DAY - 9 * HOUR;
  const mult = [1, 1.2, 1.5, 1.4, 2.0][i % 5];
  const base = Math.round((dur / 60) * 100);
  return {
    id: i + 1,
    tagLabel: i % 3 === 0 ? "Library Tag" : "Desk Tag",
    startMs: start,
    endMs: start + dur * 60_000,
    durationMin: dur,
    baseEarned: base,
    multiplier: mult,
    finalEarned: Math.round(base * mult),
  };
});

// ----- Usage report
export const mockUsageReport: UsageReport = {
  totalDrainedToday: 0,
  apps: [
    { packageName: "com.instagram.android", appName: "Instagram", category: "SOCIAL", costPerMin: 2, surgeCostPerMin: 4, monthlyCapMin: 600, surgeEnabled: true, minutesToday: 45, minutesThisMonth: 540 },
    { packageName: "com.google.android.youtube", appName: "YouTube", category: "ENTERTAINMENT", costPerMin: 1.5, surgeCostPerMin: 3, monthlyCapMin: 900, surgeEnabled: true, minutesToday: 30, minutesThisMonth: 720 },
    { packageName: "com.netflix.mediaclient", appName: "Netflix", category: "ENTERTAINMENT", costPerMin: 1, surgeCostPerMin: 2, monthlyCapMin: 600, surgeEnabled: false, minutesToday: 20, minutesThisMonth: 280 },
    { packageName: "com.application.zomato", appName: "Zomato", category: "SHOPPING", costPerMin: 3, surgeCostPerMin: 6, monthlyCapMin: 120, surgeEnabled: true, minutesToday: 12, minutesThisMonth: 90 },
    { packageName: "com.flipkart.android", appName: "Flipkart", category: "SHOPPING", costPerMin: 3, surgeCostPerMin: 6, monthlyCapMin: 120, surgeEnabled: true, minutesToday: 8, minutesThisMonth: 60 },
    { packageName: "com.whatsapp", appName: "WhatsApp", category: "SOCIAL", costPerMin: 0, surgeCostPerMin: 0, monthlyCapMin: 0, surgeEnabled: false, minutesToday: 90, minutesThisMonth: 2400 },
  ],
  byCategory: [],
};
mockUsageReport.totalDrainedToday = mockUsageReport.apps.reduce(
  (s, a) => s + a.minutesToday * a.costPerMin,
  0,
);
const catMap = new Map<string, { drained: number; minutes: number }>();
for (const a of mockUsageReport.apps) {
  const e = catMap.get(a.category) ?? { drained: 0, minutes: 0 };
  e.drained += a.minutesToday * a.costPerMin;
  e.minutes += a.minutesToday;
  catMap.set(a.category, e);
}
mockUsageReport.byCategory = Array.from(catMap.entries()).map(([category, v]) => ({
  category: category as any,
  ...v,
}));

// ----- Oaths
export const mockOaths: Oath[] = [
  {
    id: 1, task: "Finish DBMS chapter 4 notes",
    loanAmount: 800, currentDebt: 880,
    dailyInterest: 0.02,
    createdMs: now - 5 * DAY, dueMs: now + 2 * DAY,
    status: "ACTIVE", tier: "GOLD",
  },
  {
    id: 2, task: "Complete DAA assignment",
    loanAmount: 500, currentDebt: 720,
    dailyInterest: 0.04,
    createdMs: now - 10 * DAY, dueMs: now - 2 * DAY,
    status: "OVERDUE", tier: "SILVER",
  },
  {
    id: 3, task: "Read OS textbook ch.3",
    loanAmount: 300, currentDebt: 0,
    dailyInterest: 0.02,
    createdMs: now - 20 * DAY, dueMs: now - 18 * DAY,
    status: "REPAID_EARLY", tier: "PLATINUM",
  },
  {
    id: 4, task: "Coursera ML week 2",
    loanAmount: 600, currentDebt: 0,
    dailyInterest: 0.02,
    createdMs: now - 25 * DAY, dueMs: now - 21 * DAY,
    status: "REPAID_ONTIME", tier: "GOLD",
  },
  {
    id: 5, task: "DSA contest practice",
    loanAmount: 400, currentDebt: 0,
    dailyInterest: 0.03,
    createdMs: now - 40 * DAY, dueMs: now - 35 * DAY,
    status: "DEFAULTED", tier: "DEFAULTER",
  },
];

// ----- Daily stats (last 365 for heatmap, last 30 explicit)
export const mockDailyStats: DailyStat[] = Array.from({ length: 365 }, (_, i) => {
  const dateMs = now - i * DAY;
  const target = 180;
  let mins = 180 + Math.round((Math.random() - 0.3) * 120);
  if (Math.random() < 0.18) mins = Math.round(Math.random() * 100);
  if (i < 6 && Math.random() < 0.05) mins = 0;
  return {
    dateISO: toISODate(dateMs),
    studyMin: Math.max(0, mins),
    targetMin: target,
    hit: mins >= target,
  };
});

// Streak: count consecutive recent hits
let streak = 0;
for (const d of mockDailyStats) {
  if (d.hit) streak++;
  else break;
}
export const mockStreakDays = Math.max(6, streak);

// ----- Boss fights
export const mockBossFights: BossFight[] = [
  {
    id: 1, title: "DBMS End Sem",
    deadlineMs: now + 8 * DAY,
    targetHours: 20, currentHours: 7.5,
    lootDescription: "Mercy Token + ₹500 payout",
    lootAmount: 500,
  },
  {
    id: 2, title: "DAA Project Submission",
    deadlineMs: now + 3 * DAY,
    targetHours: 12, currentHours: 9,
    lootDescription: "₹300 payout + free scroll pass",
    lootAmount: 300,
  },
];

// ----- Credit score
export const mockCreditScore: CreditScore = {
  score: 720,
  tier: "GOLD",
  recentEvents: [
    { label: "Early repayment", delta: 50, whenMs: now - 5 * DAY },
    { label: "On-time repayment", delta: 25, whenMs: now - 12 * DAY },
    { label: "Default", delta: -100, whenMs: now - 40 * DAY },
    { label: "Streak ≥ 7 days bonus", delta: 30, whenMs: now - 20 * DAY },
  ],
};

// ----- Settings
export const defaultSettings: AppSettings = {
  hourlyNfcRate: 100,
  stepDailyCap: 50,
  dailyStudyHours: 3,
  lazyTaxAmount: 100,
  lazyTaxThresholdPct: 50,
  unlockTax: 30,
  monthlyDiscretionaryBudget: 3000,
  categoryCaps: { SOCIAL: 1200, ENTERTAINMENT: 1500, SHOPPING: 800, GAMING: 600 },
  defaultDailyInterestPct: 2,
  studyHoursStart: "09:00",
  studyHoursEnd: "22:00",
  salaryDay: "SUN",
  apiBaseUrl: "https://your-vps-ip:8000",
};

export const mockDevice: DeviceInfo = {
  deviceId: "pixel-8a-7b2c",
  lastHeartbeatMs: now - 3 * 60_000,
  batteryPct: 78,
};

export const mockMercyTokens = 2;
