import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AccountState,
  FinalExecutionOutcome,
  Transaction,
  Wallet,
  WalletModuleFactory,
  WalletSelector,
} from "@near-wallet-selector/core";
import { EXPLORER_URL, FALLBACK_RPC_URLS, NETWORK_ID, NODE_URL, WALLETCONNECT_PROJECT_ID } from "../config/near";
import { viewMethod as rpcViewMethod, type ViewArgs } from "../lib/near";
import { WalletPicker } from "../components/WalletPicker";

export type WalletStatus = "initializing" | "ready" | "error";

export interface NearWalletContextValue {
  selector: WalletSelector | null;
  accounts: AccountState[];
  /** Active NEAR account, or null when signed out. */
  accountId: string | null;
  /** Connected wallet interface, or null when signed out. */
  wallet: Wallet | null;
  status: WalletStatus;
  error: string | null;
  /** Open the wallet picker (detected extensions first). */
  signIn: () => void;
  /** Disconnect the active wallet session. */
  signOut: () => Promise<void>;
  /** Read-only contract call over RPC (no wallet required). */
  viewMethod: <T>(contractId: string, methodName: string, args?: ViewArgs) => Promise<T>;
  /**
   * Sign and broadcast a batch of transactions in order. Wallets execute
   * them sequentially and resolve once every transaction has a final
   * outcome. Browser-redirect wallets resolve with an empty array.
   */
  signAndSendTransactions: (transactions: Array<Omit<Transaction, "signerId"> & { signerId?: string }>) => Promise<FinalExecutionOutcome[]>;
}

const NearWalletContext = createContext<NearWalletContextValue | null>(null);

let selectorPromise: Promise<WalletSelector> | null = null;

/**
 * One selector per page — wallet modules keep global listeners. The wallet
 * SDKs are large, so they're code-split and loaded after first paint.
 */
/** Swap a module's remote icon for a bundled copy (HOT's CDN icon doesn't always load). */
function withIcon<T extends WalletModuleFactory>(factory: T, iconUrl: string): T {
  return (async (options: Parameters<T>[0]) => {
    const module = await factory(options);
    return module && { ...module, metadata: { ...module.metadata, iconUrl } };
  }) as T;
}

function getSelector(): Promise<WalletSelector> {
  if (!selectorPromise) {
    selectorPromise = (async () => {
      const { setupWalletSelector } = await import("@near-wallet-selector/core");
      // The app uses WalletPicker, so the unused SDK modal must not block it.
      // A failed optional adapter should not disable wallets that did load.
      const loaded = await Promise.allSettled([
        import("@near-wallet-selector/hot-wallet").then(({ setupHotWallet }) => withIcon(setupHotWallet(), "/wallets/hot.png")),
        import("@near-wallet-selector/meteor-wallet").then(({ setupMeteorWallet }) => setupMeteorWallet()),
        import("@near-wallet-selector/my-near-wallet").then(({ setupMyNearWallet }) => setupMyNearWallet()),
        import("@near-wallet-selector/intear-wallet").then(({ setupIntearWallet }) => setupIntearWallet()),
        import("@near-wallet-selector/here-wallet").then(({ setupHereWallet }) => setupHereWallet()),
        import("@near-wallet-selector/okx-wallet").then(({ setupOKXWallet }) => setupOKXWallet()),
        import("@near-wallet-selector/sender").then(({ setupSender }) => setupSender()),
        import("@near-wallet-selector/nightly").then(({ setupNightly }) => setupNightly()),
        import("@near-wallet-selector/coin98-wallet").then(({ setupCoin98Wallet }) => setupCoin98Wallet()),
        import("@near-wallet-selector/math-wallet").then(({ setupMathWallet }) => setupMathWallet()),
        import("@near-wallet-selector/bitget-wallet").then(({ setupBitgetWallet }) => setupBitgetWallet()),
        import("@near-wallet-selector/welldone-wallet").then(({ setupWelldoneWallet }) => setupWelldoneWallet()),
        import("@near-wallet-selector/xdefi").then(({ setupXDEFI }) => setupXDEFI()),
        import("@near-wallet-selector/narwallets").then(({ setupNarwallets }) => setupNarwallets()),
        ...(WALLETCONNECT_PROJECT_ID ? [import("@near-wallet-selector/wallet-connect").then(({ setupWalletConnect }) => setupWalletConnect({
          projectId: WALLETCONNECT_PROJECT_ID,
          metadata: {
            name: "nearpool",
            description: "Add liquidity to any NEAR token",
            url: window.location.origin,
            icons: [`${window.location.origin}/logo-mark-512.png`],
          },
        }))] : []),
      ]);
      const modules: WalletModuleFactory[] = [];
      for (const result of loaded) {
        if (result.status === "fulfilled") modules.push(result.value);
      }
      if (!modules.length) throw new Error("Wallets could not load. Please retry the connection.");
      return setupWalletSelector({
        network: {
          networkId: NETWORK_ID,
          nodeUrl: NODE_URL,
          helperUrl: "https://helper.mainnet.near.org",
          explorerUrl: EXPLORER_URL,
          indexerUrl: "https://api.kitwallet.app",
        },
        fallbackRpcUrls: FALLBACK_RPC_URLS,
        modules,
      });
    })();
    selectorPromise.catch(() => {
      selectorPromise = null;
    });
  }
  return selectorPromise;
}

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [accounts, setAccounts] = useState<AccountState[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [status, setStatus] = useState<WalletStatus>("initializing");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    getSelector()
      .then((instance) => {
        if (!alive) return;
        const initial = instance.store.getState();
        setSelector(instance);
        setAccounts(initial.accounts);
        setSelectedWalletId(initial.selectedWalletId);
        const subscription = instance.store.observable.subscribe((state) => {
          setAccounts(state.accounts);
          setSelectedWalletId(state.selectedWalletId);
        });
        unsubscribe = () => subscription.unsubscribe();
        setStatus("ready");
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  // Signed in or out in another browser tab: wallet-selector is a
  // page-wide singleton that reads the session only at startup, so this tab
  // reloads itself to pick up the change (right away if it's in the
  // background, where nobody sees it).
  useEffect(() => {
    if (!selector) return;
    const KEY = "near-wallet-selector:selectedWalletId";
    const stored = (): string | null => {
      try {
        return JSON.parse(localStorage.getItem(KEY) ?? "null") as string | null;
      } catch {
        return null;
      }
    };
    let pending = false;
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== KEY) return;
      if (stored() === selector.store.getState().selectedWalletId) return;
      if (document.visibilityState === "hidden") window.location.reload();
      else pending = true;
    };
    const onVisible = () => {
      if (pending && document.visibilityState === "visible") window.location.reload();
    };
    window.addEventListener("storage", onStorage);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [selector]);

  // Resolve the wallet interface whenever the selected wallet changes.
  useEffect(() => {
    if (!selector || !selectedWalletId || accounts.length === 0) {
      setWallet(null);
      return;
    }
    let alive = true;
    selector
      .wallet(selectedWalletId)
      .then((instance) => alive && setWallet(instance))
      .catch(() => {
        if (alive) setWallet(null);
      });
    return () => {
      alive = false;
    };
  }, [selector, selectedWalletId, accounts.length]);

  const accountId = accounts.find((account) => account.active)?.accountId ?? null;

  const signIn = useCallback(() => {
    if (selector) setPickerOpen(true);
    // Failed module imports are cached by the browser's module loader; a fresh
    // document lets a repaired deployment or network connection try them again.
    else if (status === "error") window.location.reload();
  }, [selector, status]);

  const closePicker = useCallback(() => setPickerOpen(false), []);

  // Close the picker once a wallet connects (some wallets finish in a popup or another app).
  useEffect(() => {
    if (accountId) setPickerOpen(false);
  }, [accountId]);

  const signOut = useCallback(async () => {
    if (!selector) return;
    const active = await selector.wallet();
    await active.signOut();
  }, [selector]);

  const signAndSendTransactions = useCallback<NearWalletContextValue["signAndSendTransactions"]>(
    async (transactions) => {
      if (!selector) throw new Error("wallet selector is still loading");
      if (!accountId) throw new Error("connect a wallet first");
      const active = await selector.wallet();
      const outcomes = await active.signAndSendTransactions({
        transactions: transactions.map((tx) => ({ ...tx, signerId: tx.signerId ?? accountId })),
      });
      return outcomes ?? [];
    },
    [selector, accountId],
  );

  const viewMethod = useCallback(<T,>(contractId: string, methodName: string, args: ViewArgs = {}) => rpcViewMethod<T>(contractId, methodName, args), []);

  const value = useMemo<NearWalletContextValue>(
    () => ({ selector, accounts, accountId, wallet, status, error, signIn, signOut, viewMethod, signAndSendTransactions }),
    [selector, accounts, accountId, wallet, status, error, signIn, signOut, viewMethod, signAndSendTransactions],
  );

  return (
    <NearWalletContext.Provider value={value}>
      {children}
      <WalletPicker selector={selector} open={pickerOpen} onClose={closePicker} />
    </NearWalletContext.Provider>
  );
}

export function useNearWallet(): NearWalletContextValue {
  const ctx = useContext(NearWalletContext);
  if (!ctx) throw new Error("useNearWallet must be used inside <NearWalletProvider>");
  return ctx;
}
