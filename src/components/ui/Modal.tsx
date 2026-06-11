import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Modal({ open, onClose, title, children }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-foreground/15 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="glass-strong fixed left-1/2 top-1/2 z-50 w-[min(94vw,520px)] -translate-x-1/2 -translate-y-1/2 rounded-3xl p-6"
          >
            <div className="mb-4 flex items-center justify-between gap-4">
              <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
              <button
                onClick={onClose}
                className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
