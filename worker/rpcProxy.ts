/**
 * Same-origin NEAR RPC proxy: `POST /api/rpc`.
 *
 * Lets the site use a keyed RPC provider (e.g. a Lava URL containing an API
 * key) without shipping the key to browsers. The key lives only in the
 * NEAR_RPC_URL secret; the browser talks to /api/rpc.
 *
 * Guard rails so the endpoint can't be used as a free relay:
 * - only standard NEAR JSON-RPC methods are forwarded;
 * - browser requests from other origins are rejected;
 * - bodies and batches are size-limited.
 */
import type { Env } from "./activity";

const DEFAULT_RPC = "https://rpc.mainnet.near.org";
const DEFAULT_FALLBACKS = "https://free.rpc.fastnear.com,https://near.lava.build,https://rpc.mainnet.fastnear.com";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_BATCH = 10;

/** Read methods plus transaction submission — everything a NEAR dapp and its wallets need. */
const ALLOWED_METHODS = new Set([
  "query",
  "block",
  "chunk",
  "tx",
  "EXPERIMENTAL_tx_status",
  "EXPERIMENTAL_receipt",
  "EXPERIMENTAL_protocol_config",
  "status",
  "gas_price",
  "validators",
  "send_tx",
  "broadcast_tx_async",
  "broadcast_tx_commit",
]);

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

function upstreams(env: Env): string[] {
  const fallbacks = (env.NEAR_FALLBACK_RPC_URLS ?? DEFAULT_FALLBACKS).split(",").map((u) => u.trim()).filter(Boolean);
  return [env.NEAR_RPC_URL || DEFAULT_RPC, ...fallbacks];
}

/** Returns a response for `/api/rpc`, or null for any other path. */
export async function handleRpcProxy(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/rpc") return null;
  if (request.method !== "POST") return json(405, { error: "method not allowed" });

  // Browsers always send Origin on cross-origin POSTs; refuse other sites.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== url.host) return json(403, { error: "cross-origin RPC is not allowed" });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json(413, { error: "request too large" });
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return json(413, { error: "request too large" });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json(400, { error: "invalid JSON" });
  }
  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0 || calls.length > MAX_BATCH) return json(400, { error: "invalid batch size" });
  for (const call of calls) {
    const method = (call as { method?: unknown } | null)?.method;
    if (typeof method !== "string" || !ALLOWED_METHODS.has(method)) {
      return json(400, { error: `RPC method not allowed: ${String(method)}` });
    }
  }

  // Fail over on network errors, rate limits and 5xx; a JSON-RPC error body is a real answer.
  let lastStatus = 502;
  for (const upstream of upstreams(env)) {
    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 429 || response.status >= 500) {
        lastStatus = response.status;
        continue;
      }
      return new Response(response.body, {
        status: response.status,
        headers: { "content-type": response.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
      });
    } catch {
      lastStatus = 502;
    }
  }
  return json(lastStatus === 429 ? 429 : 502, { error: "all NEAR RPC upstreams failed" });
}
