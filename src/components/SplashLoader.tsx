import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Logo } from "./Logo";

const spring = { type: "spring", damping: 15, stiffness: 200 } as const;

export function SplashLoader({
  onReveal,
  onDone,
}: {
  onReveal: () => void;
  onDone: () => void;
}) {
  // 0 mark entrance · 1 morph + wordmark · 2 dry subtitle · 3 shrink into navbar
  const [phase, setPhase] = useState(0);
  const [dock, setDock] = useState<{ x: number; y: number; s: number } | null>(null);
  const lockupRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 850),
      setTimeout(() => setPhase(2), 1650),
      setTimeout(() => setPhase(3), 2750),
    ];
    return () => timers.forEach(clearTimeout);
  }, []);

  const finish = () => {
    if (!doneRef.current) {
      doneRef.current = true;
      onReveal();
      onDone();
    }
  };

  // phase 3 — hand the lockup off to the navbar brand slot
  useEffect(() => {
    if (phase !== 3) return;
    onReveal();
    const t = setTimeout(() => {
      const lockup = lockupRef.current;
      const slot = document.getElementById("pp-brand");
      if (lockup && slot) {
        const a = lockup.getBoundingClientRect();
        const b = slot.getBoundingClientRect();
        const s = Math.min(b.height / a.height, 0.42);
        setDock({
          x: b.left + b.width / 2 - (a.left + a.width / 2),
          y: b.top + b.height / 2 - (a.top + a.height / 2),
          s,
        });
      }
      const done = setTimeout(() => {
        if (!doneRef.current) {
          doneRef.current = true;
          onDone();
        }
      }, 620);
      return () => clearTimeout(done);
    }, 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  return (
    <motion.div
      className="fixed inset-0 z-[80] flex cursor-pointer select-none flex-col items-center justify-center"
      onClick={finish}
      animate={{ opacity: dock ? 0 : 1 }}
      transition={{ duration: 0.45, ease: [0.76, 0, 0.24, 1], delay: dock ? 0.12 : 0 }}
      onAnimationComplete={() => {
        if (dock && !doneRef.current) {
          doneRef.current = true;
          onDone();
        }
      }}
      style={{ background: "var(--canvas)" }}
    >
      {/* organic pulse halo */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
        {[0, 1.6, 3.2].map((d) => (
          <span
            key={d}
            className="pond-ring absolute left-1/2 top-1/2 h-40 w-40 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/25"
            style={{ animationDelay: `${d}s` }}
          />
        ))}
      </div>

      <motion.div
        ref={lockupRef}
        className="relative flex flex-col items-center"
        animate={dock ? { x: dock.x, y: dock.y, scale: dock.s } : { x: 0, y: 0, scale: 1 }}
        transition={dock ? { duration: 0.55, ease: [0.76, 0, 0.24, 1] } : undefined}
        style={{ transformOrigin: "center center" }}
      >
        {/* phase 0 — the pond mark springs in */}
        <motion.div
          initial={{ scale: 0.3, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", damping: 20, stiffness: 100 }}
          style={{ filter: "drop-shadow(0 10px 30px var(--glow-a))" }}
        >
          <motion.div
            animate={
              phase >= 1
                ? { rotate: [0, -7, 5, 0], scaleY: [1, 0.85, 1.06, 1], scaleX: [1, 1.09, 0.97, 1] }
                : { rotate: 0 }
            }
            transition={{ duration: 0.8, times: [0, 0.35, 0.7, 1], ease: "easeInOut" }}
          >
            <Logo size={86} />
          </motion.div>
        </motion.div>

        {/* phase 1 — wordmark rises from an invisible mask */}
        <div className="mt-5 overflow-hidden pb-1">
          <motion.div
            initial={{ y: "118%" }}
            animate={{ y: phase >= 1 ? 0 : "118%" }}
            transition={spring}
            className="font-display text-[38px] leading-none font-semibold tracking-tight text-ink"
          >
            ponspool
          </motion.div>
        </div>

        {/* phase 2 — the dry subtitle */}
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: phase >= 2 ? 1 : 0, y: phase >= 2 ? 0 : 4 }}
          transition={{ duration: 0.2 }}
          className="mt-2 font-mono text-[11px] tracking-[0.18em] text-muted"
        >
          thickening the pond.
        </motion.div>
      </motion.div>

      <div className="absolute bottom-8 font-mono text-[10px] tracking-[0.14em] text-faint">
        robinhood chain · 4663 · tap to skip
      </div>
    </motion.div>
  );
}
