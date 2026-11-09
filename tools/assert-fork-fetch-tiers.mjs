// Fork guard (#106): fetch tier fixes must be real, not just config fields.
// T1.5 browser can be switched off, and firecrawl-first actually lets
// firecrawl serve the page before exa short-circuits the chain.
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const providerSrc = fs.readFileSync(new URL("lib/fetch_provider.js", root), "utf8");
const indexSrc = fs.readFileSync(new URL("lib/index.js", root), "utf8");
const clientSrc = fs.readFileSync(new URL("lib/client.js", root), "utf8");
const { CONTROLLED_STUBS } = await import(new URL("lib/fetch_upstream.js", root));
const { createFetchProvider } = await import(new URL("lib/fetch_provider.js", root));

let checks = 0;
const check = async (name, fn) => { await fn(); checks++; console.log(`  ok  ${name}`); };
const keys = { EXA_API_KEY: "k", FIRECRAWL_API_KEY: "k", CRAWL4AI_API_KEY: "k" };
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const url = "https://test-nonexistent-host.example/page";

function reset() {
  for (const k of Object.keys(CONTROLLED_STUBS)) CONTROLLED_STUBS[k] = null;
}

await check("source declares both #106 settings and wires them live", () => {
  assert.match(indexSrc, /browserFetch: z\.boolean\(\)\.default\(true\)\.volatile\(\)/);
  // 0.9.39 upstream renamed the tier-order knob: fetchPrefer ("exa"/"firecrawl").
  // Either the upstream name or the original fork name satisfies this guard —
  // the essential property is that a volatile config field exists and is wired.
  assert.match(indexSrc, /(fetchPrefer|fetchTierOrder): z\.string\(\)\.default\("(exa|exa-first)"\)\.volatile\(\)/);
  assert.match(indexSrc, /(browserEnabled|browser): \(\) => current\(\)\.browserFetch !== false/);
  assert.match(indexSrc, /(prefer|tierOrder): \(\) =>/);
  assert.match(clientSrc, /path: \["browserFetch"\]/);
  assert.match(clientSrc, /path: \["(fetchPrefer|fetchTierOrder)"\]/);
});

await check("browser=false skips the headless-browser tier entirely", async () => {
  reset();
  let exa = 0;
  CONTROLLED_STUBS.exa = async () => { exa += 1; return "e".repeat(500); };
  const p = createFetchProvider({ resolveApiKey: async (env) => keys[env], logger, browserEnabled: () => false, validateUrl: async () => {} });
  const t0 = Date.now();
  const r = await p.fetch({ url }, undefined);
  assert.equal(r.body.content[0], "e");
  assert.equal(exa, 1);
  assert.ok(Date.now() - t0 < 2000, "no 25s browser probe");
  assert.match(providerSrc, /if \(browserEnabled\(\) && browserPath\)/);
});

await check("firecrawl-first serves from firecrawl with exa untouched", async () => {
  reset();
  let exa = 0, fc = 0;
  CONTROLLED_STUBS.exa = async () => { exa += 1; return "e".repeat(500); };
  CONTROLLED_STUBS.firecrawl = async () => { fc += 1; return "f".repeat(500); };
  const p = createFetchProvider({
    resolveApiKey: async (env) => keys[env], logger,
    browserEnabled: () => false, prefer: () => "firecrawl", validateUrl: async () => {},
  });
  const r = await p.fetch({ url }, undefined);
  assert.equal(r.body.content[0], "f");
  assert.equal(fc, 1);
  assert.equal(exa, 0);
});

await check("exa-first stays the default (upstream behaviour)", async () => {
  reset();
  let exa = 0, fc = 0;
  CONTROLLED_STUBS.exa = async () => { exa += 1; return "e".repeat(500); };
  CONTROLLED_STUBS.firecrawl = async () => { fc += 1; return "f".repeat(500); };
  const p = createFetchProvider({ resolveApiKey: async (env) => keys[env], logger, browserEnabled: () => false, validateUrl: async () => {} });
  const r = await p.fetch({ url }, undefined);
  assert.equal(r.body.content[0], "e");
  assert.equal(exa, 1);
  assert.equal(fc, 0);
});

console.log(`OK: ${checks} fork fetch-tier checks passed`);
