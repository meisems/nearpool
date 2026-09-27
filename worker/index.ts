/**
 * Cloudflare Workers entry (Workers + static assets). Only `/api/*` reaches
 * this code (see `run_worker_first` in wrangler.toml); everything else is
 * served straight from ./dist with single-page-application fallback.
 */
import { handleActivityRequest, type Env } from "./activity";

interface WorkerEnv extends Env {
  ASSETS: Fetcher;
}

export default {
  async fetch(request, env): Promise<Response> {
    return (await handleActivityRequest(request, env)) ?? env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WorkerEnv>;
