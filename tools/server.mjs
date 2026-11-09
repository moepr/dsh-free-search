// dsh-free-search 引擎切换本地服务
//
// 只做一件事：把选中的「引擎」写进 profile patch 里 `web-search-free` 条目的
// `provider` 字段。不碰 `searchProvider`（provider id 归 dsh-web / 搜索切换插件管），
// 不碰 `- id: web`，不新增重复条目。
//
// 用法：node tools/server.mjs [--profile desktop] [--port 4789]

import http from 'node:http';
import { readFileSync } from 'node:fs';

import {
  ENGINES, FREE_ENGINES, MODES, ENTRY_ID,
  isValidEngine, resolveProfileName, listProfiles, patchPath,
  readPatch, writePatch, findEntryBlock, readEngine, writeEngine,
  countLegacyWebRows,
} from './free-search-config.mjs';

const argv = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
};

// profile 解析失败时直接给出可操作的提示，绝不猜一个 profile 就写。
let PROFILE;
try {
  PROFILE = resolveProfileName(argOf('--profile', process.env.DSH_PROFILE));
} catch (error) {
  console.error('');
  console.error('无法确定要操作哪个 profile：');
  console.error('  ' + String(error?.message ?? error));
  console.error('');
  console.error('当前各 profile 的安装状态：');
  for (const p of listProfiles()) {
    console.error(
      `  ${p.name.padEnd(12)} 已安装=${p.installed ? '是' : '否'}  已在bundles=${p.bundled ? '是' : '否'}`,
    );
  }
  console.error('');
  console.error('请显式指定，例如：');
  console.error('  node tools/server.mjs --profile desktop');
  console.error('  node tools/server.mjs --profile web');
  console.error('');
  process.exit(1);
}

const PORT = Number(argOf('--port', process.env.DSF_SWITCHER_PORT || 4789));
const PATCH_FILE = patchPath(PROFILE);

const HTML_FILE = new URL('./switch-engine.html', import.meta.url);

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

/** 读取当前状态：引擎、provider id（只读展示）、健康问题。 */
function getState() {
  const { text } = readPatch(PATCH_FILE);
  const lines = text.split(/\r?\n/);
  const block = findEntryBlock(lines);

  // searchProvider 仅用于展示，永远不写。
  const webIndex = lines.findIndex((line) => /^-\s+id:\s*["']?web["']?\s*$/.test(line));
  let searchProvider = null;
  if (webIndex !== -1) {
    for (let i = webIndex + 1; i < lines.length; i += 1) {
      if (/^-\s/.test(lines[i])) break;
      const m = lines[i].match(/^\s{2,}searchProvider:\s*(.+?)\s*$/);
      if (m) { searchProvider = m[1]; break; }
    }
  }

  const issues = [];
  const legacyRows = countLegacyWebRows(lines);
  if (legacyRows > 1) issues.push(`patch 里有 ${legacyRows} 个重复的 "- id: web" 条目，后者会静默覆盖前者`);
  if (!block) issues.push(`patch 里没有 "- id: ${ENTRY_ID}" 条目，插件配置未落地`);

  return {
    ok: true,
    profile: PROFILE,
    patchFile: PATCH_FILE,
    engine: block ? readEngine(lines) : null,
    // 以下字段只读：本工具绝不修改它们
    searchProvider,
    entryFound: Boolean(block),
    engines: ENGINES,
    freeEngines: [...FREE_ENGINES],
    modes: MODES,
    issues,
  };
}

/** 切换引擎。 */
function switchEngine(engine) {
  if (!isValidEngine(engine)) {
    return { status: 400, body: { ok: false, error: `未知引擎: ${engine}（可用: ${[...MODES, ...ENGINES].join(' / ')}）` } };
  }

  const { text, hasBom, eol } = readPatch(PATCH_FILE);
  const lines = text.split(/\r?\n/);

  const before = readEngine(lines);
  const { mode, lines: next } = writeEngine(lines, engine);
  const after = readEngine(next);

  // 安全断言：引擎确实写进去了，且 searchProvider 没被改动。
  if (after !== engine) {
    return { status: 500, body: { ok: false, error: `写入校验失败：期望 ${engine}，实际 ${after}` } };
  }

  const backup = writePatch(PATCH_FILE, next.join(eol), hasBom, eol);

  return {
    status: 200,
    body: {
      ok: true,
      engine: after,
      previous: before,
      mode,
      backup,
      note: '已写入 profile patch。若 DSH 未自动热载，重新加载设置页或重启 DSH 生效。',
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);

  try {
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(readFileSync(HTML_FILE, 'utf8'));
      return;
    }

    if (url.pathname === '/api/state' && req.method === 'GET') {
      sendJson(res, 200, getState());
      return;
    }

    // 兼容旧路径
    if (url.pathname === '/api/current' && req.method === 'GET') {
      const state = getState();
      sendJson(res, 200, { ok: true, engine: state.engine, profile: state.profile });
      return;
    }

    if (url.pathname === '/api/switch' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        sendJson(res, 400, { ok: false, error: '请求体不是合法 JSON' });
        return;
      }
      const engine = String(parsed.engine ?? '').trim();
      if (!engine) {
        sendJson(res, 400, { ok: false, error: '缺少 engine 字段' });
        return;
      }
      const result = switchEngine(engine);
      sendJson(res, result.status, result.body);
      return;
    }

    sendJson(res, 404, { ok: false, error: 'not found' });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`dsh-free-search 引擎切换器: http://127.0.0.1:${PORT}`);
  console.log(`profile : ${PROFILE}`);
  console.log(`patch   : ${PATCH_FILE}`);
  console.log(`写入字段: ${ENTRY_ID} → provider（引擎名）`);
  console.log('不修改  : searchProvider（provider id） / - id: web');
  console.log('Ctrl+C 关闭');
});
