import { motion } from "framer-motion";
import type { DailyStat } from "@/lib/types";

interface Props {
  data: DailyStat[]; // newest first; we'll group into weeks
}

const COLS = 26; // ~6 months
const ROWS = 7;

function colorFor(mins: number, target: number) {
  if (mins === 0) return "oklch(0.92 0.015 280)"; // empty
  const ratio = mins / target;
  if (ratio < 0.25) return "oklch(0.85 0.08 290)";
  if (ratio < 0.6)  return "oklch(0.75 0.13 290)";
  if (ratio < 0.9)  return "oklch(0.65 0.18 290)";
  return "oklch(0.55 0.22 290)";
}

export function HeatmapCalendar({ data }: Props) {
  // Map dates -> entries. Build a grid: oldest at col 0.
  const days = COLS * ROWS;
  const slice = data.slice(0, days).reverse();
  while (slice.length < days) slice.unshift({ dateISO: "", studyMin: 0, targetMin: 180, hit: false });

  const cell = 14;
  const gap = 3;
  const w = COLS * (cell + gap);
  const h = ROWS * (cell + gap);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full max-w-full">
      {slice.map((d, i) => {
        const col = Math.floor(i / ROWS);
        const row = i % ROWS;
        const x = col * (cell + gap);
        const y = row * (cell + gap);
        return (
          <motion.rect
            key={i}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.001, duration: 0.25 }}
            x={x}
            y={y}
            width={cell}
            height={cell}
            rx={3}
            fill={colorFor(d.studyMin, d.targetMin)}
          >
            <title>{d.dateISO ? `${d.dateISO}: ${d.studyMin}m / ${d.targetMin}m` : ""}</title>
          </motion.rect>
        );
      })}
    </svg>
  );
}
