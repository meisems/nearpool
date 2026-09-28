import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { once } from "node:events";
import vm from "node:vm";
import { test } from "node:test";
import ts from "typescript";

const globals = { console, Buffer, URL, Request, Response, Headers, AbortSignal, TextEncoder, TextDecoder };
const synthetic = (context, values) => new vm.SyntheticModule(Object.keys(values), function () {
  for (const [name, value] of Object.entries(values)) this.setExport(name, value);
}, { context });
async function compile(path, context, extra = "", options = {}) {
  return new vm.SourceTextModule(ts.transpileModule(await readFile(path, "utf8") + extra, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { context, ...options });
}

for (const backend of ["worker", "node"]) {
  test(`${backend}: RPC authentication failures use fallbacks without hiding RPC errors`, async (t) => {
    let primaryStatus = 401;
    let fallbackStatus = 200;
    let calls = [];
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "status", params: [] });
    const rpcError = { jsonrpc: "2.0", id: 1, error: { code: -32000, message: "contract error" } };
    const context = vm.createContext({ ...globals,
      process: { env: { PORT: "0", HOST: "127.0.0.1", NEAR_RPC_URL: "https://primary.test", NEAR_FALLBACK_RPC_URLS: "https://fallback.test" } },
      fetch: async (url, init) => {
        calls.push(url);
        assert.equal(init.body, body);
        const status = url === "https://primary.test" ? primaryStatus : fallbackStatus;
        return Response.json(status === 200 ? rpcError : { message: "Unknown API key" }, { status });
      },
    });
    let request;
    if (backend === "worker") {
      const module = await compile("worker/rpcProxy.ts", context);
      await module.link(() => { throw new Error("unexpected import"); });
      await module.evaluate();
      request = () => module.namespace.handleRpcProxy(new Request("http://local/api/rpc", { method: "POST", body }), {
        NEAR_RPC_URL: "https://primary.test", NEAR_FALLBACK_RPC_URLS: "https://fallback.test",
      });
    } else {
      let server;
      const url = new URL("../server.mjs", import.meta.url);
      const module = new vm.SourceTextModule(await readFile(url, "utf8"), {
        context, initializeImportMeta(meta) { meta.url = url.href; },
      });
      await module.link(async (name) => synthetic(context,
        name === "@libsql/client" ? { createClient: () => { throw new Error("unexpected database"); } }
        : name === "node:http" ? { createServer: (...args) => (server = createServer(...args)) }
        : await import(name),
      ));
      await module.evaluate();
      if (!server.listening) await once(server, "listening");
      t.after(() => new Promise((resolve) => server.close(resolve)));
      request = () => fetch(`http://127.0.0.1:${server.address().port}/api/rpc`, { method: "POST", body });
    }
    for (primaryStatus of [401, 403, 429, 503]) {
      calls = [];
      const response = await request();
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), rpcError);
      assert.deepEqual(calls, ["https://primary.test", "https://fallback.test"]);
    }
    primaryStatus = 200; calls = [];
    assert.deepEqual(await (await request()).json(), rpcError);
    assert.equal(calls.length, 1, "JSON-RPC errors are not retried on a different provider");
    primaryStatus = 401; fallbackStatus = 403;
    const unavailable = await request();
    assert.equal(unavailable.status, 502);
    assert.doesNotMatch(await unavailable.text(), /API key/);
  });
}

test("Cloudflare serves missing assets as uncached 404s and leaves client routes alone", async () => {
  const context = vm.createContext(globals);
  const module = await compile("worker/staticAssets.ts", context);
  await module.link(() => { throw new Error("unexpected import"); });
  await module.evaluate();
  const handle = module.namespace.handleAssetRequest;
  const assets = { fetch: async () => new Response("<html>app</html>", {
    headers: { "content-type": "text/html", "cache-control": "public, max-age=31536000, immutable" },
  }) };
  const missing = await handle(new Request("https://site.test/assets/old.js"), assets);
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("cache-control"), "no-store");
  assert.equal(missing.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.equal(await handle(new Request("https://site.test/t/token.near"), assets), null);
  const js = new Response("export const ok = true", { headers: { "content-type": "text/javascript", "cache-control": "immutable" } });
  assert.equal(await handle(new Request("https://site.test/assets/current.js"), { fetch: async () => js }), js);
  const failure = await handle(new Request("https://site.test/assets/current.js"), { fetch: async () => new Response("unavailable", { status: 503 }) });
  assert.equal(failure.headers.get("cache-control"), "no-store");
});

test("chunk recovery reloads once per build and never swallows the import failure", async () => {
  const values = new Map([["nearpool.reloaded-for-chunk", "1"]]);
  let reloads = 0;
  let denied = false;
  const page = async (build) => {
    let listener;
    const context = vm.createContext({ __BUILD_ID__: build,
      window: { addEventListener: (_name, fn) => { listener = fn; }, location: { reload: () => reloads++ } },
      sessionStorage: {
        getItem: (key) => { if (denied) throw new Error("storage denied"); return values.get(key); },
        setItem: (key, value) => values.set(key, value),
      },
    });
    const module = await compile("src/lib/chunkRecovery.ts", context);
    await module.link(() => { throw new Error("unexpected import"); });
    await module.evaluate(); module.namespace.installChunkRecovery();
    return () => listener({ preventDefault: () => assert.fail("must not hide the rejection") });
  };
  const fire = await page("build-a"); fire(); fire();
  assert.equal(reloads, 1);
  (await page("build-a"))(); assert.equal(reloads, 1);
  (await page("build-b"))(); assert.equal(reloads, 2);
  denied = true;
  (await page("build-c"))(); assert.equal(reloads, 2, "blocked storage cannot create a reload loop");
});

test("service worker rejects HTML masquerading as JS and retains valid offline chunks", async () => {
  const listeners = new Map();
  const cached = new Map();
  const writes = [];
  const deleted = [];
  const pending = [];
  let network = new Response("<html>shell</html>", { headers: { "content-type": "text/html" } });
  const context = vm.createContext({ ...globals,
    self: { location: { origin: "https://site.test" }, addEventListener: (name, fn) => listeners.set(name, fn), clients: { claim: async () => {} } },
    caches: {
      match: async (request) => cached.get(request.url)?.clone(),
      open: async () => ({ put: async (request, response) => { writes.push(request.url); cached.set(request.url, response); } }),
      keys: async () => ["nearpool-shell-v3", "nearpool-shell-v4", "unrelated-cache"],
      delete: async (key) => { deleted.push(key); },
    },
    fetch: async () => { if (!network) throw new Error("offline"); return network.clone(); },
  });
  vm.runInContext(await readFile("public/sw.js", "utf8"), context);
  const url = "https://site.test/assets/wallet.js";
  const fetchAsset = async () => {
    let response;
    listeners.get("fetch")({ request: { method: "GET", mode: "cors", url },
      respondWith: (value) => { response = value; }, waitUntil: (value) => pending.push(value),
    });
    const result = await response;
    await Promise.all(pending.splice(0));
    return result;
  };
  await fetchAsset(); assert.equal(writes.length, 0, "HTML must never poison the asset cache");
  cached.set(url, new Response("export const wallet = true", { headers: { "content-type": "text/javascript" } }));
  assert.match(await (await fetchAsset()).text(), /export const wallet/);
  network = null;
  assert.match(await (await fetchAsset()).text(), /export const wallet/);
  cached.set(url, new Response("<html>corrupt</html>", { headers: { "content-type": "text/html" } }));
  assert.equal((await fetchAsset()).status, 0, "poisoned offline entries are rejected");
  network = new Response("export const fresh = true", { headers: { "content-type": "application/javascript" } });
  await fetchAsset(); assert.equal(writes.length, 1);
  listeners.get("activate")({ waitUntil: (value) => pending.push(value) });
  await Promise.all(pending);
  assert.deepEqual(deleted, ["nearpool-shell-v3"]);
});

test("one unavailable wallet adapter does not block other wallets or require the unused modal", async () => {
  const imports = [];
  let setups = 0;
  const selector = { connected: false };
  const context = vm.createContext({ ...globals, console: { ...console, warn: () => {} },
    window: { location: { origin: "https://site.test" } },
  });
  const module = await compile("src/context/NearWalletContext.tsx", context, "\nexport { getSelector };", {
    importModuleDynamically: async (name) => {
      imports.push(name);
      if (name.endsWith("/hot-wallet") || name.endsWith("/wallet-connect")) throw new Error("missing adapter chunk");
      const names = {
        core: "setupWalletSelector", "meteor-wallet": "setupMeteorWallet", "my-near-wallet": "setupMyNearWallet",
        "intear-wallet": "setupIntearWallet", "here-wallet": "setupHereWallet", "okx-wallet": "setupOKXWallet",
        sender: "setupSender", nightly: "setupNightly", "coin98-wallet": "setupCoin98Wallet", "math-wallet": "setupMathWallet",
        "bitget-wallet": "setupBitgetWallet", "welldone-wallet": "setupWelldoneWallet", xdefi: "setupXDEFI", narwallets: "setupNarwallets",
      };
      const method = names[name.split("/").pop()];
      assert.ok(method, `unexpected module ${name}`);
      const adapter = synthetic(context, { [method]: name.endsWith("/core") ? async ({ modules }) => {
        setups++; assert.equal(modules.length, 13); return selector;
      } : () => async () => ({}) });
      await adapter.link(() => {}); await adapter.evaluate(); return adapter;
    },
  });
  await module.link(async (name) => {
    if (name === "react" || name === "react/jsx-runtime") return synthetic(context, await import(name));
    if (name === "../config/near") return synthetic(context, {
      EXPLORER_URL: "", FALLBACK_RPC_URLS: [], NETWORK_ID: "mainnet", NODE_URL: "https://rpc.test", WALLETCONNECT_PROJECT_ID: "test",
    });
    if (name === "../lib/near") return synthetic(context, { viewMethod: () => {} });
    if (name === "../components/WalletPicker") return synthetic(context, { WalletPicker: () => null });
    throw new Error(`unexpected import ${name}`);
  });
  await module.evaluate();
  assert.equal(await module.namespace.getSelector(), selector);
  assert.equal(await module.namespace.getSelector(), selector);
  assert.equal(setups, 1, "selector is initialized once");
  assert.ok(!imports.some((name) => name.includes("modal-ui")));
});
