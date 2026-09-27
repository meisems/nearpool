/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Primary NEAR RPC endpoint (default https://rpc.mainnet.near.org). */
  readonly VITE_NEAR_RPC_URL?: string;
  /** Comma-separated fallback RPC endpoints, tried in order. */
  readonly VITE_NEAR_FALLBACK_RPC_URLS?: string;
  readonly VITE_REF_CONTRACT_ID?: string;
  readonly VITE_WRAP_NEAR_CONTRACT_ID?: string;
  readonly VITE_EXPLORER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.png" {
  const src: string;
  export default src;
}
