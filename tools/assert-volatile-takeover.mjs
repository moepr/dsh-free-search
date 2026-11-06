// Fork guard (#107 uninstall residue): the provider take-over must write the
// in-memory cosmokit volatile ref, NOT settings.mutate("web", …). The latter
// persists into cordis.patch.yml; after uninstall/disable that leaves a dangling
// `searchProvider: ddg` with no registered ddg (upstream issue #51/#107), and
// the config write also rebuilds the web service (#82 boot loop).
import assert from "node:assert/strict";
import { createVolatile } from "@deepseek-ai/cosmokit";

const { apply, ALL_ENGINES } = await import("../lib/index.js");
const WRITE = Symbol.for("cosmokit.volatile.write");

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`  ok  ${name}`); };

function makeCtx({ search = "deepseek-official", fetch = "http" } = {}) {
  const mutations = [];
  const settings = {
    mutate: async (ns, ops) => { mutations.push({ ns, ops }); },
    configure() {},
    describe: () => [],
  };
  const refs = {
    searchProvider: createVolatile(search),
    fetchProvider: createVolatile(fetch),
  };
  const web = {
    config: refs,
    registerSearchProvider() {},
    registerFetchProvider() {},
  };
  const ctx = {
    logger: { info() {}, warn() {} },
    get() { return undefined; },
    inject(deps, callback) {
      if (Array.isArray(deps) && deps.includes("settings")) {
        callback({ settings, effect: () => () => {}, on: () => {} });
      }
    },
    web,
  };
  return { ctx, refs, mutations };
}

const config = () => ({
  provider: "bing",
  cache: false,
  disabledEngines: ALL_ENGINES.filter((e) => e !== "bing" && e !== "ddg"),
});

check("a real volatile ref has the shared cosmokit writer", () => {
  const ref = createVolatile("x");
  assert.equal(typeof ref[WRITE], "function");
  ref[WRITE]("y");
  assert.equal(ref.get(), "y");
});

check("runtime take-over writes the volatile ref in memory", () => {
  const { ctx, refs } = makeCtx();
  apply(ctx, config());
  assert.equal(refs.searchProvider.get(), "ddg");
  assert.equal(refs.fetchProvider.get(), "fs-quality-fetch");
});

check("no settings.mutate(web) is issued for a real volatile ref", () => {
  const { ctx, mutations } = makeCtx();
  apply(ctx, config());
  assert.deepEqual(mutations.filter((m) => m.ns === "web"), []);
});

check("an explicit foreign provider is still left alone", () => {
  const { ctx, refs } = makeCtx({ search: "grok-web-search", fetch: "grok" });
  apply(ctx, config());
  assert.equal(refs.searchProvider.get(), "grok-web-search");
});

console.log(`OK: ${checks} volatile-takeover checks passed`);
