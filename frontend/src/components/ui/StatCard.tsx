import { motion } from "framer-motion";
import type { ReactNode } from "react";

interface Props {
  label: string;
  children: ReactNode;
  accent?: "violet" | "success" | "destructive" | "warning" | "default";
  hint?: ReactNode;
  index?: number;
}

const accentBar: Record<NonNullable<Props["accent"]>, string> = {
  violet: "from-violet/70 to-violet/0",
  success: "from-success/70 to-success/0",
  destructive: "from-destructive/70 to-destructive/0",
  warning: "from-warning/80 to-warning/0",
  default: "from-primary/60 to-primary/0",
};

export function StatCard({ label, children, accent = "default", hint, index = 0 }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.05, ease: [0.22, 1, 0.36, 1] }}
      className="glass relative overflow-hidden rounded-2xl p-5"
    >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r ${accentBar[accent]}`} />
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold text-foreground">{children}</div>
      {hint && <div className="mt-2 text-xs text-muted-foreground">{hint}</div>}
    </motion.div>
  );
}
