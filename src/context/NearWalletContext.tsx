import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type {
  AccountState,
  FinalExecutionOutcome,
  Transaction,
  Wallet,
  WalletSelector,
} from "@near-wallet-selector/core";
import type { WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { EXPLORER_URL, FALLBACK_RPC_URLS, NETWORK_ID, NODE_URL } from "../config/near";
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
function getSelector(): Promise<SelectorBundle> {
  if (!selectorPromise) {
    selectorPromise = (async () => {
      const [{ setupWalletSelector }, { setupModal }, { setupMeteorWallet }, { setupHereWallet }, { setupNightly }, { setupSender }] =
        await Promise.all([
          import("@near-wallet-selector/core"),
          import("@near-wallet-selector/modal-ui"),
          import("@near-wallet-selector/meteor-wallet"),
          import("@near-wallet-selector/here-wallet"),
          import("@near-wallet-selector/nightly"),
          import("@near-wallet-selector/sender"),
        ]);
      const selector = await setupWalletSelector({
        network: {
          networkId: NETWORK_ID,
          nodeUrl: NODE_URL,
          helperUrl: "https://helper.mainnet.near.org",
          explorerUrl: EXPLORER_URL,
          indexerUrl: "https://api.kitwallet.app",
        },
        fallbackRpcUrls: FALLBACK_RPC_URLS,
        modules: [setupMeteorWallet(), setupHereWallet(), setupNightly(), setupSender()],
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
