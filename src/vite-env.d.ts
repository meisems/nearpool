/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Primary NEAR RPC endpoint (default https://rpc.mainnet.near.org). */
  readonly VITE_NEAR_RPC_URL?: string;
  /** Comma-separated fallback RPC endpoints, tried in order. */
  readonly VITE_NEAR_FALLBACK_RPC_URLS?: string;
  readonly VITE_REF_CONTRACT_ID?: string;
  readonly VITE_WRAP_NEAR_CONTRACT_ID?: string;
  readonly VITE_EXPLORER_URL?: string;
  /** NEAR account that receives the interface fee (default ambereui.tg). */
  readonly VITE_FEE_RECEIVER?: string;
  /** Fee per injection or swap in NEAR, e.g. "0.1". "0" disables it. */
  readonly VITE_FEE_NEAR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.png" {
  const src: string;
  export default src;
}
