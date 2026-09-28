import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const REF = "v2.ref-finance.near";
const LOCK = "0".repeat(64);
const SHARES = "1234567890123456789012345";
const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
const action = (method_name, args) => ({ FunctionCall: { method_name, args: b64(args) } });
const transfer = (overrides = {}) => action("mft_transfer", {
  token_id: ":42", receiver_id: LOCK, amount: SHARES, ...overrides,
});
function transaction(actions = [transfer()]) {
  return {
    status: { SuccessValue: "" },
    transaction: { signer_id: "alice.near", receiver_id: REF, actions },
    transaction_outcome: { block_hash: "block" },
    receipts_outcome: [{ outcome: { executor_id: REF, status: { SuccessValue: "" }, logs: [] } }],
  };
}

test("dashboard rows label locks, keep legacy additions and filter by token", async () => {
  const lock = {
    kind: "lock", hash: "locked-tx", accountId: "alice.near", poolId: 42,
    tokenIds: ["wrap.near", "token.near"], symbols: ["NEAR", "TOKEN"],
    decimals: [24, 6], amounts: [], shares: "1500000000000000000000000", timestamp: Date.now(),
  };
  const legacy = { ...lock, kind: undefined, hash: "added-tx", amounts: ["1000000000000000000000000", "2000000"] };
  let query = { data: [lock, legacy], isLoading: false };
  const context = vm.createContext({ console });
  const compile = async (path) => new vm.SourceTextModule(ts.transpileModule(await readFile(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { context });
  const module = await compile("src/components/ActivityList.tsx");
  await module.link(async (specifier) => {
    if (specifier === "../lib/format") {
      const format = await compile("src/lib/format.ts");
      await format.link(() => { throw new Error("unexpected format import"); });
      return format;
    }
    const mocks = {
      "@tanstack/react-query": { useQuery: () => query },
      "react-router-dom": { Link: ({ to, children, ...props }) => createElement("a", { href: to, ...props }, children) },
      "../config/near": { WRAP_NEAR_CONTRACT_ID: "wrap.near", explorerTxUrl: (hash) => `https://nearblocks.io/txns/${hash}` },
      "../lib/activity": { fetchActivity: () => [] },
      "./TokenAvatar": { TokenAvatar: () => null },
      "./icons": { IconExternal: () => null, IconLock: () => null },
    };
    const exports = mocks[specifier] ?? await import(specifier);
    return new vm.SyntheticModule(Object.keys(exports), function () {
      for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  const render = (props = {}) => renderToStaticMarkup(createElement(module.namespace.ActivityList, props));
  const html = render();
  assert.match(html, /Locked forever/);
  assert.match(html, /1.5 LP shares · Pool #42/);
  assert.match(html, /Liquidity added/);
  assert.match(html, /1 NEAR \+ 2 TOKEN/);
  assert.match(html, /href="\/t\/token.near\?pool=42"/);
  assert.match(html, /href="https:\/\/nearblocks.io\/txns\/locked-tx"/);
  assert.match(render({ tokenId: "token.near" }), /Locked forever/);
  assert.doesNotMatch(render({ limit: 1 }), /Liquidity added/);
  assert.match(render({ tokenId: "other.near" }), /No activity yet/);
  query = { data: [], isLoading: true };
  assert.match(render(), /Loading/);
});

// Exercise the real SQL statements against SQLite for both D1 and Turso adapters.
function storage(db) {
  return {
    execute(input) {
      const { sql, args = [] } = typeof input === "string" ? { sql: input } : input;
      const stmt = db.prepare(sql);
      return Promise.resolve({ rows: /^\s*(select|pragma)/i.test(sql) ? stmt.all(...args) : (stmt.run(...args), []) });
    },
    prepare(sql) {
      return { bind: (...args) => ({
        all: async () => ({ results: db.prepare(sql).all(...args) }),
        run: async () => db.prepare(sql).run(...args),
      }) };
    },
  };
}

for (const backend of ["worker", "node"]) {
  test(`${backend}: verify, persist and list liquidity additions and locks`, async (t) => {
    const db = new DatabaseSync(":memory:");
    const store = storage(db);
    db.exec(await readFile("migrations/0001_activity.sql", "utf8"));
    // An entry from before the migration must survive and remain an addition.
    db.exec(`insert into nearpool_activity values ('legacy', 'alice.near', 42,
      '["wrap.near","token.near"]', '["NEAR","TOKEN"]', '[24,6]', '["1","2"]', '3', 1, 1)`);
    let outcome = transaction();
    const rpcFetch = async (_url, options) => {
      const { method, params } = JSON.parse(options.body);
      let result;
      if (method === "tx") result = outcome;
      else if (method === "block") result = { header: { height: 100, timestamp_nanosec: "1700000000000000000" } };
      else if (method === "query") {
        let value;
        if (params.method_name === "get_pool") {
          assert.equal(JSON.parse(Buffer.from(params.args_base64, "base64")).pool_id, 42);
          value = { token_account_ids: ["wrap.near", "token.near"] };
        } else value = { symbol: "TOKEN", decimals: params.account_id === "wrap.near" ? 24 : 6 };
        result = { result: [...Buffer.from(JSON.stringify(value))] };
      } else throw new Error(`unexpected RPC method ${method}`);
      return Response.json({ result });
    };
    const context = vm.createContext({
      console, Buffer, URL, Response, Request, AbortSignal, TextDecoder, TextEncoder,
      Uint8Array, atob, btoa, fetch: rpcFetch,
      process: { env: { PORT: "0", HOST: "127.0.0.1", TURSO_DATABASE_URL: "file:test" } },
    });
    let request;
    let server;
    if (backend === "worker") {
      db.exec(await readFile("migrations/0002_activity_kind.sql", "utf8"));
      const source = ts.transpileModule(await readFile("worker/activity.ts", "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText;
      const module = new vm.SourceTextModule(source, { context });
      await module.link(() => { throw new Error("unexpected worker import"); });
      await module.evaluate();
      request = (path, init) => module.namespace.handleActivityRequest(new Request(`http://local${path}`, init), { DB: store });
    } else {
      const url = new URL("../server.mjs", import.meta.url);
      const module = new vm.SourceTextModule(await readFile(url, "utf8"), {
        context, initializeImportMeta(meta) { meta.url = url.href; },
      });
      await module.link(async (specifier) => {
        const exports = specifier === "@libsql/client" ? { createClient: () => store }
          : specifier === "node:http" ? { createServer: (...args) => (server = createServer(...args)) }
          : await import(specifier);
        return new vm.SyntheticModule(Object.keys(exports), function () {
          for (const [name, value] of Object.entries(exports)) this.setExport(name, value);
        }, { context });
      });
      await module.evaluate();
      if (!server.listening) await once(server, "listening");
      request = (path, init) => fetch(`http://127.0.0.1:${server.address().port}${path}`, init);
    }
    t.after(async () => {
      if (server) await new Promise((resolve) => server.close(resolve));
      db.close();
    });
    const publish = (hash = "A".repeat(44), extra = {}) => request("/api/activity/publish", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ hash, accountId: "alice.near", ...extra }),
    });
    const list = async () => (await (await request("/api/activity/posts")).json()).posts;
    assert.equal((await list())[0].kind, "injection");
    const published = await publish(undefined, { kind: "injection", shares: "999", poolId: 999 });
    assert.equal(published.status, 200);
    const { post } = await published.json();
    assert.equal(post.kind, "lock");
    assert.equal(post.poolId, 42);
    assert.equal(post.shares, SHARES);
    assert.equal(post.timestamp, 1700000000000);
    assert.deepEqual(post.amounts, []);
    assert.deepEqual(post.tokenIds, ["wrap.near", "token.near"]);
    await publish();
    assert.equal((await list()).length, 2, "duplicate publication is idempotent");
    assert.equal((await list())[0].kind, "lock", "newest transaction is listed first");

    // A registration batched before the transfer must still be accepted.
    outcome = transaction([action("mft_register", { token_id: ":42", account_id: LOCK }), transfer()]);
    assert.equal((await publish("B".repeat(44))).status, 200);
    for (const overrides of [
      { receiver_id: "someone.near" }, { token_id: "token.near" },
      { token_id: ":-1" }, { token_id: ":9007199254740992" },
      { amount: "0" }, { amount: "-1" }, { amount: "1.5" }, { amount: 123 },
    ]) {
      outcome = transaction([transfer(overrides)]);
      assert.equal((await publish("C".repeat(44))).status, 400, JSON.stringify(overrides));
    }
    for (const mutate of [
      (o) => { o.transaction.signer_id = "mallory.near"; },
      (o) => { o.transaction.receiver_id = "fake.near"; },
      (o) => { o.status = { Failure: {} }; },
      (o) => { o.receipts_outcome[0].outcome.status = { Failure: {} }; },
      (o) => { o.transaction.actions = [action("mft_transfer_call", { token_id: ":42", receiver_id: LOCK, amount: SHARES })]; },
      (o) => { o.transaction.actions = [action("mft_register", { token_id: ":42", account_id: LOCK })]; },
    ]) {
      outcome = transaction(); mutate(outcome);
      assert.equal((await publish("C".repeat(44))).status, 400);
    }
    assert.equal((await list()).length, 3, "rejected transactions never enter the feed");

    outcome = transaction([action("add_liquidity", { pool_id: 42, amounts: ["999", "999"] })]);
    outcome.receipts_outcome[0].outcome.logs = ['Liquidity added ["10 wrap.near", "20 token.near"], minted 30 shares'];
    const addition = await publish("D".repeat(44));
    assert.equal(addition.status, 200);
    const added = (await addition.json()).post;
    assert.equal(added.kind, "injection");
    assert.deepEqual(added.amounts, ["10", "20"]);
    assert.equal(added.shares, "30");
    assert.equal((await list()).length, 4);
  });
}
