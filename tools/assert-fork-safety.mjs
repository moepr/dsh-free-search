// Fork guard: a GitHub fork must NEVER be "upgraded" by the upstream npm
// one-click updater. `pnpm add dsh-free-search@latest` would silently replace
// this install with DDDMUC's package and drop the switcher tab + issue fixes.
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const index = fs.readFileSync(new URL("lib/index.js", root), "utf8");
const client = fs.readFileSync(new URL("lib/client.js", root), "utf8");
const pkg = JSON.parse(fs.readFileSync(new URL("package.json", root), "utf8"));

let checks = 0;
const check = (name, fn) => { fn(); checks++; console.log(`  ok  ${name}`); };

check("the fork declares its own repository", () => {
  assert.match(pkg.repository.url, /github\.com\/moepr\/dsh-free-search/);
});

check("the self-updater is gated by FORK_BUILD", () => {
  assert.match(index, /const FORK_BUILD = true;/);
  assert.match(index, /installable: FORK_BUILD \? false :/);
  assert.match(index, /if \(FORK_BUILD\) \{\s*return \{\s*ok: false,\s*code: "fork-install"/);
});

check("the upgrade command cannot run on a fork", () => {
  const at = index.indexOf("async updatePlugin()");
  assert.ok(at > 0);
  const block = index.slice(at, at + 900);
  assert.match(block, /FORK_BUILD/);
  // The pnpm command must appear AFTER the guard, so it is unreachable.
  assert.ok(block.indexOf("FORK_BUILD") < block.indexOf("pnpm add dsh-free-search@latest"));
});

check("links point at the fork, not upstream npm", () => {
  assert.match(index, /const FORK_REPO_URL = "https:\/\/github\.com\/moepr\/dsh-free-search"/);
  assert.match(index, /const PLUGIN_NPM_URL = FORK_REPO_URL;/);
  assert.match(index, /const PLUGIN_REPO_URL = FORK_REPO_URL;/);
  assert.match(client, /const PLUGIN_REPO_URL = "https:\/\/github\.com\/moepr\/dsh-free-search"/);
});

console.log(`OK: ${checks} fork-safety checks passed`);
