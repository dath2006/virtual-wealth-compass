import { Link, useRouterState } from "@tanstack/react-router";
import { motion } from "framer-motion";
import {
  LayoutDashboard, ScrollText, Timer, Smartphone,
  FileSignature, Trophy, Settings,
} from "lucide-react";

const items = [
  { to: "/",             label: "Dashboard",   icon: LayoutDashboard },
  { to: "/ledger",       label: "Ledger",      icon: ScrollText },
  { to: "/focus",        label: "Focus",       icon: Timer },
  { to: "/distraction",  label: "Distraction", icon: Smartphone },
  { to: "/oaths",        label: "Oaths",       icon: FileSignature },
  { to: "/achievements", label: "Achievements",icon: Trophy },
  { to: "/settings",     label: "Settings",    icon: Settings },
] as const;

export function SidebarNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="glass sticky top-4 hidden h-[calc(100vh-2rem)] w-60 shrink-0 flex-col overflow-hidden rounded-3xl p-4 md:flex">
        <div className="mb-6 flex items-center gap-2.5 px-2 pt-1">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-violet to-primary text-primary-foreground shadow-sm">
            <span className="text-base font-bold">₹</span>
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">Productivity</div>
            <div className="truncate text-[11px] text-muted-foreground">Economy</div>
          </div>
        </div>

        <nav className="relative flex flex-col gap-1">
          {items.map((it) => {
            const active = pathname === it.to;
            const Icon = it.icon;
            return (
              <Link
                key={it.to}
                to={it.to}
                className="relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-foreground/70 transition hover:text-foreground"
              >
                {active && (
                  <motion.span
                    layoutId="sidebar-active"
                    className="absolute inset-0 -z-10 rounded-xl bg-white/85 shadow-[0_4px_18px_-8px_rgba(80,60,160,0.25)]"
                    transition={{ type: "spring", stiffness: 380, damping: 32 }}
                  />
                )}
                <Icon className={`size-4 shrink-0 ${active ? "text-primary" : ""}`} />
                <span className={active ? "text-foreground" : ""}>{it.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-2xl bg-white/55 p-3 text-[11px] leading-snug text-muted-foreground">
          Web brain · v0.1
          <div className="mt-1 text-foreground/70">Android sensor layer sends events here.</div>
        </div>
      </aside>

      {/* Mobile bottom tab bar */}
      <nav className="glass-strong fixed inset-x-3 bottom-3 z-40 flex items-center justify-between rounded-2xl px-2 py-1.5 md:hidden">
        {items.map((it) => {
          const active = pathname === it.to;
          const Icon = it.icon;
          return (
            <Link
              key={it.to}
              to={it.to}
              className="relative flex flex-1 flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 text-[10px] font-medium text-foreground/60 transition active:scale-95"
            >
              {active && (
                <motion.span
                  layoutId="mobile-active"
                  className="absolute inset-0 -z-10 rounded-xl bg-white/85"
                />
              )}
              <Icon className={`size-[18px] ${active ? "text-primary" : ""}`} />
              <span className={active ? "text-foreground" : ""}>{it.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
