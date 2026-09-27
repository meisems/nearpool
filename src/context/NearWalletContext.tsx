import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AccountState,
  FinalExecutionOutcome,
  Transaction,
  Wallet,
  WalletModuleFactory,
  WalletSelector,
} from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { EXPLORER_URL, FALLBACK_RPC_URLS, NETWORK_ID, NODE_URL, WALLETCONNECT_PROJECT_ID } from "../config/near";
import { viewMethod as rpcViewMethod, type ViewArgs } from "../lib/near";

export type WalletStatus = "initializing" | "ready" | "error";

export interface NearWalletContextValue {
  selector: WalletSelector | null;
  modal: WalletSelectorModal | null;
  accounts: AccountState[];
  /** Active NEAR account, or null when signed out. */
  accountId: string | null;
  /** Connected wallet interface, or null when signed out. */
  wallet: Wallet | null;
  status: WalletStatus;
  error: string | null;
  /** Open the wallet selection modal. */
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

interface SelectorBundle {
  selector: WalletSelector;
  modal: WalletSelectorModal;
}

let selectorPromise: Promise<SelectorBundle> | null = null;

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

function getSelector(): Promise<SelectorBundle> {
  if (!selectorPromise) {
    selectorPromise = (async () => {
      const [
        { setupWalletSelector },
        { setupModal },
        { setupHotWallet },
        { setupMeteorWallet },
        { setupMyNearWallet },
        { setupIntearWallet },
        { setupHereWallet },
        { setupOKXWallet },
        { setupSender },
        { setupNightly },
      ] = await Promise.all([
        import("@near-wallet-selector/core"),
        import("@near-wallet-selector/modal-ui"),
        import("@near-wallet-selector/hot-wallet"),
        import("@near-wallet-selector/meteor-wallet"),
        import("@near-wallet-selector/my-near-wallet"),
        import("@near-wallet-selector/intear-wallet"),
        import("@near-wallet-selector/here-wallet"),
        import("@near-wallet-selector/okx-wallet"),
        import("@near-wallet-selector/sender"),
        import("@near-wallet-selector/nightly"),
      ]);
      // Covers desktop (extensions + web wallets) and mobile (web wallets that
      // work in any mobile browser, Telegram/app wallets via deep link, and
      // in-app browsers). WalletConnect is added when a project ID is set.
      const walletConnect = WALLETCONNECT_PROJECT_ID
        ? (await import("@near-wallet-selector/wallet-connect")).setupWalletConnect({
            projectId: WALLETCONNECT_PROJECT_ID,
            metadata: {
              name: "nearpool",
              description: "Add liquidity to any NEAR token",
              url: window.location.origin,
              icons: [`${window.location.origin}/logo-mark-512.png`],
            },
          })
        : null;
      const selector = await setupWalletSelector({
        network: {
          networkId: NETWORK_ID,
          nodeUrl: NODE_URL,
          helperUrl: "https://helper.mainnet.near.org",
          explorerUrl: EXPLORER_URL,
          indexerUrl: "https://api.kitwallet.app",
        },
        fallbackRpcUrls: FALLBACK_RPC_URLS,
        modules: [
          withIcon(setupHotWallet(), "/wallets/hot.png"),
          setupMeteorWallet(),
          setupMyNearWallet(),
          setupIntearWallet(),
          setupHereWallet(),
          setupOKXWallet(),
          setupSender(),
          setupNightly(),
          ...(walletConnect ? [walletConnect] : []),
        ],
      });
      const modal = setupModal(selector, {
        theme: "auto",
        description: "Connect a NEAR wallet to inject liquidity on Ref Finance.",
      });
      return { selector, modal };
    })();
    selectorPromise.catch(() => {
      selectorPromise = null;
    });
  }
  return selectorPromise;
}

export function NearWalletProvider({ children }: { children: ReactNode }) {
  const [selector, setSelector] = useState<WalletSelector | null>(null);
  const [modal, setModal] = useState<WalletSelectorModal | null>(null);
  const [accounts, setAccounts] = useState<AccountState[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [status, setStatus] = useState<WalletStatus>("initializing");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | undefined;
    getSelector()
      .then(({ selector: instance, modal: walletModal }) => {
        if (!alive) return;
        const initial = instance.store.getState();
        setSelector(instance);
        setModal(walletModal);
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
        console.error("wallet selector failed to initialize", e);
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      });
    return () => {
      alive = false;
      unsubscribe?.();
    };
  }, []);

  // Signed in or out in another browser tab: wallet-selector and its modal are
  // page-wide singletons that read the session only at startup, so this tab
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
      .catch((e: unknown) => {
        console.error("could not load wallet", e);
        if (alive) setWallet(null);
      });
    return () => {
      alive = false;
    };
  }, [selector, selectedWalletId, accounts.length]);

  const accountId = accounts.find((account) => account.active)?.accountId ?? null;

  const signIn = useCallback(() => {
    if (modal) modal.show();
  }, [modal]);

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
    () => ({ selector, modal, accounts, accountId, wallet, status, error, signIn, signOut, viewMethod, signAndSendTransactions }),
    [selector, modal, accounts, accountId, wallet, status, error, signIn, signOut, viewMethod, signAndSendTransactions],
  );

  return <NearWalletContext.Provider value={value}>{children}</NearWalletContext.Provider>;
}

export function useNearWallet(): NearWalletContextValue {
  const ctx = useContext(NearWalletContext);
  if (!ctx) throw new Error("useNearWallet must be used inside <NearWalletProvider>");
  return ctx;
}
