import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { IconAlert, IconCheck, IconDropletPlus } from "./icons";

interface Toast {
  id: number;
  msg: string;
  tone: "ok" | "warn" | "drip";
}

const ToastCtx = createContext<(msg: string, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((msg: string, tone: Toast["tone"] = "ok") => {
    const id = ++idRef.current;
    setToasts((t) => [...t.slice(-2), { id, msg, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3400);
  }, []);

  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[72px] z-[90] flex flex-col items-center gap-2 px-4 sm:top-6">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              role="status"
              className="flex max-w-[92vw] items-center gap-2.5 rounded-xl border border-line bg-card py-2.5 pr-4 pl-3 text-sm text-ink shadow-(--shadow-pop)"
            >
              <span
                className={
                  t.tone === "warn"
                    ? "text-amberish"
                    : t.tone === "drip"
                      ? "text-accent"
                      : "text-vip"
                }
              >
                {t.tone === "warn" ? <IconAlert size={16} /> : t.tone === "drip" ? <IconDropletPlus size={16} /> : <IconCheck size={16} />}
              </span>
              <span className="truncate">{t.msg}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}
