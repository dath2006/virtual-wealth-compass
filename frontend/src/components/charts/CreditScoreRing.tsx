import { motion } from "framer-motion";

interface Props {
  score: number;
  max?: number;
  tier: string;
}

export function CreditScoreRing({ score, max = 900, tier }: Props) {
  const size = 160;
  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, score / max));

  const color =
    tier === "PLATINUM" ? "oklch(0.7 0.16 200)" :
    tier === "GOLD"     ? "oklch(0.78 0.16 80)"  :
    tier === "SILVER"   ? "oklch(0.7 0.02 280)"  :
                          "oklch(0.6 0.22 25)";

  return (
    <div className="relative grid place-items-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="oklch(0.92 0.015 280)"
          strokeWidth={stroke}
          fill="none"
        />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct) }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="num text-3xl font-semibold tracking-tight">{score}</div>
        <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground">
          {tier}
        </div>
      </div>
    </div>
  );
}
