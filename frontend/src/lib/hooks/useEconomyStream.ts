import { useEffect, useRef, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { isMockMode } from "../dataService";

/**
 * useEconomyStream
 *
 * Connects to GET /stream and handles live economy events from the backend.
 * Automatically reconnects on disconnect (built into fetchEventSource).
 * Does nothing in mock mode.
 *
 * Events received:
 *  - init:         initial balance on connect
 *  - drain:        distraction app session ended → balance decreased
 *  - earn:         NFC session/steps/exercise → balance increased
 *  - upi:          UPI payment detected → balance decreased
 *  - balance:      general balance refresh
 *  - pass_expired: marketplace pass expired
 *  - boss_beaten:  boss fight completed → loot awarded
 */
export function useEconomyStream(
  onBalanceUpdate?: (balance: number) => void,
  onDrain?: (app: string, amount: number, surge: boolean) => void,
) {
  const qc = useQueryClient();
  const ctrl = useRef<AbortController | null>(null);

  const invalidateBalance = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["balance"] });
    qc.invalidateQueries({ queryKey: ["ledger"] });
  }, [qc]);

  useEffect(() => {
    if (isMockMode()) return;   // SSE not available in mock mode

    const BASE = import.meta.env.VITE_API_BASE_URL ?? "";
    const KEY  = import.meta.env.VITE_API_KEY ?? "";
    const url  = `${BASE}/stream`;

    ctrl.current = new AbortController();

    fetchEventSource(url, {
      headers: { "X-API-Key": KEY },
      signal: ctrl.current.signal,

      onopen: async (res) => {
        if (!res.ok) {
          throw new Error(`SSE connection failed: ${res.status}`);
        }
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
              // Also update usage/distraction queries
              qc.invalidateQueries({ queryKey: ["usage"] });
              break;

            case "earn":
              onBalanceUpdate?.(data.balance);
              invalidateBalance();
              break;

            case "upi":
              onBalanceUpdate?.(data.balance);
              invalidateBalance();
              break;

            case "pass_expired":
              qc.invalidateQueries({ queryKey: ["my_passes"] });
              qc.invalidateQueries({ queryKey: ["marketplace_catalogue"] });
              break;

            case "boss_beaten":
              qc.invalidateQueries({ queryKey: ["bosses"] });
              invalidateBalance();
              break;
          }
        } catch {
          // ignore parse errors
        }
      },

      onerror: (err) => {
        console.warn("SSE error, will reconnect:", err);
        // fetchEventSource auto-reconnects — don't throw
      },

      // Reconnect after every close (it's a long-lived connection)
      openWhenHidden: true,
    }).catch(() => {
      // Silently ignore — this fires when ctrl.current.abort() is called
    });

    return () => {
      ctrl.current?.abort();
    };
  }, []);   // eslint-disable-line react-hooks/exhaustive-deps
}
