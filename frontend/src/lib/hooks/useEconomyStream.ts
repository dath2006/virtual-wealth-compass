import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { useToast } from "../toast";

const fmtINR = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

export function useEconomyStream(
  onBalanceUpdate?: (balance: number) => void,
  onDrain?: (app: string, amount: number, surge: boolean) => void,
) {
  const qc    = useQueryClient();
  const { toast } = useToast();
  const ctrl  = useRef<AbortController | null>(null);

  const invalidateBalance = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["balance"] });
    qc.invalidateQueries({ queryKey: ["ledger"] });
  }, [qc]);

  useEffect(() => {
    const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
    const KEY  = import.meta.env.VITE_API_KEY ?? "";
    if (!BASE) return;   // no server configured yet — skip SSE

    const url = `${BASE}/stream`;
    ctrl.current = new AbortController();

    fetchEventSource(url, {
      headers: { "X-API-Key": KEY },
      signal: ctrl.current.signal,

      onopen: async (res) => {
        if (!res.ok) throw new Error(`SSE connection failed: ${res.status}`);
      },

      onmessage: (ev) => {
        try {
          const data = JSON.parse(ev.data);
          switch (data.type) {
            case "init":
            case "balance":
              onBalanceUpdate?.(data.balance);
              break;

            case "drain":
              onBalanceUpdate?.(data.balance);
              onDrain?.(data.app, data.amount, data.surge ?? false);
              invalidateBalance();
              qc.invalidateQueries({ queryKey: ["usage"] });
              break;

            case "earn":
              onBalanceUpdate?.(data.balance);
              invalidateBalance();
              toast(`✅ Earned ${fmtINR(data.amount)} — ${data.source ?? "focus"}`);
              break;

            case "upi":
              onBalanceUpdate?.(data.balance);
              invalidateBalance();
              toast(`💳 UPI: ${fmtINR(data.amount)} deducted${data.merchant ? ` at ${data.merchant}` : ""}`);
              break;

            case "pass_expired":
              qc.invalidateQueries({ queryKey: ["my_passes"] });
              qc.invalidateQueries({ queryKey: ["marketplace_catalogue"] });
              toast(`🎟️ Pass expired`);
              break;

            case "boss_beaten":
              qc.invalidateQueries({ queryKey: ["bosses"] });
              invalidateBalance();
              toast(`🏆 Boss beaten! Loot: ${data.loot_description ?? "reward"}`);
              break;
          }
        } catch { /* ignore parse errors */ }
      },

      onerror: (err) => {
        console.warn("SSE error, will reconnect:", err);
      },

      openWhenHidden: true,
    }).catch(() => { /* abort() fires here — expected */ });

    return () => { ctrl.current?.abort(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
