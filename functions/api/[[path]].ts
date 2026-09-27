/**
 * Cloudflare Pages Function for every `/api/*` route. Shares its logic with
 * the Workers entry in worker/index.ts. Bind a D1 database as `DB` in the
 * Pages project settings to enable the activity feed.
 */
import { handleActivityRequest, type Env } from "../../worker/activity";
import { handleRpcProxy } from "../../worker/rpcProxy";

export const onRequest: PagesFunction<Env> = async ({ request, env }) =>
  (await handleRpcProxy(request, env)) ?? (await handleActivityRequest(request, env)) ?? new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
