/**
 * Shared activity feed for Cloudflare (Workers and Pages Functions).
 *
 * Port of the feed in server.mjs: published liquidity activity is only listed
 * after re-reading the transaction from NEAR RPC and confirming it is a
 * fully successful `add_liquidity` or permanent LP `mft_transfer` on Ref Finance signed by the claimed
 * account. Every displayed field is derived from chain data.
 *
 * Storage is a D1 database bound as `DB` (see migrations/). Without the
 * binding the feed still answers, but lists nothing and can't publish.
 */

export interface Env {
  DB?: D1Database;
  /** Primary RPC. Set as a secret when it contains an API key (e.g. Lava). */
  NEAR_RPC_URL?: string;
  /** Comma-separated fallbacks, tried in order. */
  NEAR_FALLBACK_RPC_URLS?: string;
  REF_CONTRACT_ID?: string;
}

export interface ActivityPost {
  kind: "injection" | "lock";
  hash: string;
  accountId: string;
  poolId: number;
  tokenIds: string[];
  symbols: string[];
  decimals: number[];
  amounts: string[];
  shares: string;
  blockHeight: number;
  timestamp: number;
}

const DEFAULT_RPC = "https://rpc.mainnet.near.org";
const DEFAULT_FALLBACKS = "https://free.rpc.fastnear.com,https://rpc.mainnet.fastnear.com,https://archival-rpc.mainnet.near.org,https://rpc.intea.rs";
const MAX_BODY_BYTES = 16_384;
const BASE58_HASH = /^[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const ACCOUNT_ID = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const LP_LOCK_ACCOUNT_ID = "0".repeat(64);

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const json = (status: number, value: unknown) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const isAccountId = (value: unknown): value is string =>
  typeof value === "string" && value.length >= 2 && value.length <= 64 && ACCOUNT_ID.test(value);

const utf8 = new TextDecoder();
const fromBase64 = (b64: string) => utf8.decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
const toBase64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/* ------------------------------------------------------------ NEAR RPC */

function rpcUrls(env: Env): string[] {
  const fallbacks = (env.NEAR_FALLBACK_RPC_URLS ?? DEFAULT_FALLBACKS).split(",").map((u) => u.trim()).filter(Boolean);
  return [env.NEAR_RPC_URL || DEFAULT_RPC, ...fallbacks];
}

interface RpcError {
  name?: string;
  message?: string;
  data?: unknown;
  cause?: { name?: string };
}

async function rpcCall<T>(env: Env, method: string, params: unknown): Promise<T> {
  let lastError: unknown;
  for (const url of rpcUrls(env)) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "nearpool", method, params }),
        signal: AbortSignal.timeout(20_000),
      });
      const raw = await response.text();
      let payload: { result?: T; error?: RpcError };
      try {
        payload = JSON.parse(raw);
      } catch {
        throw new Error(`RPC ${new URL(url).host} responded ${response.status} with a non-JSON body`);
      }
      if (payload.error) {
        const detail = payload.error.cause?.name ?? payload.error.data ?? payload.error.message ?? "RPC error";
        const message = typeof detail === "string" ? detail : JSON.stringify(detail);
        // Deterministic errors (unknown tx, bad args) won't improve on another node.
        if (payload.error.name === "HANDLER_ERROR" || payload.error.name === "REQUEST_VALIDATION_ERROR") {
          throw new HttpError(400, message);
        }
        throw new Error(message);
      }
      if (!response.ok) throw new Error(`RPC responded ${response.status}`);
      return payload.result as T;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError) break;
    }
  }
  throw lastError;
}

async function viewCall<T>(env: Env, accountId: string, methodName: string, args: Record<string, unknown> = {}): Promise<T | null> {
  const result = await rpcCall<{ result: number[] }>(env, "query", {
    request_type: "call_function",
    finality: "final",
    account_id: accountId,
    method_name: methodName,
    args_base64: toBase64(JSON.stringify(args)),
  });
  const text = utf8.decode(new Uint8Array(result.result));
  return text ? (JSON.parse(text) as T) : null;
}

/* ------------------------------------------------------------ verification */

type Status = { SuccessValue?: string; Failure?: unknown } | string;

interface TxOutcome {
  status: Status;
  transaction: {
    signer_id: string;
    receiver_id: string;
    actions: Array<{ FunctionCall?: { method_name: string; args: string } } | string>;
  };
  transaction_outcome: { block_hash: string };
  receipts_outcome: Array<{ outcome: { executor_id: string; logs: string[]; status: Status } }>;
}

const statusFailed = (status: Status) => !status || typeof status !== "object" || "Failure" in status;

async function verifyActivity(env: Env, hash: string, accountId: string): Promise<ActivityPost> {
  const ref = env.REF_CONTRACT_ID || "v2.ref-finance.near";
  const outcome = await rpcCall<TxOutcome>(env, "tx", { tx_hash: hash, sender_account_id: accountId, wait_until: "FINAL" });
  const tx = outcome?.transaction;
  if (!tx || tx.signer_id !== accountId || tx.receiver_id !== ref) {
    throw new HttpError(400, "not a Ref Finance transaction signed by this account");
  }
  if (statusFailed(outcome.status) || outcome.receipts_outcome.some((r) => statusFailed(r.outcome.status))) {
    throw new HttpError(400, "transaction did not fully succeed");
  }
  const call = [...tx.actions]
    .reverse()
    .map((action) => (typeof action === "object" ? action.FunctionCall : undefined))
    .find((call) => call?.method_name === "add_liquidity" || call?.method_name === "mft_transfer");
  if (!call) throw new HttpError(400, "transaction has no liquidity addition or lock call");
  const args = JSON.parse(fromBase64(call.args)) as {
    pool_id?: unknown; amounts?: unknown[]; token_id?: unknown; receiver_id?: unknown; amount?: unknown;
  };
  const kind = call.method_name === "mft_transfer" ? "lock" : "injection";
  if (kind === "lock" && (
    args.receiver_id !== LP_LOCK_ACCOUNT_ID ||
    typeof args.token_id !== "string" || !/^:\d+$/.test(args.token_id) ||
    typeof args.amount !== "string" || !/^\d+$/.test(args.amount) || BigInt(args.amount) <= 0n
  )) throw new HttpError(400, "not a permanent LP share lock");
  const poolId = Number(kind === "lock" ? (args.token_id as string).slice(1) : args.pool_id);
  if (!Number.isSafeInteger(poolId) || poolId < 0) throw new HttpError(400, "invalid pool id");

  const pool = await viewCall<{ token_account_ids: string[] }>(env, ref, "get_pool", { pool_id: poolId });
  if (!pool) throw new HttpError(400, "pool not found");
  const tokenIds = pool.token_account_ids;
  let amounts = kind === "lock" ? [] : (args.amounts ?? []).map(String);
  let shares = kind === "lock" ? args.amount as string : "0";

  // Ref logs `Liquidity added ["<amount> <token>", ...], minted <shares> shares`
  // with the amounts it actually pulled; prefer those over the requested ones.
  for (const receipt of outcome.receipts_outcome) {
    if (kind === "lock") break;
    if (receipt.outcome.executor_id !== ref) continue;
    for (const log of receipt.outcome.logs) {
      const match = /^Liquidity added \[(.*)\], minted (\d+) shares/.exec(log);
      if (!match) continue;
      const byToken = new Map([...match[1].matchAll(/"(\d+) ([^"]+)"/g)].map((m) => [m[2], m[1]]));
      if (tokenIds.every((id) => byToken.has(id))) amounts = tokenIds.map((id) => byToken.get(id) as string);
      shares = match[2];
    }
  }
  if (kind === "injection" && shares === "0" && typeof outcome.status === "object" && outcome.status.SuccessValue) {
    try {
      const value = JSON.parse(fromBase64(outcome.status.SuccessValue));
      if (/^\d+$/.test(String(value))) shares = String(value);
    } catch {
      /* keep 0 */
    }
  }

  const metas = await Promise.all(
    tokenIds.map((id) => viewCall<{ symbol?: string; decimals?: number }>(env, id, "ft_metadata").catch(() => null)),
  );
  const block = await rpcCall<{ header: { height: number; timestamp_nanosec: string } }>(env, "block", {
    block_id: outcome.transaction_outcome.block_hash,
  });
  return {
    kind,
    hash,
    accountId,
    poolId,
    tokenIds,
    symbols: tokenIds.map((id, i) => (id === "wrap.near" ? "NEAR" : metas[i]?.symbol || id.split(".")[0].slice(0, 8))),
    decimals: tokenIds.map((_, i) => (typeof metas[i]?.decimals === "number" ? (metas[i]?.decimals as number) : 24)),
    amounts,
    shares,
    blockHeight: Number(block.header.height),
    timestamp: Number(BigInt(block.header.timestamp_nanosec) / 1_000_000n),
  };
}

/* ------------------------------------------------------------ storage (D1) */

interface ActivityRow {
  kind?: ActivityPost["kind"];
  hash: string;
  account_id: string;
  pool_id: number;
  token_ids: string;
  symbols: string;
  decimals: string;
  amounts: string;
  shares: string;
  block_height: number;
  timestamp: number;
}

/**
 * Create/upgrade the table on first use, so the feed works even if the D1
 * migrations (migrations/*.sql) were never applied to this database; in
 * particular the `kind` column that lock posts need. Runs once per isolate.
 */
let schemaReady: Promise<void> | null = null;
function ensureSchema(db: D1Database): Promise<void> {
  schemaReady ??= (async () => {
    await db
      .prepare(
        `create table if not exists nearpool_activity (
          hash text primary key,
          account_id text not null,
          pool_id integer not null,
          token_ids text not null,
          symbols text not null,
          decimals text not null,
          amounts text not null,
          shares text not null,
          block_height integer not null,
          timestamp integer not null,
          kind text not null default 'injection'
        )`,
      )
      .run();
    await db.prepare("create index if not exists nearpool_activity_block_height on nearpool_activity (block_height desc)").run();
    const { results } = await db.prepare("pragma table_info(nearpool_activity)").all<{ name: string }>();
    if (!results.some((column) => column.name === "kind")) {
      await db.prepare("alter table nearpool_activity add column kind text not null default 'injection'").run();
    }
  })().catch((error) => {
    schemaReady = null; // try again on the next request
    throw error;
  });
  return schemaReady;
}

async function listActivity(db: D1Database, limit = 100): Promise<ActivityPost[]> {
  await ensureSchema(db);
  const { results } = await db
    .prepare("select * from nearpool_activity order by block_height desc limit ?")
    .bind(limit)
    .all<ActivityRow>();
  return results.map((row) => ({
    kind: row.kind ?? "injection",
    hash: row.hash,
    accountId: row.account_id,
    poolId: Number(row.pool_id),
    tokenIds: JSON.parse(row.token_ids),
    symbols: JSON.parse(row.symbols),
    decimals: JSON.parse(row.decimals),
    amounts: JSON.parse(row.amounts),
    shares: row.shares,
    blockHeight: Number(row.block_height),
    timestamp: Number(row.timestamp),
  }));
}

async function insertActivity(db: D1Database, post: ActivityPost): Promise<void> {
  await ensureSchema(db);
  await db
    .prepare(
      `insert into nearpool_activity (hash, account_id, pool_id, token_ids, symbols, decimals, amounts, shares, block_height, timestamp, kind)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(hash) do nothing`,
    )
    .bind(
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
    )
    .run();
}

/* ------------------------------------------------------------ routing */

async function readJsonBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "request body too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

/**
 * Handle `/api/activity/*`. Returns null for any other path so the caller
 * can fall through to static assets.
 */
export async function handleActivityRequest(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/activity/posts") {
    if (request.method !== "GET") return json(405, { error: "method not allowed" });
    if (!env.DB) return json(200, { posts: [] });
    try {
      return json(200, { posts: await listActivity(env.DB) });
    } catch {
      console.error("could not list activity posts");
      return json(200, { posts: [] });
    }
  }

  if (pathname === "/api/activity/publish") {
    if (request.method !== "POST") return json(405, { error: "method not allowed" });
    if (!env.DB) return json(503, { error: "activity storage is not configured (bind a D1 database as DB)" });
    try {
      const body = (await readJsonBody(request)) as { hash?: unknown; accountId?: unknown } | null;
      const hash = typeof body?.hash === "string" && BASE58_HASH.test(body.hash) ? body.hash : "";
      const accountId = isAccountId(body?.accountId) ? body.accountId : "";
      if (!hash || !accountId) return json(400, { error: "a transaction hash and NEAR account id are required" });
      const post = await verifyActivity(env, hash, accountId);
      await insertActivity(env.DB, post);
      return json(200, { ok: true, post });
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      return json(status, { error: "could not publish transaction", detail: error instanceof Error ? error.message : String(error) });
    }
  }

  if (pathname.startsWith("/api/")) return json(404, { error: "not found" });
  return null;
}
