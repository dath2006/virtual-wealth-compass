import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { SidebarNav } from "../components/layout/SidebarNav";
import { ToastProvider, useToast } from "../lib/toast";
import { useEconomyStream } from "../lib/hooks/useEconomyStream";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass max-w-md rounded-3xl p-8 text-center">
        <h1 className="text-6xl font-semibold tracking-tight text-foreground">404</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          This page wandered off the ledger.
        </p>
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition active:scale-[0.97]"
        >
          Back to Dashboard
        </a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="glass max-w-md rounded-3xl p-8 text-center">
        <h1 className="text-lg font-semibold tracking-tight">Something glitched</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Try refreshing or jump back home.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground active:scale-[0.97]"
          >
            Try again
          </button>
          <a
            href="/"
            className="rounded-xl bg-white/80 px-4 py-2 text-sm font-medium text-foreground active:scale-[0.97]"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Effex" },
      { name: "description", content: "Your productivity, money, and focus — gamified into one virtual economy." },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Productivity Economy" },
      { property: "og:description", content: "Your productivity, money, and focus — gamified into one virtual economy." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getMyPasses, endPassEarly, getWellnessDashboard, wakeSleep } from "../lib/dataService";
import { SleepOverlay } from "../components/wellness/SleepOverlay";

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

  const totalSecs = Math.max(0, Math.floor(timeLeftMs / 1000));
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;

  const pad = (n: number) => n.toString().padStart(2, "0");

  return (
    <span className="font-mono font-bold">
      {hrs > 0 ? `${hrs}h ` : ""}{pad(mins)}m {pad(secs)}s
    </span>
  );
}

function ActivePassBanner() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: myPasses = [] } = useQuery({
    queryKey: ["my_passes"],
    queryFn: getMyPasses,
    refetchInterval: 15000,
  });

  const activePass = myPasses.find((p) => p.status === "ACTIVE");

  const endEarlyMutation = useMutation({
    mutationFn: endPassEarly,
    onSuccess: (data) => {
      toast(data.message);
      qc.invalidateQueries({ queryKey: ["my_passes"] });
      qc.invalidateQueries({ queryKey: ["marketplace_catalogue"] });
    },
    onError: (err: any) => {
      toast(`Failed to end pass early: ${err.message || err}`);
    },
  });

  if (!activePass) return null;

  const EMOJI_MAP: Record<string, string> = {
    MOVIE: "🎬",
    GAMING: "🎮",
    BINGE: "📺",
    NAP: "😴",
    STUDY_BREAK: "☕",
    RESTAURANT: "🍽️",
    WEEKEND_OUTING: "🚶",
    BOOK_PURCHASE: "📚",
    WEEKEND_MODE: "🌅",
    VACATION_MODE: "✈️",
  };
  const emoji = EMOJI_MAP[activePass.pass_type] || "🎟️";
  const name = activePass.pass_type.replace(/_/g, " ");

  return (
    <motion.div
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      className="mb-4 flex items-center justify-between gap-4 rounded-2xl bg-linear-to-r from-violet via-primary to-violet p-3 px-4 text-white shadow-md"
      style={{
        backgroundSize: "200% 200%",
        animation: "pulseGradient 4s ease infinite",
      }}
    >
      <div className="flex items-center gap-2.5 text-xs font-semibold md:text-sm">
        <span className="text-lg">{emoji}</span>
        <span className="capitalize tracking-tight">{name} Pass Active</span>
        {activePass.expires_at_ms ? (
          <>
            <span className="opacity-50">•</span>
            <CountdownTimer
              expiresAtMs={activePass.expires_at_ms}
              onComplete={() => qc.invalidateQueries({ queryKey: ["my_passes"] })}
            />
            <span className="text-[11px] opacity-75 font-normal">remaining</span>
          </>
        ) : (
          <>
            <span className="opacity-50">•</span>
            <span className="text-[11px] font-normal opacity-85">Active until consumed</span>
          </>
        )}
      </div>
      <button
        onClick={() => endEarlyMutation.mutate(activePass.id)}
        disabled={endEarlyMutation.isPending}
        className="rounded-xl bg-white/20 hover:bg-white/30 text-white border border-white/10 px-3 py-1.5 text-xs font-bold transition duration-200 active:scale-95 disabled:opacity-50 shrink-0"
      >
        {endEarlyMutation.isPending ? "Ending..." : "End Early"}
      </button>
    </motion.div>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <EconomyStreamWatcher />
        <RootLayoutContent />
      </ToastProvider>
    </QueryClientProvider>
  );
}

function RootLayoutContent() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const dashboard = useQuery({
    queryKey: ["wellness"],
    queryFn: getWellnessDashboard,
    refetchInterval: 10000,
  });

  const isSleeping = dashboard.data?.current_sleep?.is_sleeping ?? false;
  const sleepAtMs = dashboard.data?.current_sleep?.sleep_at_ms ?? 0;

  const wakeMutation = useMutation({
    mutationFn: wakeSleep,
    onSuccess: (result: any) => {
      if (result.skipped) {
        toast(`⚠️ ${result.message}`);
      } else {
        const QUALITY_CONFIG = {
          EXCELLENT: "Excellent (+15% earn rate)",
          GOOD:      "Good (normal earn rate)",
          ADEQUATE:  "Adequate (-5% earn rate)",
          POOR:      "Poor (-15% earn rate)",
          BAD:       "Bad (-25% earn rate)",
        };
        const label = QUALITY_CONFIG[result.quality as keyof typeof QUALITY_CONFIG] ?? result.quality;
        toast(`🌅 Slept ${result.duration_hours}h — ${label}`);
      }
      qc.invalidateQueries({ queryKey: ["wellness"] });
      qc.invalidateQueries({ queryKey: ["balance"] });
    },
    onError: () => {
      toast("Sleep action failed");
    },
  });

  return (
    <div className="relative">
      <div className="mx-auto flex w-full max-w-[1400px] gap-6 px-3 py-4 md:px-5 md:py-5">
        <SidebarNav />
        {/* Only the main content area blurs during sleep */}
        <motion.main
          animate={isSleeping ? { filter: "blur(8px)", scale: 0.98, opacity: 0.4 } : { filter: "blur(0px)", scale: 1, opacity: 1 }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="min-w-0 flex-1"
          style={{ transformOrigin: "center top", willChange: "filter, transform, opacity" }}
        >
          <ActivePassBanner />
          <Outlet />
        </motion.main>
      </div>

      <AnimatePresence mode="wait">
        {isSleeping && sleepAtMs > 0 && (
          <SleepOverlay
            key="sleep-overlay"
            sleepAtMs={sleepAtMs}
            onWake={() => wakeMutation.mutate()}
            isPending={wakeMutation.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Mounts the SSE connection once at the app root. Fires inside QueryClientProvider. */
function EconomyStreamWatcher() {
  const qc = useQueryClient();
  const { toast } = useToast();

  useEconomyStream(
    (balance: number) => {
      qc.setQueryData(["balance"], balance);
    },
    (app: string, amount: number, surge: boolean) => {
      toast(
        `${surge ? "⚡ Surge!" : "📱"} ${app} drained ${
          new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount)
        }${surge ? " (surge rate)" : ""}`,
      );
    },
  );

  return null;
}
