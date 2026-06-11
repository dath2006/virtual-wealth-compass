import type { LedgerCategory } from "@/lib/types";

const map: Record<LedgerCategory, { label: string; cls: string }> = {
  NFC:         { label: "NFC",        cls: "bg-violet/15 text-violet" },
  SMS_UPI:     { label: "UPI",        cls: "bg-destructive/15 text-destructive" },
  STEP_INCOME: { label: "Steps",      cls: "bg-success/15 text-success-foreground" },
  LAZY_TAX:    { label: "Lazy Tax",   cls: "bg-warning/20 text-warning-foreground" },
  DISTRACTION: { label: "Distract",   cls: "bg-orange-500/15 text-orange-700" },
  OATH:        { label: "Oath",       cls: "bg-sky-500/15 text-sky-700" },
  OATH_REPAY:  { label: "Repay",      cls: "bg-sky-500/15 text-sky-700" },
  REVERSAL:    { label: "Reversal",   cls: "bg-muted text-foreground/70" },
  MANUAL:      { label: "Manual",     cls: "bg-muted text-foreground/70" },
};

export function CategoryBadge({ category }: { category: LedgerCategory }) {
  const m = map[category];
  return <span className={`chip ${m.cls}`}>{m.label}</span>;
}
