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
const ponsSearchUrl = "https://www.ponsfamily.com/api/pons-launches/search";
const rpcUpstreamUrl = "https://rpc.mainnet.chain.robinhood.com/";
const activityManagers = new Set([
  "0x73991a25c818bf1f1128deaab1492d45638de0d3",
  "0x58daec3116aae6d93017baaea7749052e8a04fa7",
]);
const MAX_RPC_BODY_BYTES = 1_048_576;
const explorerBase = (process.env.VITE_EXPLORER_URL || process.env.EXPLORER_URL || "https://robinhoodchain.blockscout.com").replace(/\/+$/, "");

// Shared, process-wide cache for read-only third-party data (on-chain
// activity, prices). Every visitor's browser now calls these same-origin
// endpoints instead of hitting the block explorer / CoinGecko / Dexscreener
// directly, so all visitors converge on one authoritative, recently-fetched
// snapshot instead of each browser's own (often stale or partially-blocked)
// view. On an upstream failure we serve the last good cached response
// instead of erroring out, so a transient rate limit never blanks the feed.
const proxyCache = new Map();

const SEED_ACTIVITY_POST = {
  hash: "0x8fa18c0096a512d55fa02afff2fde5de931af99c1d191e65ce921cf468c3dbd7",
  user: "0x60821e7b238e39508db11abf142b57040c5a5a2e",
  token: "0xab093dEF657F15dF31b33922A95e047aDd645B29",
  symbol: "TOKEN",
  version: "V3",
  kind: "inject",
  ethIn: "9900000000000",
  tokenIn: "0",
  minedAtBlock: 56105478,
  timestamp: 1788710595,
};

// In-memory fallback only. This DOES NOT survive a process restart — and on
// Render's free plan the instance spins down after ~15 minutes idle and
// restarts fresh on the next request, wiping this Map back to just the seed
// row above. That's why the public feed used to look different across
// browsers/visits: whichever browser happened to load right after a cold
// start saw an empty shared feed while transactions published before the
// restart were gone for everyone, until new visitors slowly re-populated it.
// Configure TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN for a remote database;
// see .env.example) to back this with real durable storage instead; that
// path is used whenever TURSO_DATABASE_URL is set, and this Map is only
// ever a fallback for local dev.
const activityPostsMemory = new Map([[SEED_ACTIVITY_POST.hash, SEED_ACTIVITY_POST]]);

const tursoUrl = process.env.TURSO_DATABASE_URL || "";
const tursoToken = process.env.TURSO_AUTH_TOKEN || "";
const turso = tursoUrl ? createClient({ url: tursoUrl, authToken: tursoToken || undefined }) : null;
if (!turso) {
  console.warn(
    "TURSO_DATABASE_URL not set — the shared activity feed will use an " +
    "in-memory store that resets on every restart/cold start. See " +
    ".env.example for the durable-storage setup.",
  );
} else {
  // SQLite/libSQL, so this can just run on boot — no separate migration step.
  await turso.execute(`create table if not exists activity_posts (
    hash text primary key,
    user text,
    token text,
    symbol text,
    version text,
    kind text,
    eth_in text,
    token_in text,
    mined_at_block integer,
    timestamp integer
  )`);
  // Seed the one real, pre-existing confirmed transaction once, so it isn't
  // silently missing just because this is a fresh database.
  await turso.execute({
    sql: `insert or ignore into activity_posts (hash, user, token, symbol, version, kind, eth_in, token_in, mined_at_block, timestamp)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      SEED_ACTIVITY_POST.hash,
      SEED_ACTIVITY_POST.user,
      SEED_ACTIVITY_POST.token,
      SEED_ACTIVITY_POST.symbol,
      SEED_ACTIVITY_POST.version,
      SEED_ACTIVITY_POST.kind,
      SEED_ACTIVITY_POST.ethIn,
      SEED_ACTIVITY_POST.tokenIn,
      SEED_ACTIVITY_POST.minedAtBlock,
      SEED_ACTIVITY_POST.timestamp,
    ],
  });
}

async function upsertActivityPost(post) {
  if (!turso) {
    activityPostsMemory.set(post.hash.toLowerCase(), post);
    while (activityPostsMemory.size > 100) activityPostsMemory.delete(activityPostsMemory.keys().next().value);
    return;
  }
  await turso.execute({
    sql: `insert into activity_posts (hash, user, token, symbol, version, kind, eth_in, token_in, mined_at_block, timestamp)
          values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          on conflict(hash) do update set
            user=excluded.user, token=excluded.token, symbol=excluded.symbol,
            version=excluded.version, kind=excluded.kind, eth_in=excluded.eth_in,
            token_in=excluded.token_in, mined_at_block=excluded.mined_at_block, timestamp=excluded.timestamp`,
    args: [
      post.hash.toLowerCase(),
      post.user,
      post.token,
      post.symbol,
      post.version,
      post.kind,
      post.ethIn,
      post.tokenIn,
      post.minedAtBlock,
      post.timestamp ?? null,
    ],
  });
}

async function listActivityPosts(limit = 100) {
  if (!turso) return [...activityPostsMemory.values()];
  try {
    const result = await turso.execute({
      sql: `select * from activity_posts order by mined_at_block desc limit ?`,
      args: [limit],
    });
    return result.rows.map((row) => ({
      hash: row.hash,
      user: row.user,
      token: row.token,
      symbol: row.symbol,
      version: row.version,
      kind: row.kind,
      ethIn: row.eth_in,
      tokenIn: row.token_in,
      minedAtBlock: Number(row.mined_at_block),
      timestamp: row.timestamp ?? undefined,
    }));
  } catch (error) {
    console.error("turso select failed, falling back to seed row", error);
    return [SEED_ACTIVITY_POST];
  }
}

async function fetchWithCache(key, url, ttlMs, fallbackUrl) {
  const cached = proxyCache.get(key);
  const now = Date.now();
  if (cached && now - cached.at < ttlMs) return { ...cached, stale: false };
  try {
    let response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    // A stale/incorrect Blockscout PRO key must not blank the public activity
    // feed. Retry the same query against the configured public explorer.
    if ((response.status === 401 || response.status === 403) && fallbackUrl) {
      response = await fetch(fallbackUrl, { signal: AbortSignal.timeout(15_000) });
    }
    if (!response.ok) throw new Error(`upstream responded ${response.status}`);
    const body = await response.text();
    const contentType = response.headers.get("content-type") || "application/json; charset=utf-8";
    if (/text\/html/i.test(contentType) || /^\s*<!doctype html/i.test(body)) throw new Error("explorer returned HTML instead of JSON");
    const entry = { at: now, body, contentType };
    proxyCache.set(key, entry);
    return { ...entry, stale: false };
  } catch (error) {
    console.error(`Proxy request failed (${key})`, error);
    if (cached) return { ...cached, stale: true };
    throw error;
  }
}

async function rpcCall(method, params) {
  const response = await fetch(rpcUpstreamUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error(payload.error?.message || `RPC responded ${response.status}`);
  return payload.result;
}

async function handleProxy(res, key, url, ttlMs, fallbackUrl, suppressError = false) {
  try {
    const result = await fetchWithCache(key, url, ttlMs, fallbackUrl);
    res.writeHead(200, {
      "content-type": result.contentType,
      "cache-control": "no-store",
      "x-ponspool-cache": result.stale ? "stale" : "fresh",
    });
    res.end(result.body);
    return true;
  } catch (error) {
    if (!suppressError) {
      // Surface the real upstream failure (rate limit, auth, timeout, etc.).
      sendJson(res, 502, { error: "upstream temporarily unavailable", detail: String(error?.message || error) });
    }
    return false;
  }
}

// Optional Blockscout PRO API key (server-side only — never exposed to the
// client). Blockscout's free anonymous instance API is tightly rate-limited
// (5 RPS) and this app polls two addresses on every visitor's screen, so a
// key raises that ceiling substantially. Get one free at dev.blockscout.com.
const blockscoutApiKey = process.env.BLOCKSCOUT_API_KEY || "";
const blockscoutChainId = process.env.VITE_CHAIN_ID || process.env.CHAIN_ID || "4663";

async function handleExplorerProxy(req, res, url) {
  const address = url.searchParams.get("address");
  if (!address) return sendJson(res, 400, { error: "address is required" });
  const upstream = blockscoutApiKey
    ? new URL("https://api.blockscout.com/v2/api")
    : new URL(`${explorerBase}/api`);
  if (blockscoutApiKey) {
    upstream.searchParams.set("chain_id", blockscoutChainId);
    upstream.searchParams.set("apikey", blockscoutApiKey);
  }
  upstream.searchParams.set("module", url.searchParams.get("module") || "account");
  upstream.searchParams.set("action", url.searchParams.get("action") || "txlist");
  upstream.searchParams.set("address", address);
  upstream.searchParams.set("startblock", url.searchParams.get("startblock") || "0");
  // Deliberately NOT forwarding the client's exact endblock. Robinhood
  // Chain has ~0.1s block times, so a precise current-head endblock changes
  // on almost every single poll — that busted the shared cache below (every
  // request got a unique key, so every visitor's poll hit Blockscout fresh
  // instead of sharing one recent snapshot) and helped trigger rate-limit
  // 502s. "latest" is accepted by the Etherscan-compatible API and keeps
  // the cache key stable across an entire TTL window.
  upstream.searchParams.set("endblock", "latest");
  upstream.searchParams.set("page", "1");
  upstream.searchParams.set("offset", "1000");
  upstream.searchParams.set("sort", url.searchParams.get("sort") || "desc");
  const key = `explorer:${upstream.searchParams.toString()}`;
  const fallback = new URL(`${explorerBase}/api`);
  for (const [name, value] of upstream.searchParams) {
    if (name !== "apikey" && name !== "chain_id") fallback.searchParams.set(name, value);
  }
  // 12s cache: comfortably below the 15s client poll interval so every
  // browser polling at once still shares one upstream request.
  const served = await handleProxy(res, key, upstream.toString(), 12_000, blockscoutApiKey ? fallback.toString() : undefined, true);
  if (!served) {
    if (!activityManagers.has(address.toLowerCase())) {
      return sendJson(res, 502, { error: "upstream temporarily unavailable" });
    }
    // If both Blockscout routes are unavailable, recover position-manager
    // activity directly from Robinhood RPC. This keeps the public feed global
    // instead of falling back to each visitor's localStorage snapshot.
    if (!activityManagers.has(address.toLowerCase())) throw error;
    try {
      const latest = Number(BigInt(await rpcCall("eth_blockNumber", [])));
      const requestedStart = Number(BigInt(url.searchParams.get("startblock") || "0"));
      const requestedEnd = Number(BigInt(url.searchParams.get("endblock") || latest));
      const from = Math.max(requestedStart, requestedEnd - 1_000);
      const to = Math.min(requestedEnd, latest);
      const logs = await rpcCall("eth_getLogs", [{
        address,
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
      }]);
      // Keep the fallback cheap enough for the public RPC. Older confirmed
      // rows are retained in the feed snapshot; this path is for recent
      // activity while the explorer is unavailable.
      const hashes = [...new Set((logs || []).map((log) => log.transactionHash).filter(Boolean))].slice(-300);
      const transactions = [];
      for (let index = 0; index < hashes.length; index += 8) {
        const batch = await Promise.all(hashes.slice(index, index + 8).map((hash) => rpcCall("eth_getTransactionByHash", [hash])));
        transactions.push(...batch);
      }
      const result = [];
      for (const tx of transactions) {
        if (!tx) continue;
        result.push({
          hash: tx.hash,
          from: tx.from,
          to: tx.to,
          input: tx.input,
          value: tx.value,
          blockNumber: String(Number(BigInt(tx.blockNumber))),
          timeStamp: "0",
          isError: "0",
        });
      }
      result.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));
      sendJson(res, 200, { status: "1", message: "OK", result });
    } catch (rpcError) {
      console.error("Direct activity RPC fallback failed", rpcError);
      sendJson(res, 502, { error: "upstream activity unavailable", detail: String(rpcError?.message || rpcError) });
    }
  }
}

async function handleEthPriceProxy(req, res) {
  await handleProxy(
    res,
    "price:eth",
    "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
    30_000,
  );
}

async function handlePonsPriceProxy(req, res, token) {
  if (!token) return sendJson(res, 400, { error: "token address is required" });
  await handleProxy(
    res,
    `price:pons:${token.toLowerCase()}`,
    `https://api.dexscreener.com/latest/dex/tokens/${token}`,
    30_000,
  );
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

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_RPC_BODY_BYTES) throw new Error("request body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function handleRpc(req, res) {
  try {
    const body = await readRequestBody(req);
    const response = await fetch(rpcUpstreamUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(responseBody);
  } catch (error) {
    console.error("Robinhood RPC proxy failed", error);
    sendJson(res, 502, { error: "Robinhood Chain RPC is temporarily unavailable" });
  }
}

async function handlePonsSearch(req, res, url) {
  const upstream = new URL(ponsSearchUrl);
  for (const key of ["q", "sort", "age", "page", "quote"]) {
    const value = url.searchParams.get(key);
    if (value !== null) upstream.searchParams.set(key, value);
  }
  if (!upstream.searchParams.has("sort")) upstream.searchParams.set("sort", "latest");
  if (!upstream.searchParams.has("age")) upstream.searchParams.set("age", "all");
  if (!upstream.searchParams.has("page")) upstream.searchParams.set("page", "1");

  try {
    const response = await fetch(upstream, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") || "application/json; charset=utf-8",
      "cache-control": "public, max-age=10, stale-while-revalidate=30",
    });
    res.end(body);
  } catch (error) {
    console.error("Pons launch search proxy failed", error);
    sendJson(res, 502, { error: "Pons launch search is temporarily unavailable" });
  }
}

async function handleActivityPublish(req, res) {
  try {
    const body = JSON.parse((await readRequestBody(req)).toString("utf8"));
    const hash = typeof body.hash === "string" && /^0x[a-fA-F0-9]{64}$/.test(body.hash) ? body.hash : "";
    if (!hash) return sendJson(res, 400, { error: "valid transaction hash is required" });
    const tx = await rpcCall("eth_getTransactionByHash", [hash]);
    const receipt = await rpcCall("eth_getTransactionReceipt", [hash]);
    if (!tx || !receipt || receipt.status !== "0x1" || !activityManagers.has(String(tx.to || "").toLowerCase())) {
      return sendJson(res, 400, { error: "transaction is not a confirmed position-manager transaction" });
    }
    const block = await rpcCall("eth_getBlockByNumber", [receipt.blockNumber, false]);
    const token = typeof body.token === "string" ? body.token : "";
    if (!/^0x[a-fA-F0-9]{40}$/.test(token)) return sendJson(res, 400, { error: "valid token address is required" });
    const post = {
      hash,
      user: tx.from,
      token,
      symbol: typeof body.symbol === "string" ? body.symbol : "TOKEN",
      version: body.version === "V3" ? "V3" : "V4",
      kind: body.mode === "zap" ? "zap" : "inject",
      ethIn: String(body.ethIn || "0"),
      tokenIn: "0",
      minedAtBlock: Number(BigInt(receipt.blockNumber)),
      timestamp: Number(BigInt(block?.timestamp || "0")) || undefined,
    };
    await upsertActivityPost(post);
    return sendJson(res, 200, { ok: true, post });
  } catch (error) {
    return sendJson(res, 400, { error: "could not publish transaction", detail: String(error?.message || error) });
  }
}

async function handleActivityPosts(res) {
  try {
    return sendJson(res, 200, { posts: await listActivityPosts(100) });
  } catch (error) {
    console.error("could not list activity posts", error);
    return sendJson(res, 200, { posts: [SEED_ACTIVITY_POST] });
  }
}

async function handleStatic(req, res, url) {
  let path = safeDistPath(url.pathname);
  if (!path) return sendJson(res, 400, { error: "invalid path" });
  // BrowserRouter owns extensionless client routes. Serve the SPA shell for
  // direct navigation and refreshes such as /launch-pool or /buy.
  if (!existsSync(path) && !extname(url.pathname)) path = indexPath;
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  if (req.method === "POST" && url.pathname === "/api/rpc") return handleRpc(req, res);
  if (req.method === "GET" && url.pathname === "/api/pons-launches/search") return handlePonsSearch(req, res, url);
  if (req.method === "POST" && url.pathname === "/api/activity/publish") return handleActivityPublish(req, res);
  if (req.method === "GET" && url.pathname === "/api/activity/posts") return handleActivityPosts(res);
  if (req.method === "GET" && url.pathname === "/api/explorer") return handleExplorerProxy(req, res, url);
  if (req.method === "GET" && url.pathname === "/api/price/eth") return handleEthPriceProxy(req, res);
  if (req.method === "GET" && url.pathname.startsWith("/api/price/pons/")) {
    return handlePonsPriceProxy(req, res, decodeURIComponent(url.pathname.slice("/api/price/pons/".length)));
  }
  if (req.method !== "GET") return sendJson(res, 405, { error: "method not allowed" });
  return handleStatic(req, res, url);
});

server.listen(port, host, () => {
  console.log(`ponspool server listening on http://${host}:${port}`);
});
