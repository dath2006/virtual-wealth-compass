import { useAnimatedCounter } from "@/lib/hooks/useAnimatedCounter";
import { fmtINR, fmtNumber } from "@/lib/formatters";

interface Props {
  value: number;
  currency?: boolean;
  suffix?: string;
  className?: string;
}

export function AnimatedCounter({ value, currency, suffix, className }: Props) {
  const v = useAnimatedCounter(value);
  const text = currency ? fmtINR(v) : fmtNumber(v);
  return (
    <span className={`num ${className ?? ""}`}>
      {text}
      {suffix}
    </span>
  );
}
