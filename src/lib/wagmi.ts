import { createConfig, http, injected } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { defineChain } from "viem";
import {
  ROBINHOOD_CHAIN_ID,
  ROBINHOOD_RPC_URL,
  EXPLORER_URL,
  WALLETCONNECT_PROJECT_ID,
  HAS_WALLETCONNECT,
  PONSPOOL_LOGO_URL,
} from "./constants";

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [ROBINHOOD_RPC_URL] } },
  blockExplorers: {
    default: { name: "Blockscout", url: EXPLORER_URL },
  },
});


/**
 * WalletConnect v2 — universal pairing: QR code on desktop, deep links and
 * in-app browsers on mobile. Only mounted when a live project id is present,
 * so an unconfigured deploy never initializes a doomed relay session.
 */
const walletConnectConnector = () =>
  walletConnect({
    projectId: WALLETCONNECT_PROJECT_ID,
    showQrModal: true,
    metadata: {
      name: "ponspool",
      description: "instant lp injection on robinhood chain",
      url: typeof window !== "undefined" ? window.location.origin : "https://ponspool.app",
      icons: [PONSPOOL_LOGO_URL],
    },
    qrModalOptions: {
      themeMode: "dark",
      themeVariables: {
        "--wcm-accent-color": "#059669",
        "--wcm-font-family": "Instrument Sans, system-ui, sans-serif",
      },
    },
  });

export const config = createConfig({
  chains: [robinhoodChain],
  connectors: [
    injected({ shimDisconnect: true }),
    ...(HAS_WALLETCONNECT ? [walletConnectConnector()] : []),
  ],
  transports: {
    [ROBINHOOD_CHAIN_ID]: http(ROBINHOOD_RPC_URL),
  },
  // Security: no persisted wallet state. Every visit requires explicit consent,
  // so a stale or injected session can never re-attach on its own.
  storage: null,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
