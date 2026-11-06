#!/usr/bin/env node
// DSH profiles with `autoInstallPeers: false` do not install this plugin's
// @deepseek-ai/* peers. The host already ships the exact versions, so link
// them into this package's node_modules instead of duplicating them (a second
// copy of cordis/schemastery breaks the shared singleton, see upstream #55).
//
// This runs on every install. It is idempotent and skips silently when no host
// tree is found (e.g. a normal npm install where peers resolve normally).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const target = path.join(here, "node_modules", "@deepseek-ai");
const names = [
  "schemastery", "cordis", "dsh-llm", "dsh-settings", "dsh-tools",
  "dsh-credentials", "dsh-web",
];

// Candidate host roots: DSH_HOME/dsh, ~/.dsh-host/dsh, and the parent chain of
// this profile's node_modules. Each is scanned for .pnpm/@deepseek-ai+<name>@*.
const candidates = [];
if (process.env.DSH_HOST_NODE_MODULES) candidates.push(process.env.DSH_HOST_NODE_MODULES);
const home = process.env.HOME || process.env.USERPROFILE || "";
for (const base of [
  process.env.DSH_HOME ? path.join(process.env.DSH_HOME, "dsh", "node_modules") : "",
  path.join(home, ".dsh-host", "dsh", "node_modules"),
  path.resolve(here, "../../../..", "node_modules"),
]) if (base) candidates.push(base);

const pnpmRootOf = (nm) => path.join(nm, ".pnpm");
const findPackage = (name) => {
  for (const nm of candidates) {
    const root = pnpmRootOf(nm);
    let entries = [];
    try { entries = fs.readdirSync(root); } catch { continue; }
    const prefix = "@deepseek-ai+" + name + "@";
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const src = path.join(root, entry, "node_modules", "@deepseek-ai", name);
      if (fs.existsSync(path.join(src, "package.json"))) return src;
    }
  }
  return null;
};

let linked = 0;
for (const name of names) {
  const dst = path.join(target, name);
  try {
    if (fs.lstatSync(dst).isSymbolicLink() || fs.existsSync(path.join(dst, "package.json"))) continue;
  } catch {}
  const src = findPackage(name);
  if (!src) continue;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.symlinkSync(src, dst, process.platform === "win32" ? "junction" : "dir");
    linked += 1;
  } catch (e) {
    console.warn(`[dsh-free-search] ensure-peers: could not link ${name}: ${e.message}`);
  }
}
if (linked > 0) console.log(`[dsh-free-search] ensure-peers: linked ${linked} host peer(s)`);
