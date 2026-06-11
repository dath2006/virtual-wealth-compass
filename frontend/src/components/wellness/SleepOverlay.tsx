import { useEffect, useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sun } from "lucide-react";

interface SleepOverlayProps {
  sleepAtMs: number;
  onWake: () => void;
  isPending: boolean;
}

// Stable star positions — computed once, never re-randomised on re-render
const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  x: ((i * 137.508) % 100),
  y: ((i * 97.31 + 13) % 100),
  r: 0.6 + (i % 5) * 0.35,
  dur: 2.5 + (i % 7) * 0.6,
  delay: (i % 11) * 0.4,
  opacity: 0.25 + (i % 4) * 0.18,
}));

// Sleep quality label based on elapsed hours
function sleepLabel(hrs: number) {
  if (hrs >= 8) return { text: "Excellent sleep 🌟", color: "oklch(0.72 0.16 155)" };
  if (hrs >= 7) return { text: "Good sleep", color: "oklch(0.7 0.14 155)" };
  if (hrs >= 6) return { text: "Adequate", color: "oklch(0.78 0.14 70)" };
  if (hrs >= 5) return { text: "Need more rest", color: "oklch(0.7 0.18 25)" };
  if (hrs >= 1) return { text: "Keep going...", color: "oklch(0.65 0.18 25)" };
  return { text: "Just started", color: "oklch(0.6 0.12 285)" };
}

export function SleepOverlay({ sleepAtMs, onWake, isPending }: SleepOverlayProps) {
  const [elapsedMs, setElapsedMs] = useState(() => Date.now() - sleepAtMs);

  useEffect(() => {
    const t = setInterval(() => setElapsedMs(Date.now() - sleepAtMs), 1000);
    return () => clearInterval(t);
  }, [sleepAtMs]);

  const totalSecs = Math.max(0, Math.floor(elapsedMs / 1000));
  const hrs  = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad  = (n: number) => n.toString().padStart(2, "0");

  const elapsedHrs = elapsedMs / 3_600_000;
  // Progress toward 8h goal (capped at 100%)
  const progress = Math.min(1, elapsedHrs / 8);
  const circumference = 2 * Math.PI * 90; // r=90
  const dashOffset = circumference * (1 - progress);

  const startStr = new Date(sleepAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const quality  = sleepLabel(elapsedHrs);

  return (
    <motion.div
      key="sleep-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.9, ease: "easeInOut" }}
      className="fixed inset-0 z-9999 flex flex-col overflow-hidden select-none"
      style={{
        background: `
          radial-gradient(ellipse 120% 80% at 60% -10%, oklch(0.32 0.18 290), transparent 65%),
          radial-gradient(ellipse 80% 60% at 0% 100%, oklch(0.18 0.12 310 / 0.7), transparent 55%),
          radial-gradient(ellipse 70% 50% at 100% 80%, oklch(0.15 0.08 260 / 0.5), transparent 50%),
          linear-gradient(175deg, oklch(0.14 0.08 285) 0%, oklch(0.09 0.06 280) 60%, oklch(0.07 0.04 270) 100%)
        `,
      }}
    >
      {/* ── Starfield ────────────────────────────────────────────────── */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        <defs>
          <style>{`
            @keyframes twinkle {
              0%,100% { opacity: var(--base-op); transform: scale(1); }
              50%      { opacity: 1;              transform: scale(1.6); }
            }
            @keyframes breathe {
              0%,100% { transform: scale(1);    opacity: 0.18; }
              50%      { transform: scale(1.22); opacity: 0.38; }
            }
            @keyframes breathe2 {
              0%,100% { transform: scale(1);    opacity: 0.12; }
              50%      { transform: scale(1.15); opacity: 0.28; }
            }
            @keyframes floatMoon {
              0%,100% { transform: translateY(0px); }
              50%      { transform: translateY(-14px); }
            }
            @keyframes rotateSlow {
              from { transform: rotate(0deg); }
              to   { transform: rotate(360deg); }
            }
            @keyframes shimmer {
              0%,100% { opacity: 0.55; }
              50%      { opacity: 1; }
            }
            @keyframes wakeGlow {
              0%,100% { box-shadow: 0 0 0 0px oklch(0.78 0.14 70 / 0); }
              50%      { box-shadow: 0 0 0 8px oklch(0.78 0.14 70 / 0.18); }
            }
          `}</style>
        </defs>
        {STARS.map((s) => (
          <circle
            key={s.id}
            cx={`${s.x}%`}
            cy={`${s.y}%`}
            r={s.r}
            fill="white"
            style={{
              ["--base-op" as any]: s.opacity,
              animation: `twinkle ${s.dur}s ${s.delay}s ease-in-out infinite`,
              opacity: s.opacity,
            }}
          />
        ))}
        {/* Shooting star */}
        <motion.line
          x1="70%" y1="8%" x2="85%" y2="22%"
          stroke="white" strokeWidth="0.8" strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: [0, 1, 0], opacity: [0, 0.7, 0] }}
          transition={{ duration: 1.4, delay: 3, repeat: Infinity, repeatDelay: 12 }}
        />
      </svg>

      {/* ── Ambient nebula blobs ──────────────────────────────────────── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <motion.div
          animate={{ x: ["-5%", "5%", "-5%"], y: [0, "-8%", 0] }}
          transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -top-40 -left-40 w-[700px] h-[700px] rounded-full"
          style={{ background: "radial-gradient(circle, oklch(0.45 0.2 290 / 0.12) 0%, transparent 70%)" }}
        />
        <motion.div
          animate={{ x: ["5%", "-5%", "5%"], y: [0, "8%", 0] }}
          transition={{ duration: 35, repeat: Infinity, ease: "easeInOut" }}
          className="absolute -bottom-40 -right-40 w-[600px] h-[600px] rounded-full"
          style={{ background: "radial-gradient(circle, oklch(0.38 0.16 310 / 0.15) 0%, transparent 70%)" }}
        />
      </div>

      {/* ── Main layout: vertically centred ─────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center justify-center flex-1 gap-0 px-6">

        {/* Moon + breathing halos */}
        <div className="relative flex items-center justify-center" style={{ width: 260, height: 260 }}>
          {/* Outermost halo */}
          <div
            className="absolute rounded-full border"
            style={{
              width: 260, height: 260,
              borderColor: "oklch(0.62 0.2 290 / 0.12)",
              animation: "breathe 7s ease-in-out infinite",
            }}
          />
          {/* Middle halo */}
          <div
            className="absolute rounded-full border"
            style={{
              width: 210, height: 210,
              borderColor: "oklch(0.62 0.2 290 / 0.18)",
              animation: "breathe2 7s 1.2s ease-in-out infinite",
            }}
          />
          {/* Inner ring glow */}
          <div
            className="absolute rounded-full"
            style={{
              width: 170, height: 170,
              background: "radial-gradient(circle, oklch(0.55 0.18 285 / 0.22) 0%, transparent 70%)",
              animation: "breathe 7s 0.6s ease-in-out infinite",
            }}
          />

          {/* Sleep progress arc — SVG ring */}
          <svg
            className="absolute"
            width={220} height={220}
            viewBox="0 0 200 200"
            style={{ transform: "rotate(-90deg)" }}
          >
            {/* Track */}
            <circle
              cx="100" cy="100" r="90"
              fill="none"
              stroke="oklch(0.62 0.2 290 / 0.12)"
              strokeWidth="3"
            />
            {/* Progress */}
            <motion.circle
              cx="100" cy="100" r="90"
              fill="none"
              stroke="oklch(0.72 0.2 290)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset: dashOffset }}
              transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
              style={{ filter: "drop-shadow(0 0 6px oklch(0.72 0.2 290 / 0.5))" }}
            />
          </svg>

          {/* Moon face — crescent via clipping */}
          <motion.div
            style={{ animation: "floatMoon 8s ease-in-out infinite" }}
            className="relative"
          >
            {/* Moon glow backdrop */}
            <div
              className="absolute rounded-full"
              style={{
                inset: -20,
                background: "radial-gradient(circle, oklch(0.78 0.1 285 / 0.25) 0%, transparent 70%)",
                filter: "blur(12px)",
              }}
            />
            {/* Moon disc */}
            <div
              className="relative rounded-full overflow-hidden"
              style={{
                width: 100,
                height: 100,
                background: "linear-gradient(135deg, oklch(0.92 0.04 290) 0%, oklch(0.82 0.06 290) 60%, oklch(0.72 0.1 290) 100%)",
                boxShadow: `
                  inset -6px -4px 12px oklch(0.5 0.12 280 / 0.4),
                  0 0 30px oklch(0.72 0.16 285 / 0.35),
                  0 0 60px oklch(0.62 0.18 285 / 0.15)
                `,
              }}
            >
              {/* Crescent shadow */}
              <div
                className="absolute rounded-full"
                style={{
                  width: 90,
                  height: 90,
                  top: -10,
                  right: -30,
                  background: "oklch(0.18 0.1 280)",
                }}
              />
              {/* Surface texture dots */}
              <div className="absolute top-5 left-4 w-2 h-2 rounded-full bg-white/10" />
              <div className="absolute top-9 left-8 w-1 h-1 rounded-full bg-white/8" />
              <div className="absolute top-6 right-8 w-1.5 h-1.5 rounded-full bg-white/8" />
            </div>
          </motion.div>

          {/* % toward 8h - arc label */}
          <div
            className="absolute bottom-1 text-[10px] font-semibold tracking-wider"
            style={{ color: "oklch(0.72 0.2 290 / 0.7)" }}
          >
            {Math.round(progress * 100)}% of 8h
          </div>
        </div>

        {/* RESTING badge */}
        <div
          className="flex items-center gap-1.5 mt-4 text-[10px] font-bold tracking-[0.2em] uppercase"
          style={{ color: "oklch(0.72 0.16 285 / 0.7)" }}
        >
          <span className="relative flex h-1.5 w-1.5">
            <span
              className="animate-ping absolute inline-flex h-full w-full rounded-full"
              style={{ background: "oklch(0.72 0.16 285)" }}
            />
            <span
              className="relative inline-flex rounded-full h-1.5 w-1.5"
              style={{ background: "oklch(0.72 0.16 285)" }}
            />
          </span>
          Resting
        </div>

        {/* Big clock */}
        <div
          className="mt-5 num tabular-nums leading-none"
          style={{
            fontFamily: "'Inter', ui-monospace, monospace",
            fontSize: "clamp(4rem, 15vw, 7rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "oklch(0.96 0.03 290)",
            textShadow: "0 0 40px oklch(0.72 0.2 285 / 0.4)",
          }}
        >
          {pad(hrs)}
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
            style={{ color: "oklch(0.62 0.2 285 / 0.6)", margin: "0 4px" }}
          >:</motion.span>
          {pad(mins)}
          <motion.span
            animate={{ opacity: [1, 0.3, 1] }}
            transition={{ duration: 1, repeat: Infinity, ease: "easeInOut" }}
            style={{ color: "oklch(0.62 0.2 285 / 0.6)", margin: "0 4px" }}
          >:</motion.span>
          {pad(secs)}
        </div>

        {/* Quality label */}
        <motion.p
          key={quality.text}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-2 text-sm font-medium"
          style={{ color: quality.color }}
        >
          {quality.text}
        </motion.p>

        {/* Start time */}
        <p
          className="mt-1 text-xs font-medium"
          style={{ color: "oklch(0.62 0.1 285 / 0.55)" }}
        >
          Started at{" "}
          <span style={{ color: "oklch(0.75 0.1 285 / 0.8)" }}>{startStr}</span>
        </p>

        {/* Wake CTA */}
        <motion.button
          onClick={onWake}
          disabled={isPending}
          whileHover={{ scale: 1.05, y: -2 }}
          whileTap={{ scale: 0.96 }}
          className="mt-10 flex items-center gap-2.5 px-8 py-3.5 rounded-2xl font-bold text-sm transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: "linear-gradient(135deg, oklch(0.82 0.16 70) 0%, oklch(0.75 0.18 55) 100%)",
            color: "oklch(0.25 0.08 70)",
            boxShadow: "0 4px 24px oklch(0.78 0.14 70 / 0.4), 0 1px 0 oklch(0.9 0.1 70 / 0.6) inset",
            animation: "wakeGlow 3s ease-in-out infinite",
          }}
        >
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
          >
            <Sun className="size-4" />
          </motion.div>
          <span>{isPending ? "Waking up…" : "Good Morning"}</span>
        </motion.button>

        {/* Hint */}
        <p
          className="mt-4 text-[11px] text-center max-w-[240px] leading-relaxed"
          style={{ color: "oklch(0.55 0.08 285 / 0.6)" }}
        >
          Open on any device — your sleep state is synced in real time.
        </p>
      </div>

      {/* Bottom brand watermark */}
      <div
        className="relative z-10 flex items-center justify-center gap-1.5 py-5 text-[10px] font-semibold tracking-[0.18em] uppercase"
        style={{ color: "oklch(0.45 0.1 285 / 0.45)" }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/>
        </svg>
        Wealth Compass · Sleep Tracker
      </div>
    </motion.div>
  );
}
