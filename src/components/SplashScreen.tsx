import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Logo } from "./Logo";

/*
 * Loading splash: a NEAR-green droplet falls into the pool, splashes, the
 * ripples spread, and the nearpool mark rises out of them. The wordmark
 * pops in, then the lockup flies into the navbar's logo slot (#nearpool-brand).
 *
 * The app renders underneath the whole time, so this never delays loading.
 * Tap anywhere to skip; skipped entirely for prefers-reduced-motion.
 */

const IMPACT = 0.5; // seconds until the drop hits the surface
const HOLD_UNTIL = 1.75; // when the lockup starts docking into the navbar
const DOCK_DURATION = 0.5;

const DROP_PATH = "M12 0C12 0 2 12.5 2 19a10 10 0 0 0 20 0C22 12.5 12 0 12 0Z";

/** Splash particles thrown up on impact: [x offset, peak height, size]. */
const SPLASH: Array<[number, number, number]> = [
  [-34, -46, 5],
  [-20, -64, 4],
  [-8, -38, 3],
  [9, -56, 4],
  [22, -70, 5],
  [36, -42, 3],
];

const WORD = ["n", "e", "a", "r", "p", "o", "o", "l"];

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"play" | "dock" | "gone">("play");
  const [dock, setDock] = useState<{ x: number; y: number; scale: number } | null>(null);
  // Ripples and splash mount only at impact, so nothing shows on the surface before the drop lands.
  const [impact, setImpact] = useState(false);
  const lockupRef = useRef<HTMLDivElement>(null);
  const finished = useRef(false);

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    setPhase("gone");
    onDone();
  };

  useEffect(() => {
    const hit = window.setTimeout(() => setImpact(true), IMPACT * 1000);
    const timer = window.setTimeout(() => {
      // Fly the mark into the navbar logo, if it's on screen.
      const lockup = lockupRef.current?.querySelector("[data-mark]")?.getBoundingClientRect();
      const slot = document.getElementById("nearpool-brand")?.getBoundingClientRect();
      if (lockup && slot && slot.width > 0) {
        setDock({
          x: slot.left + slot.width / 2 - (lockup.left + lockup.width / 2),
          y: slot.top + slot.height / 2 - (lockup.top + lockup.height / 2),
          scale: slot.height / lockup.height,
        });
      }
      setPhase("dock");
    }, HOLD_UNTIL * 1000);
    const done = window.setTimeout(finish, (HOLD_UNTIL + DOCK_DURATION) * 1000);
    return () => {
      window.clearTimeout(hit);
      window.clearTimeout(timer);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AnimatePresence>
      {phase !== "gone" && (
        <motion.div
          key="splash"
          role="status"
          aria-label="Loading nearpool"
          onClick={finish}
          className="fixed inset-0 z-[100] flex cursor-pointer items-center justify-center overflow-hidden"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.2 } }}
        >
          {/* backdrop fades while the lockup docks */}
          <motion.div
            className="absolute inset-0 bg-canvas"
            animate={{ opacity: phase === "dock" ? 0 : 1 }}
            transition={{ duration: DOCK_DURATION, ease: [0.65, 0, 0.35, 1] }}
          />

          <div ref={lockupRef} className="relative flex flex-col items-center">
            {/* scene: drop, surface ripples, splash, mark */}
            <div className="relative h-[190px] w-[240px]">
              {/* falling drop */}
              <motion.svg
                viewBox="0 0 24 30"
                width={26}
                height={32}
                className="absolute left-1/2 -ml-[13px] text-accentfill"
                style={{ top: 0 }}
                initial={{ y: -260, scaleY: 1, opacity: 1 }}
                animate={{ y: [-260, 118, 124], scaleY: [1.25, 1.35, 0.4], opacity: [1, 1, 0] }}
                transition={{ duration: IMPACT + 0.06, times: [0, 0.88, 1], ease: ["easeIn", "easeOut"] }}
              >
                <path d={DROP_PATH} fill="currentColor" />
              </motion.svg>

              {/* ripples on the surface */}
              {impact && (
              <svg viewBox="0 0 240 60" className="absolute inset-x-0 bottom-0 h-[60px] w-full overflow-visible" aria-hidden>
                {[0, 0.14, 0.28].map((delay, i) => (
                  <motion.ellipse
                    key={i}
                    cx={120}
                    cy={30}
                    fill="none"
                    stroke="var(--accent-fill)"
                    strokeWidth={i === 0 ? 3 : 2}
                    initial={{ rx: 4, ry: 1, opacity: 0 }}
                    animate={{ rx: [4, 118 - i * 18], ry: [1, 24 - i * 4], opacity: [0.95, 0] }}
                    transition={{ delay, duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
                  />
                ))}
              </svg>
              )}

              {/* splash droplets */}
              {impact && SPLASH.map(([dx, peak, size], i) => (
                <motion.span
                  key={i}
                  className="absolute rounded-full bg-accentfill"
                  style={{ width: size, height: size, left: 120 - size / 2, bottom: 30 }}
                  initial={{ x: 0, y: 0, opacity: 0 }}
                  animate={{ x: [0, dx * 0.6, dx], y: [0, peak, 14], opacity: [1, 1, 0] }}
                  transition={{ duration: 0.62, times: [0, 0.45, 1], ease: ["easeOut", "easeIn"] }}
                />
              ))}

              {/* the mark rises out of the ripple */}
              <motion.div
                data-mark
                className="absolute left-1/2 -ml-[60px] text-ink"
                style={{ bottom: 18, width: 120, height: 120 }}
                initial={{ y: 40, scale: 0.55, opacity: 0, clipPath: "circle(0% at 50% 90%)" }}
                animate={
                  phase === "dock" && dock
                    ? { x: dock.x, y: dock.y, scale: dock.scale, opacity: 1, clipPath: "circle(75% at 50% 50%)" }
                    : { x: 0, y: 0, scale: 1, opacity: 1, clipPath: "circle(75% at 50% 50%)" }
                }
                transition={
                  phase === "dock"
                    ? { duration: DOCK_DURATION, ease: [0.65, 0, 0.35, 1] }
                    : { delay: IMPACT + 0.12, type: "spring", damping: 13, stiffness: 150 }
                }
              >
                <Logo size={120} />
              </motion.div>
            </div>

            {/* wordmark */}
            <motion.div
              className="mt-3 flex font-display text-[40px] leading-none font-semibold tracking-tight"
              animate={{ opacity: phase === "dock" ? 0 : 1, y: phase === "dock" ? -8 : 0 }}
              transition={{ duration: 0.25 }}
              aria-hidden
            >
              {WORD.map((letter, i) => (
                <span key={i} className="inline-block overflow-hidden pb-1">
                  <motion.span
                    className={`inline-block ${i >= 4 ? "text-accent" : "text-ink"}`}
                    initial={{ y: "110%" }}
                    animate={{ y: "0%" }}
                    transition={{ delay: IMPACT + 0.4 + i * 0.045, type: "spring", damping: 14, stiffness: 260 }}
                  >
                    {letter}
                  </motion.span>
                </span>
              ))}
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Show the splash on each full page load, unless the user prefers reduced motion. */
export function shouldShowSplash(): boolean {
  if (typeof window === "undefined") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
