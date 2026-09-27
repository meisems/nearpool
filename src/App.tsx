import { useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { config } from "./lib/wagmi";
import { EXPLORER_URL, ROBINHOOD_CHAIN_ID, ROBINHOOD_RPC_URL } from "./lib/constants";
import { ThemeProvider } from "./components/ThemeProvider";
import { ToastProvider } from "./components/Toasts";
import { SplashLoader } from "./components/SplashLoader";
import { Navbar } from "./components/Navbar";
import { IconExternal } from "./components/icons";
import { Logo } from "./components/Logo";
import { BuyPage, InfoPage, LandingPage, LaunchPoolPage } from "./pages";

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
      <div className="drift-a absolute -top-32 left-[8%] h-[420px] w-[420px] rounded-full blur-[110px]" style={{ background: "var(--glow-a)" }} />
      <div className="drift-b absolute top-[30%] -right-24 h-[380px] w-[380px] rounded-full blur-[110px]" style={{ background: "var(--glow-b)" }} />
      <div className="drift-a absolute bottom-[-10%] left-[30%] h-[300px] w-[300px] rounded-full blur-[100px]" style={{ background: "var(--glow-a)" }} />
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-linesoft pt-6 sm:mt-20">
      <div className="flex flex-col items-start justify-between gap-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <Logo size={20} />
          <span className="font-display text-sm font-semibold text-ink">ponspool</span>
          <span className="font-mono text-[10px] text-faint">· thickening the pond since block 1</span>
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
        <span>chain {ROBINHOOD_CHAIN_ID}</span>
        <span className="hidden sm:inline">rpc {ROBINHOOD_RPC_URL.replace("https://", "")}</span>
        <span>no custody · no middlemen · no hidden fees</span>
      </div>
    </footer>
  );
}

function Shell() {
  const [splashDone, setSplashDone] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="relative min-h-screen text-ink">
      <Ambient />

      {!splashDone && <SplashLoader onReveal={() => setRevealed(true)} onDone={() => setSplashDone(true)} />}

      <div className={revealed ? "" : "opacity-0"}>
        <Navbar connectOpen={connectOpen} setConnectOpen={setConnectOpen} />

        <main className="relative z-10 mx-auto max-w-5xl px-4 pt-32 pb-16 sm:px-6 sm:pt-36">
          <Routes>
            <Route path="/" element={<LandingPage onLaunch={() => navigate("/launch-pool")} onBuy={() => navigate("/buy")} />} />
            <Route path="/launch-pool" element={<LaunchPoolPage onBuy={() => navigate("/buy")} onConnect={() => setConnectOpen(true)} />} />
            <Route path="/buy" element={<BuyPage onConnect={() => setConnectOpen(true)} />} />
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
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ToastProvider>
              <Shell />
            </ToastProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </WagmiProvider>
    </BrowserRouter>
  );
}
