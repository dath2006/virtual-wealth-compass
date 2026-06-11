import { AnimatePresence, motion } from "framer-motion";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, AlertCircle, Info } from "lucide-react";

type ToastKind = "success" | "error" | "info";
interface Toast { id: number; kind: ToastKind; message: string }

interface Ctx {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastCtx = createContext<Ctx>({ toast: () => {} });

export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);

  const toast = useCallback((message: string, kind: ToastKind = "success") => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(92vw,360px)] flex-col gap-2">
        <AnimatePresence>
          {items.map((t) => {
            const Icon =
              t.kind === "success" ? CheckCircle2 : t.kind === "error" ? AlertCircle : Info;
            const tint =
              t.kind === "success"
                ? "text-success"
                : t.kind === "error"
                ? "text-destructive"
                : "text-primary";
            return (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 14, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.22 }}
                className="glass-strong pointer-events-auto flex items-start gap-2.5 rounded-2xl px-3.5 py-3 text-sm"
              >
                <Icon className={`mt-0.5 size-4 shrink-0 ${tint}`} />
                <span className="text-foreground/90">{t.message}</span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
