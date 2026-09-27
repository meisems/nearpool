import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";

type Theme = "dark" | "light";

/** Browser chrome colour per theme — matches --canvas in index.css. */
const THEME_COLOR: Record<Theme, string> = { dark: "#000000", light: "#f2f1ea" };
const STORAGE_KEY = "nearpool.theme";

interface ThemeCtxValue {
  theme: Theme;
  /** Switch themes; pass the click point to reveal the new theme from it. */
  toggle: (origin?: { x: number; y: number }) => void;
}

const ThemeCtx = createContext<ThemeCtxValue>({ theme: "dark", toggle: () => {} });

function readStoredTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[theme]);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* storage unavailable — the choice just won't persist */
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() => (typeof window === "undefined" ? "dark" : readStoredTheme()));

  useEffect(() => applyTheme(theme), [theme]);

  const toggle: ThemeCtxValue["toggle"] = (origin) => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const root = document.documentElement;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

    if (doc.startViewTransition && !reduced) {
      const x = origin?.x ?? window.innerWidth / 2;
      const y = origin?.y ?? 0;
      // Radius that reaches the farthest viewport corner from the origin.
      const r = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      root.style.setProperty("--theme-x", `${x}px`);
      root.style.setProperty("--theme-y", `${y}px`);
      root.style.setProperty("--theme-r", `${r}px`);
      // The DOM must be fully in the new theme when the "new" snapshot is taken.
      doc.startViewTransition(() => {
        flushSync(() => setTheme(next));
        applyTheme(next);
      });
      return;
    }

    if (!reduced) {
      root.classList.add("theme-switching");
      window.setTimeout(() => root.classList.remove("theme-switching"), 400);
    }
    setTheme(next);
  };

  return <ThemeCtx.Provider value={{ theme, toggle }}>{children}</ThemeCtx.Provider>;
}

export const useTheme = () => useContext(ThemeCtx);
