import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@libsql/client";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "dist");
const indexPath = join(dist, "index.html");
const port = Number(process.env.PORT || 10000);
const host = process.env.HOST || "0.0.0.0";
const MAX_BODY_BYTES = 16_384;

const REF_CONTRACT_ID = process.env.VITE_REF_CONTRACT_ID || "v2.ref-finance.near";
const LP_LOCK_ACCOUNT_ID = "0".repeat(64);
const RPC_URLS = [
  process.env.NEAR_RPC_URL || process.env.VITE_NEAR_RPC_URL || "https://rpc.mainnet.near.org",
  ...(process.env.NEAR_FALLBACK_RPC_URLS || process.env.VITE_NEAR_FALLBACK_RPC_URLS || "https://free.rpc.fastnear.com,https://rpc.mainnet.fastnear.com,https://archival-rpc.mainnet.near.org,https://rpc.intea.rs")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean),
];

/* ------------------------------------------------------------ NEAR RPC */

async function rpcCall(method, params) {
  let lastError;
  for (const url of RPC_URLS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "nearpool", method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const raw = await response.text();
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error(`RPC ${new URL(url).host} responded ${response.status} with a non-JSON body`);
      }
      if (payload.error) {
        const message = payload.error.cause?.name || payload.error.data || payload.error.message || "RPC error";
        // Deterministic errors (unknown tx, bad args) won't improve on another node.
        if (payload.error.name === "HANDLER_ERROR" || payload.error.name === "REQUEST_VALIDATION_ERROR") {
          throw Object.assign(new Error(typeof message === "string" ? message : JSON.stringify(message)), { final: true });
        }
        throw new Error(typeof message === "string" ? message : JSON.stringify(message));
      }
      if (!response.ok) throw new Error(`RPC responded ${response.status}`);
      return payload.result;
    } catch (error) {
      lastError = error;
      if (error?.final) break;
    }
  }
  throw lastError;
}

async function viewCall(accountId, methodName, args = {}) {
  const result = await rpcCall("query", {
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  const text = Buffer.from(result.result).toString("utf8");
  return text ? JSON.parse(text) : null;
}

const metadataCache = new Map();
async function ftMetadata(tokenId) {
  if (!metadataCache.has(tokenId)) {
    const promise = viewCall(tokenId, "ft_metadata").catch((error) => {
      metadataCache.delete(tokenId);
      throw error;
    });
    metadataCache.set(tokenId, promise);
  }
  return metadataCache.get(tokenId);
}

const BASE58_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const isAccountId = (value) => typeof value === "string" && value.length >= 2 && value.length <= 64 && ACCOUNT_ID.test(value);

function statusFailed(status) {
  return !status || typeof status !== "object" || "Failure" in status;
}

/**
 * Re-derive an activity post from chain data: the transaction must be a
 * fully successful addition or permanent LP transfer on Ref Finance signed by `accountId`.
 * Nothing displayed in the feed comes from the client.
 */
async function verifyActivity(hash, accountId) {
  const outcome = await rpcCall("tx", { tx_hash: hash, sender_account_id: accountId, wait_until: "FINAL" });
  const tx = outcome?.transaction;
  if (!tx || tx.signer_id !== accountId || tx.receiver_id !== REF_CONTRACT_ID) {
    throw Object.assign(new Error("not a Ref Finance transaction signed by this account"), { status: 400 });
  }
  if (statusFailed(outcome.status) || outcome.receipts_outcome.some((r) => statusFailed(r.outcome?.status))) {
    throw Object.assign(new Error("transaction did not fully succeed"), { status: 400 });
  }
  const call = [...(tx.actions || [])]
    .reverse()
    .map((action) => action?.FunctionCall)
    .find((call) => call?.method_name === "add_liquidity" || call?.method_name === "mft_transfer");
  if (!call) throw Object.assign(new Error("transaction has no liquidity addition or lock call"), { status: 400 });
  const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
  const kind = call.method_name === "mft_transfer" ? "lock" : "injection";
  if (kind === "lock" && (
    args.receiver_id !== LP_LOCK_ACCOUNT_ID ||
    typeof args.token_id !== "string" || !/^:\d+$/.test(args.token_id) ||
    typeof args.amount !== "string" || !/^\d+$/.test(args.amount) || BigInt(args.amount) <= 0n
  )) throw Object.assign(new Error("not a permanent LP share lock"), { status: 400 });
  const poolId = Number(kind === "lock" ? args.token_id.slice(1) : args.pool_id);
  if (!Number.isSafeInteger(poolId) || poolId < 0) throw Object.assign(new Error("invalid pool id"), { status: 400 });

  const pool = await viewCall(REF_CONTRACT_ID, "get_pool", { pool_id: poolId });
  if (!pool) throw Object.assign(new Error("pool not found"), { status: 400 });
  const tokenIds = pool.token_account_ids;
  let amounts = kind === "lock" ? [] : (args.amounts || []).map(String);
  let shares = kind === "lock" ? args.amount : "0";

  // Ref logs `Liquidity added ["<amount> <token>", ...], minted <shares> shares` with the
  // amounts it actually pulled; prefer those over the requested amounts.
  for (const receipt of outcome.receipts_outcome) {
    if (kind === "lock") break;
    if (receipt.outcome.executor_id !== REF_CONTRACT_ID) continue;
    for (const log of receipt.outcome.logs) {
      const match = /^Liquidity added \[(.*)\], minted (\d+) shares/.exec(log);
      if (!match) continue;
      const added = [...match[1].matchAll(/"(\d+) ([^"]+)"/g)];
      const byToken = new Map(added.map((m) => [m[2], m[1]]));
      if (tokenIds.every((id) => byToken.has(id))) amounts = tokenIds.map((id) => byToken.get(id));
      shares = match[2];
    }
  }
  if (kind === "injection" && shares === "0" && outcome.status.SuccessValue) {
    try {
      const value = JSON.parse(Buffer.from(outcome.status.SuccessValue, "base64").toString("utf8"));
      if (/^\d+$/.test(String(value))) shares = String(value);
    } catch {
      /* keep 0 */
    }
  }

  const metas = await Promise.all(tokenIds.map((id) => ftMetadata(id).catch(() => null)));
  const block = await rpcCall("block", { block_id: outcome.transaction_outcome.block_hash });
  return {
    kind,
    hash,
    accountId,
    poolId,
    tokenIds,
    symbols: tokenIds.map((id, i) => (id === "wrap.near" ? "NEAR" : metas[i]?.symbol || id.split(".")[0].slice(0, 8))),
    decimals: tokenIds.map((_, i) => (typeof metas[i]?.decimals === "number" ? metas[i].decimals : 24)),
    amounts,
    shares,
    blockHeight: Number(block.header.height),
    timestamp: Math.floor(Number(BigInt(block.header.timestamp_nanosec) / 1_000_000n)),
  };
}

/* ------------------------------------------------------------ activity store */

// In-memory fallback resets on every restart (e.g. Render free-tier spin
// down). Set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) for durable storage.
const activityMemory = new Map();

const tursoUrl = process.env.TURSO_DATABASE_URL || "";
const tursoToken = process.env.TURSO_AUTH_TOKEN || "";
const turso = tursoUrl ? createClient({ url: tursoUrl, authToken: tursoToken || undefined }) : null;
if (!turso) {
  console.warn("TURSO_DATABASE_URL not set — the shared activity feed uses an in-memory store that resets on restart.");
} else {
  await turso.execute(`create table if not exists nearpool_activity (
    hash text primary key,
    account_id text not null,
    pool_id integer not null,
    token_ids text not null,
    symbols text not null,
    decimals text not null,
    amounts text not null,
    shares text not null,
    block_height integer not null,
    timestamp integer not null
  )`);
  // Upgrade existing Turso databases without losing previously published additions.
  const columns = await turso.execute("pragma table_info(nearpool_activity)");
  if (!columns.rows.some((column) => column.name === "kind")) {
    await turso.execute("alter table nearpool_activity add column kind text not null default 'injection'");
  }
}

async function upsertActivity(post) {
  if (!turso) {
    activityMemory.set(post.hash, post);
    while (activityMemory.size > 100) activityMemory.delete(activityMemory.keys().next().value);
    return;
  }
  await turso.execute({
    sql: `insert into nearpool_activity (hash, account_id, pool_id, token_ids, symbols, decimals, amounts, shares, block_height, timestamp, kind)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(hash) do nothing`,
    args: [
      post.hash,
      post.accountId,
      post.poolId,
      JSON.stringify(post.tokenIds),
      JSON.stringify(post.symbols),
      JSON.stringify(post.decimals),
      JSON.stringify(post.amounts),
      post.shares,
      post.blockHeight,
      post.timestamp,
      post.kind,
    ],
  });
}

async function listActivity(limit = 100) {
  if (!turso) return [...activityMemory.values()].sort((a, b) => b.blockHeight - a.blockHeight).slice(0, limit);
  const result = await turso.execute({ sql: "select * from nearpool_activity order by block_height desc limit ?", args: [limit] });
  return result.rows.map((row) => ({
    kind: row.kind ?? "injection",
    hash: String(row.hash),
    accountId: String(row.account_id),
    poolId: Number(row.pool_id),
    tokenIds: JSON.parse(String(row.token_ids)),
    symbols: JSON.parse(String(row.symbols)),
    decimals: JSON.parse(String(row.decimals)),
    amounts: JSON.parse(String(row.amounts)),
    shares: String(row.shares),
    blockHeight: Number(row.block_height),
    timestamp: Number(row.timestamp),
  }));
}

/* ------------------------------------------------------------ handlers */

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleActivityPublish(req, res) {
  let body;
  try {
    body = JSON.parse((await readRequestBody(req)).toString("utf8"));
  } catch {
    return sendJson(res, 400, { error: "invalid JSON body" });
  }
  const hash = typeof body?.hash === "string" && BASE58_HASH.test(body.hash) ? body.hash : "";
  const accountId = isAccountId(body?.accountId) ? body.accountId : "";
  if (!hash || !accountId) return sendJson(res, 400, { error: "a transaction hash and NEAR account id are required" });
  try {
    const post = await verifyActivity(hash, accountId);
    await upsertActivity(post);
    return sendJson(res, 200, { ok: true, post });
  } catch (error) {
    const status = error?.status || (error?.final ? 400 : 502);
    return sendJson(res, status, { error: "could not publish transaction", detail: String(error?.message || error) });
  }
}

async function handleActivityPosts(res) {
  try {
    return sendJson(res, 200, { posts: await listActivity(100) });
  } catch {
    console.error("could not list activity posts");
    return sendJson(res, 200, { posts: [] });
  }
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(body);
}

function safeDistPath(urlPath) {
  const requested = decodeURIComponent(urlPath.split("?")[0] || "/");
  const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
  const candidate = normalize(join(dist, relative));
  return candidate === dist || candidate.startsWith(`${dist}${sep}`) ? candidate : null;
}

async function handleStatic(req, res, url) {
  let path = safeDistPath(url.pathname);
  if (!path) return sendJson(res, 400, { error: "invalid path" });
  // BrowserRouter owns client routes. Serve the SPA shell for direct
  // navigation and refreshes — including token routes such as
  // /t/usdt.tether-token.near, whose dots look like a file extension. Real
  // missing assets (anything under /assets/, or a non-HTML request) still 404.
  const wantsHtml = String(req.headers.accept || "").includes("text/html");
  if (!existsSync(path) && !url.pathname.startsWith("/assets/") && (wantsHtml || !extname(url.pathname))) path = indexPath;
  try {
    const body = await readFile(path);
    // Only Vite's content-hashed build output (dist/assets/*) is safe to
    // cache for a year — its filename changes whenever its content does.
    // Everything else (sw.js, manifest.webmanifest, favicons,
    // .well-known/assetlinks.json, and anything else passed through from
    // public/) is served no-cache. This matters most for sw.js: caching a
    // service worker file long-term can pin visitors to a stale worker
    // indefinitely, since the browser's own update check is the only thing
    // that would otherwise notice a change.
    const isHashedAsset = path.includes(`${sep}assets${sep}`);
    res.writeHead(200, {
      "content-type": contentTypes[extname(path).toLowerCase()] || "application/octet-stream",
      "cache-control": isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache",
    });
    res.end(body);
  } catch {
    sendJson(res, 404, { error: "not found" });
  }
}

/* ------------------------------------------------------------ RPC proxy */
// Same-origin NEAR RPC proxy (mirrors worker/rpcProxy.ts): keeps a keyed
// provider URL in NEAR_RPC_URL on the server; the browser uses /api/rpc.
const RPC_ALLOWED_METHODS = new Set([
  "query", "block", "chunk", "tx", "EXPERIMENTAL_tx_status", "EXPERIMENTAL_receipt",
  "EXPERIMENTAL_protocol_config", "status", "gas_price", "validators",
  "send_tx", "broadcast_tx_async", "broadcast_tx_commit",
]);
const RPC_MAX_BODY = 64 * 1024;

async function handleRpcProxy(req, res) {
  const origin = req.headers.origin;
  try {
    if (origin && new URL(origin).host !== req.headers.host) return sendJson(res, 403, { error: "cross-origin RPC is not allowed" });
  } catch {
    return sendJson(res, 403, { error: "invalid origin" });
  }
  let body;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > RPC_MAX_BODY) return sendJson(res, 413, { error: "request too large" });
      chunks.push(chunk);
    }
    body = Buffer.concat(chunks).toString("utf8");
    const payload = JSON.parse(body);
    const calls = Array.isArray(payload) ? payload : [payload];
    if (calls.length === 0 || calls.length > 10) return sendJson(res, 400, { error: "invalid batch size" });
    for (const call of calls) {
      if (typeof call?.method !== "string" || !RPC_ALLOWED_METHODS.has(call.method)) {
        return sendJson(res, 400, { error: `RPC method not allowed: ${String(call?.method)}` });
      }
    }
  } catch {
    return sendJson(res, 400, { error: "invalid JSON" });
  }
  let lastStatus = 502;
  for (const upstream of RPC_URLS) {
    try {
      const response = await fetch(upstream, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body,
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500) {
        lastStatus = response.status;
        continue;
      }
      res.writeHead(response.status, { "content-type": response.headers.get("content-type") || "application/json", "cache-control": "no-store" });
      return res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      lastStatus = 502;
    }
  }
  return sendJson(res, lastStatus === 429 ? 429 : 502, { error: "all NEAR RPC upstreams failed" });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "POST" && url.pathname === "/api/rpc") return handleRpcProxy(req, res);
  if (req.method === "POST" && url.pathname === "/api/activity/publish") return handleActivityPublish(req, res);
  if (req.method === "GET" && url.pathname === "/api/activity/posts") return handleActivityPosts(res);
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  return handleStatic(req, res, url);
});

server.listen(port, host, () => {
  console.log("nearpool server listening");
});
