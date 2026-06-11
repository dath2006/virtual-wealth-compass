import type { LedgerCategory } from "@/lib/types";

const map: Record<LedgerCategory, { label: string; cls: string }> = {
  NFC:              { label: "NFC",        cls: "bg-violet/15 text-violet" },
  SMS_UPI:          { label: "UPI (SMS)",  cls: "bg-destructive/15 text-destructive" },
  NOTIFICATION_UPI: { label: "UPI (Notif)",cls: "bg-destructive/15 text-destructive" },
  STEP_INCOME:      { label: "Steps",      cls: "bg-success/15 text-success-foreground" },
  LAZY_TAX:         { label: "Lazy Tax",   cls: "bg-warning/20 text-warning-foreground" },
  DISTRACTION:      { label: "Distract",   cls: "bg-orange-500/15 text-orange-700" },
  OATH:             { label: "Oath",       cls: "bg-sky-500/15 text-sky-700" },
  OATH_LOAN:        { label: "Oath Loan",  cls: "bg-sky-500/15 text-sky-700" },
  OATH_INTEREST:    { label: "Interest",   cls: "bg-red-500/15 text-red-700" },
  OATH_REPAY:       { label: "Repay",      cls: "bg-sky-500/15 text-sky-700" },
  REVERSAL:         { label: "Reversal",   cls: "bg-muted text-foreground/70" },
  MANUAL:           { label: "Manual",     cls: "bg-muted text-foreground/70" },
  BOSS_REWARD:      { label: "Boss Reward",cls: "bg-yellow-500/15 text-yellow-700" },
  SURGE:            { label: "Surge",      cls: "bg-amber-500/15 text-amber-700" },
  MERCY_SPEND:      { label: "Mercy Spend",cls: "bg-pink-500/15 text-pink-700" },
};

export function CategoryBadge({ category }: { category: LedgerCategory }) {
  const m = map[category] || { label: category, cls: "bg-muted text-foreground/70" };
  return <span className={`chip ${m.cls}`}>{m.label}</span>;
}
