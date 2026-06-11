import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Lock, Timer, AlertCircle, ShoppingBag, XCircle, Play, CheckCircle } from "lucide-react";
import type { MarketplacePass, PurchasedPass, AppSettings } from "@/lib/types";
import { fmtINR } from "@/lib/formatters";

// Helper to check activation constraints client-side
export function checkActivationEligibility(
  passType: string,
  catalogue: MarketplacePass[],
  settings?: AppSettings
): { canActivate: boolean; reason: string | null } {
  const passDef = catalogue.find((p) => p.pass_type === passType);
  if (!passDef) return { canActivate: true, reason: null };

  const now = new Date();
  const currentHour = now.getHours();

  // 1. Time-of-day restriction
  if (passDef.valid_after_hour > 0 && currentHour < passDef.valid_after_hour) {
    return {
      canActivate: false,
      reason: `Only valid after ${passDef.valid_after_hour}:00`,
    };
  }

  // 2. Weekend-only restriction
  // Note: WEEKEND_MODE and WEEKEND_OUTING are valid on Saturday (6) and Sunday (0)
  if (passType === "WEEKEND_MODE" || passType === "WEEKEND_OUTING" || passDef.valid_after_hour === 18 && now.getDay() !== 0 && now.getDay() !== 6) {
    // If it requires weekends and today is weekday
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;
    if (!isWeekend && (passType === "WEEKEND_MODE" || passType === "WEEKEND_OUTING")) {
      return { canActivate: false, reason: "Only valid on weekends" };
    }
  }

  // 3. Study hours restriction
  if (passDef.blocked_during_study_hours && settings) {
    const startHour = parseInt(settings.studyHoursStart.split(":")[0]) || 9;
    const endHour = parseInt(settings.studyHoursEnd.split(":")[0]) || 22;
    if (currentHour >= startHour && currentHour < endHour) {
      return {
        canActivate: false,
        reason: `Blocked during study hours (${settings.studyHoursStart}–${settings.studyHoursEnd})`,
      };
    }
  }

  return { canActivate: true, reason: null };
}

// --- Live Timer Component for ACTIVE passes
function CountdownTimer({ expiresAtMs, onComplete }: { expiresAtMs: number; onComplete?: () => void }) {
  const [timeLeftMs, setTimeLeftMs] = useState(expiresAtMs - Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = expiresAtMs - Date.now();
      if (remaining <= 0) {
        setTimeLeftMs(0);
        clearInterval(interval);
        if (onComplete) onComplete();
      } else {
        setTimeLeftMs(remaining);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAtMs, onComplete]);

  const totalSecs = Math.floor(timeLeftMs / 1000);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <span className="font-mono text-sm font-bold tracking-wider">
      {hrs > 0 ? `${hrs}h ` : ""}{pad(mins)}m {pad(secs)}s
    </span>
  );
}

// --- CATALOGUE PASS CARD ---
interface CatalogueCardProps {
  pass: MarketplacePass;
  currentStreak: number;
  currentBalance: number;
  onBuy: (pass: MarketplacePass) => void;
}

export function CataloguePassCard({ pass, currentStreak, currentBalance, onBuy }: CatalogueCardProps) {
  const isLocked = currentStreak < pass.locked_until_streak;
  const isAffordable = currentBalance >= pass.total_price;
  
  // Weekly limits pill content
  const limitText = pass.weekly_limit > 0 
    ? `${pass.weekly_used}/${pass.weekly_limit} this week`
    : "Unlimited";
  
  const limitReached = pass.weekly_limit > 0 && pass.weekly_used >= pass.weekly_limit;
  const showBlockedReason = !pass.can_purchase && pass.blocked_reason && !isLocked && !limitReached;

  // Determine button state and styles
  let btnText = "Buy Pass";
  let btnClass = "bg-primary text-primary-foreground hover:opacity-90";
  let btnDisabled = false;

  if (isLocked) {
    btnText = `Locked 🔒`;
    btnClass = "bg-muted text-muted-foreground cursor-not-allowed";
    btnDisabled = true;
  } else if (limitReached) {
    btnText = "Limit Reached";
    btnClass = "bg-muted text-destructive cursor-not-allowed";
    btnDisabled = true;
  } else if (showBlockedReason) {
    btnText = "Not Eligible";
    btnClass = "bg-destructive/10 text-destructive border border-destructive/20 cursor-not-allowed";
    btnDisabled = true;
  } else if (!isAffordable) {
    btnText = "Insufficient ₹";
    btnClass = "bg-muted text-muted-foreground cursor-not-allowed";
    btnDisabled = true;
  } else if (pass.guilt_tax_amount > 0) {
    btnText = "Buy + Guilt Tax";
    btnClass = "bg-amber-500 text-white hover:bg-amber-600 shadow-sm";
  }

  // Get Emoji from name or standard mapping
  const matchEmoji = pass.display_name.match(/[\p{Emoji}\u200d]+/gu);
  const emoji = matchEmoji ? matchEmoji[0] : "🎟️";
  const displayNameWithoutEmoji = pass.display_name.replace(/[\p{Emoji}\u200d]+/gu, "").trim();

  return (
    <div className={`glass relative flex flex-col justify-between rounded-3xl p-5 transition-all duration-300 hover:translate-y-[-2px] hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)] ${isLocked ? "opacity-75" : ""}`}>
      {/* Top Section */}
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <span className="text-3xl" role="img" aria-label="pass icon">
              {emoji}
            </span>
            <div>
              <h3 className="text-base font-semibold text-foreground tracking-tight">
                {displayNameWithoutEmoji}
              </h3>
              <span className="inline-block rounded-full bg-white/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {pass.category}
              </span>
            </div>
          </div>
          
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${limitReached ? "bg-destructive/15 text-destructive" : "bg-primary/10 text-primary-foreground"}`}>
            {limitText}
          </span>
        </div>

        <p className="mt-3.5 text-xs text-muted-foreground leading-relaxed">
          {pass.description}
        </p>

        {/* Info badges */}
        <div className="mt-4 flex flex-wrap gap-1.5">
          {pass.duration_minutes ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-white/60 px-2 py-1 text-[11px] text-foreground/80">
              <Timer className="size-3 text-muted-foreground" />
              {pass.duration_minutes >= 1440 
                ? `${Math.round(pass.duration_minutes / 1440)} days` 
                : `${pass.duration_minutes} min`}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-lg bg-white/60 px-2 py-1 text-[11px] text-foreground/80">
              <CheckCircle className="size-3 text-muted-foreground" />
              Single Use
            </span>
          )}

          {pass.valid_after_hour > 0 && (
            <span className="rounded-lg bg-white/60 px-2 py-1 text-[11px] text-foreground/80">
              After {pass.valid_after_hour}:00
            </span>
          )}

          {pass.locked_until_streak > 0 && (
            <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] ${isLocked ? "bg-destructive/10 text-destructive font-medium" : "bg-white/60 text-foreground/80"}`}>
              <Lock className="size-3" />
              {pass.locked_until_streak}-day streak
            </span>
          )}
        </div>
      </div>

      {/* Bottom price and purchase action */}
      <div className="mt-5 pt-3 border-t border-white/40">
        <div className="mb-3 flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Price</span>
          <div className="text-right">
            {pass.guilt_tax_amount > 0 ? (
              <div className="flex flex-col items-end">
                <span className="text-xs text-amber-500 font-medium line-through">
                  {fmtINR(pass.virtual_price)}
                </span>
                <span className="text-base font-bold text-amber-600 flex items-center gap-1">
                  {fmtINR(pass.total_price)}
                  <span className="text-[9px] font-semibold bg-amber-500/10 px-1 py-0.5 rounded uppercase tracking-wider text-amber-600">
                    +₹{pass.guilt_tax_amount} Guilt Tax
                  </span>
                </span>
              </div>
            ) : (
              <span className="text-lg font-bold text-foreground">
                {pass.virtual_price === 0 ? "FREE" : fmtINR(pass.virtual_price)}
              </span>
            )}
          </div>
        </div>

        {showBlockedReason && (
          <div className="mb-2 flex items-start gap-1.5 rounded-lg bg-destructive/5 p-2 text-[10px] text-destructive leading-tight">
            <AlertCircle className="size-3 shrink-0 mt-0.5" />
            <span>{pass.blocked_reason}</span>
          </div>
        )}

        <button
          onClick={() => !btnDisabled && onBuy(pass)}
          disabled={btnDisabled}
          className={`w-full py-2 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all duration-200 active:scale-[0.98] ${btnClass}`}
        >
          {!isLocked && <ShoppingBag className="size-3.5" />}
          {btnText}
        </button>
      </div>
    </div>
  );
}

// --- PURCHASED / HISTORICAL PASS CARD ---
interface PurchasedPassCardProps {
  purchased: PurchasedPass;
  catalogue: MarketplacePass[];
  settings?: AppSettings;
  onActivate?: (id: number) => void;
  onCancel?: (id: number) => void;
  onEndEarly?: (id: number) => void;
  onTimerComplete?: () => void;
}

export function PurchasedPassCard({
  purchased,
  catalogue,
  settings,
  onActivate,
  onCancel,
  onEndEarly,
  onTimerComplete,
}: PurchasedPassCardProps) {
  const { status, category, price_paid, purchased_at_ms, activated_at_ms, notes } = purchased;
  const catalogueDef = catalogue.find((p) => p.pass_type === purchased.pass_type);
  const displayName = catalogueDef?.display_name || purchased.pass_type;

  // Check client-side activation eligibility
  const { canActivate, reason: blockReason } = checkActivationEligibility(
    purchased.pass_type,
    catalogue,
    settings
  );

  // Status badges & borders
  let borderClass = "border-white/40";
  let statusBadge = "";
  
  if (status === "ACTIVE") {
    borderClass = "border-violet/40 ring-1 ring-violet/20 bg-violet/5";
    statusBadge = "bg-violet text-white";
  } else if (status === "EXPIRED" || status === "CONSUMED") {
    borderClass = "opacity-70 border-white/20";
    statusBadge = "bg-muted text-muted-foreground";
  } else if (status === "CANCELLED") {
    borderClass = "opacity-60 border-white/10";
    statusBadge = "bg-destructive/10 text-destructive";
  } else {
    // PURCHASED
    borderClass = "border-primary/20 bg-primary/5";
    statusBadge = "bg-primary/10 text-primary-foreground";
  }

  const matchEmoji = displayName.match(/[\p{Emoji}\u200d]+/gu);
  const emoji = matchEmoji ? matchEmoji[0] : "🎟️";
  const nameOnly = displayName.replace(/[\p{Emoji}\u200d]+/gu, "").trim();

  return (
    <div className={`glass border flex flex-col justify-between rounded-3xl p-5 transition-all duration-300 ${borderClass}`}>
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="text-3xl">{emoji}</span>
            <div>
              <h3 className="text-base font-semibold text-foreground tracking-tight">{nameOnly}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${statusBadge}`}>
                  {status}
                </span>
                <span className="text-[10px] text-muted-foreground uppercase font-medium">{category}</span>
              </div>
            </div>
          </div>
          <span className="num text-xs font-semibold text-foreground bg-white/40 px-2 py-0.5 rounded-lg">
            Paid: {fmtINR(price_paid)}
          </span>
        </div>

        {notes && (
          <p className="mt-3 rounded-lg bg-black/5 px-2.5 py-1.5 text-[11px] italic text-muted-foreground">
            &ldquo;{notes}&rdquo;
          </p>
        )}

        <div className="mt-4 space-y-1 text-xs text-muted-foreground leading-relaxed">
          <div>Bought {formatDistanceToNow(new_stateful_date(purchased_at_ms), { addSuffix: true })}</div>
          
          {activated_at_ms && (
            <div>Activated {formatDistanceToNow(new_stateful_date(activated_at_ms), { addSuffix: true })}</div>
          )}
          
          {purchased.loot_bonus_minutes > 0 && (
            <div className="text-yellow-600 font-medium flex items-center gap-1">
              🏆 Boss Loot: +{purchased.loot_bonus_minutes}m added
            </div>
          )}
        </div>
      </div>

      {/* Actions based on State */}
      <div className="mt-5 pt-3 border-t border-white/30">
        {status === "PURCHASED" && (
          <div className="flex flex-col gap-2.5">
            {!canActivate && blockReason && (
              <div className="flex items-start gap-1 text-[10px] text-destructive leading-tight">
                <AlertCircle className="size-3 shrink-0 mt-0.5" />
                <span>{blockReason}</span>
              </div>
            )}
            
            <div className="flex items-center justify-between gap-4">
              {onCancel && (
                <button
                  onClick={() => onCancel(purchased.id)}
                  className="text-xs font-medium text-destructive/80 hover:text-destructive flex items-center gap-1 hover:underline"
                >
                  <XCircle className="size-3.5" />
                  Cancel
                </button>
              )}
              
              {onActivate && (
                <button
                  onClick={() => canActivate && onActivate(purchased.id)}
                  disabled={!canActivate}
                  className={`flex-1 py-1.5 px-4 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 ${
                    canActivate
                      ? "bg-primary text-primary-foreground hover:opacity-90 shadow-sm"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  }`}
                >
                  <Play className="size-3" />
                  Start Now
                </button>
              )}
            </div>
          </div>
        )}

        {status === "ACTIVE" && (
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-1.5 text-violet font-semibold">
              {purchased.expires_at_ms ? (
                <>
                  <Timer className="size-4 animate-pulse" />
                  <CountdownTimer expiresAtMs={purchased.expires_at_ms} onComplete={onTimerComplete} />
                </>
              ) : (
                <span className="text-xs font-medium bg-violet/10 px-2 py-0.5 rounded">Active until consumed</span>
              )}
            </div>

            {onEndEarly && (
              <button
                onClick={() => onEndEarly(purchased.id)}
                className="py-1 px-3 rounded-lg text-[11px] font-semibold bg-destructive/10 text-destructive border border-destructive/15 transition hover:bg-destructive hover:text-white active:scale-95"
              >
                End Early
              </button>
            )}
          </div>
        )}

        {(status === "EXPIRED" || status === "CONSUMED" || status === "CANCELLED") && (
          <div className="text-[11px] font-medium text-muted-foreground">
            {status === "EXPIRED" && "Pass completed"}
            {status === "CONSUMED" && "Consumed by matching transaction"}
            {status === "CANCELLED" && "Cancelled without starting"}
          </div>
        )}
      </div>
    </div>
  );
}

// Stateful Date parser to avoid SSR hydration mismatches
function new_stateful_date(ms: number) {
  return new Date(ms);
}
