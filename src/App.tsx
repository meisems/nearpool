import { useEffect, useState } from "react";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NearWalletProvider } from "./context/NearWalletContext";
import { EXPLORER_URL } from "./config/near";
import { ThemeProvider } from "./components/ThemeProvider";
import { ToastProvider } from "./components/Toasts";
import { Navbar } from "./components/Navbar";
import { RouteErrorBoundary } from "./components/RouteErrorBoundary";
import { shouldShowSplash, SplashScreen } from "./components/SplashScreen";
import { Logo } from "./components/Logo";
import { HomePage, InfoPage, PoolRedirect, SwapPage, TokenPage, TrackPage } from "./pages";

const queryClient = new QueryClient({
  defaultOptions: {
    // Refetch when the browser tab regains focus so balances and pools are
    // current without a manual refresh.
    queries: { retry: 1, staleTime: 4_000, refetchOnWindowFocus: true },
  },
});

function Footer() {
  return (
    <footer className="mt-16 border-t border-linesoft py-6">
      <div className="flex flex-wrap items-center justify-between gap-4 text-sm text-faint">
        <span className="flex items-center gap-2 text-muted">
          <Logo size={20} />
          nearpool
        </span>
        <nav className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Footer">
          <Link to="/docs" className="hover:text-ink">Docs</Link>
          <Link to="/terms" className="hover:text-ink">Terms</Link>
          <Link to="/privacy-policy" className="hover:text-ink">Privacy</Link>
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer" className="hover:text-ink">Explorer</a>
        </nav>
      </div>
    </footer>
  );
}

/** Browser-tab name per route. Token pages set their own (`SYMBOL · nearpool`). */
const PAGE_TITLES: Record<string, string> = {
  "/": "nearpool · Add liquidity to any NEAR token",
  "/track": "Tracked · nearpool",
  "/swap": "Swap · nearpool",
  "/docs": "Docs · nearpool",
  "/terms": "Terms · nearpool",
  "/privacy-policy": "Privacy · nearpool",
};

function usePageTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname.startsWith("/t/")) return;
    document.title = PAGE_TITLES[pathname] ?? PAGE_TITLES["/"];
  }, [pathname]);
}

function ScrollToTop() {
  const { pathname } = useLocation();
  // Braces matter: newer Chrome returns a Promise from scrollTo, and React
  // would call that as the effect's cleanup on the next navigation and crash.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Shell() {
  usePageTitle();
  const { pathname } = useLocation();
  const [splash, setSplash] = useState(shouldShowSplash);
  return (
    <div className="min-h-screen bg-canvas text-ink">
      {splash && <SplashScreen onDone={() => setSplash(false)} />}
      <ScrollToTop />
      <Navbar />
      <main className="mx-auto max-w-6xl px-4 pt-6 pb-24 sm:px-6 sm:pt-10 md:pb-10">
        <RouteErrorBoundary key={pathname}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/t/:tokenId" element={<TokenPage />} />
          <Route path="/pool/:poolId" element={<PoolRedirect />} />
          <Route path="/track" element={<TrackPage />} />
          <Route path="/swap" element={<SwapPage />} />
          <Route path="/docs" element={<InfoPage kind="docs" />} />
          <Route path="/terms" element={<InfoPage kind="terms" />} />
          <Route path="/privacy-policy" element={<InfoPage kind="privacy" />} />
          {/* Older routes. */}
          <Route path="/inject" element={<Navigate to="/" replace />} />
          <Route path="/launch-pool" element={<Navigate to="/" replace />} />
          <Route path="/buy" element={<Navigate to="/swap" replace />} />
          <Route path="/how-it-works" element={<Navigate to="/docs" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </RouteErrorBoundary>
        <Footer />
      </main>
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
              {/* Last line of defense: a crash outside a page shows a retry card, not a blank screen. */}
              <RouteErrorBoundary>
                <Shell />
              </RouteErrorBoundary>
            </ToastProvider>
          </ThemeProvider>
        </NearWalletProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}
