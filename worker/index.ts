/**
 * Cloudflare Workers entry (Workers + static assets). `/api/*` and `/assets/*` reach
 * this code (see `run_worker_first` in wrangler.toml); everything else is
 * served straight from ./dist with single-page-application fallback.
 */
import { handleActivityRequest, type Env } from "./activity";
import { handleRpcProxy } from "./rpcProxy";
import { handleAssetRequest } from "./staticAssets";

interface WorkerEnv extends Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env): Promise<Response> {
    const asset = await handleAssetRequest(request, env.ASSETS);
    if (asset) return asset;
    return (await handleRpcProxy(request, env)) ?? (await handleActivityRequest(request, env)) ?? env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
