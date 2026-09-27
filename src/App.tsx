import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NearWalletProvider } from "./context/NearWalletContext";
import { EXPLORER_URL, NODE_URL, REF_FINANCE_CONTRACT_ID } from "./config/near";
import { ThemeProvider } from "./components/ThemeProvider";
import { ToastProvider } from "./components/Toasts";
import { SplashLoader } from "./components/SplashLoader";
import { Navbar } from "./components/Navbar";
import { IconExternal } from "./components/icons";
import { Logo } from "./components/Logo";
import { InfoPage, InjectPage, LandingPage, SwapPage } from "./pages";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 4_000, refetchOnWindowFocus: false },
  },
});

function Ambient() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0 opacity-60 dark:opacity-40"
        style={{
          backgroundImage: "radial-gradient(var(--grid-dot) 1px, transparent 1.4px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(120% 90% at 50% 0%, black 30%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(120% 90% at 50% 0%, black 30%, transparent 78%)",
        }}
      />
      {/* Soft NEAR-green and lilac light. Plain radial gradients (no blur filter)
          fade smoothly into --canvas in both themes without banding rings. */}
      <div
        className="drift-a absolute -top-[30%] -left-[20%] h-[90vh] w-[80vw]"
        style={{ background: "radial-gradient(closest-side, var(--glow-a), transparent)" }}
      />
      <div
        className="drift-b absolute top-[10%] -right-[25%] h-[80vh] w-[70vw]"
        style={{ background: "radial-gradient(closest-side, var(--glow-b), transparent)" }}
      />
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-linesoft pt-6 sm:mt-20">
      <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Logo size={22} className="text-ink" />
          <span className="font-display text-sm font-semibold text-ink">nearpool</span>
          <span className="font-mono text-[10px] text-faint">· deepening Ref pools, one batch at a time</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[10px] text-faint" aria-label="Footer navigation">
          <Link to="/" className="transition-colors hover:text-ink">home</Link>
          <Link to="/how-it-works" className="transition-colors hover:text-ink">how it works</Link>
          <Link to="/docs" className="transition-colors hover:text-ink">docs</Link>
          <Link to="/terms" className="transition-colors hover:text-ink">terms</Link>
          <Link to="/privacy-policy" className="transition-colors hover:text-ink">privacy policy</Link>
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-muted transition-colors hover:text-ink">
            explorer <IconExternal size={10} />
          </a>
        </nav>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[9.5px] text-faint">
        <span>near mainnet · {REF_FINANCE_CONTRACT_ID}</span>
        <span className="hidden sm:inline">rpc {NODE_URL.replace("https://", "")}</span>
        <span>no custody · no middlemen · no hidden fees</span>
      </div>
    </footer>
  );
}

/** Browser-tab name per route, so each page is identifiable in tabs and history. */
const PAGE_TITLES: Record<string, string> = {
  "/": "nearpool · Instant LP injection on NEAR",
  "/inject": "Inject liquidity · nearpool",
  "/swap": "Swap on Ref · nearpool",
  "/how-it-works": "How it works · nearpool",
  "/docs": "Docs · nearpool",
  "/terms": "Terms of use · nearpool",
  "/privacy-policy": "Privacy policy · nearpool",
};

function usePageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    document.title = PAGE_TITLES[pathname] ?? PAGE_TITLES["/"];
  }, [pathname]);
}

function Shell() {
  const [splashDone, setSplashDone] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const navigate = useNavigate();
  usePageTitle();

  return (
    <div className="relative min-h-screen text-ink">
      <Ambient />

      {!splashDone && <SplashLoader onReveal={() => setRevealed(true)} onDone={() => setSplashDone(true)} />}

      <div className={revealed ? "" : "opacity-0"}>
        <Navbar />

        <main className="relative z-10 mx-auto max-w-5xl px-4 pt-32 pb-16 sm:px-6 sm:pt-36">
          <Routes>
            <Route path="/" element={<LandingPage onInject={() => navigate("/inject")} onSwap={() => navigate("/swap")} />} />
            <Route path="/inject" element={<InjectPage onSwap={() => navigate("/swap")} />} />
            <Route path="/swap" element={<SwapPage onInject={() => navigate("/inject")} />} />
            {/* Legacy routes from the EVM build. */}
            <Route path="/launch-pool" element={<Navigate to="/inject" replace />} />
            <Route path="/buy" element={<Navigate to="/swap" replace />} />
            <Route path="/how-it-works" element={<InfoPage kind="how-it-works" />} />
            <Route path="/docs" element={<InfoPage kind="docs" />} />
            <Route path="/terms" element={<InfoPage kind="terms" />} />
            <Route path="/privacy-policy" element={<InfoPage kind="privacy" />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>

          <Footer />
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <NearWalletProvider>
          <ThemeProvider>
            <ToastProvider>
              <Shell />
            </ToastProvider>
          </ThemeProvider>
        </NearWalletProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
