// dsh-free-search 引擎切换 —— 共用配置层
//
// 设计约束（务必遵守）：
//   1. 本文件只改 `web-search-free` 条目里的 `provider`（= 引擎名，如 bing/auto），
//      **绝不触碰 `searchProvider`**（= provider id，属于 @deepseek-ai/dsh-web 与
//      dsh-web-search-switcher 的管辖范围）。两者是不同的东西：
//        searchProvider: ddg      ← provider id，由 free-search 插件运行时接管
//        provider: bing           ← 引擎，由本工具切换
//   2. 绝不新增 `- id: web` 行（重复行会让后者静默覆盖前者，且造成悬空引用）。
//   3. profile 严格跟随「插件装在哪个 profile」——web 装的只改 web，desktop 装的只改
//      desktop，绝不跨环境写入，也不用 desktop 硬兜底。
//   4. 写盘前备份，保留原文件的换行风格与 BOM 状态。

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** 插件的 cordis 条目 id（见插件自带 cordis.patch.yml）。 */
export const ENTRY_ID = 'web-search-free';
/** 插件包名。 */
export const PACKAGE_NAME = 'dsh-free-search';
/** 本工具唯一允许修改的字段名。 */
const ENGINE_KEY = 'provider';

/**
 * 插件 lib/index.js 里 ALL_ENGINES 的真实取值（30 个）。
 * 旧版工具把 `mojeek` 当成引擎——插件根本不认识它，写进去只会让搜索报 "unknown engine"。
 */
export const ENGINES = [
  'ddg', 'ddg-lite', 'bing', 'searxng', 'degoog', 'anysearch',
  'exa', 'tavily', 'keenable', 'firecrawl', 'parallel', 'perplexity',
  'serpbase', 'serply', 'outcrawl', 'deepseek-official', 'deepseek-tools', 'you',
  'baidu', 'kimi', 'aliyun', 'doubao', 'tinyfish', 'jina',
  'zhihu_global', 'zhihu_site', 'agy', 'openai', 'gemini', 'claude',
  'so360', 'sogou', 'wechat', 'toutiao',
];

/** 免 key 即可用的引擎。 */
export const FREE_ENGINES = new Set([
  'ddg', 'ddg-lite', 'bing', 'searxng', 'anysearch', 'so360', 'sogou', 'wechat', 'toutiao',
]);

/** 额外接受的路由模式。 */
export const MODES = ['auto', 'multi'];

/** 引擎是否合法。 */
export function isValidEngine(engine) {
  return MODES.includes(engine) || ENGINES.includes(engine);
}

/** 解析 DSH home。 */
export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/** profiles 根目录。 */
export function profilesDir() {
  return path.join(dshHome(), 'profiles');
}

/**
 * 探测当前 profile —— 严格跟随「插件装在哪个 profile」。
 *
 * 铁律：web 里装的插件只能改 web 的 patch，desktop 里装的只能改 desktop 的。
 * 因此 **绝不** 用 `desktop` 硬兜底把一个 profile 的意图写到另一个上。
 *
 * 优先级：
 *   1. 显式 --profile / -Profile 参数
 *   2. DSH_PROFILE 环境变量（DSH 运行时会设置）
 *   3. 唯一「装了这个插件」的 profile（读其 node_modules/dsh-free-search 与 bundles）
 *   4. 唯一含 cordis.patch.yml 的 profile
 *   否则报错要求显式指定，不做任何猜测性写入。
 */
export function resolveProfileName(explicit) {
  if (explicit && String(explicit).trim()) return String(explicit).trim();
  if (process.env.DSH_PROFILE && process.env.DSH_PROFILE.trim()) return process.env.DSH_PROFILE.trim();

  const root = profilesDir();
  const withPatch = [];
  const withPlugin = [];

  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const patch = path.join(dir, 'cordis.patch.yml');
      if (!fs.existsSync(patch)) continue;
      withPatch.push(entry.name);

      const installed = fs.existsSync(path.join(dir, 'node_modules', PACKAGE_NAME));
      let bundled = false;
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        bundled = (manifest?.dsh?.profile?.bundles ?? []).includes(PACKAGE_NAME);
      } catch {
        /* 没有 manifest 就当没装 */
      }
      if (installed || bundled) withPlugin.push(entry.name);
    }
  } catch {
    /* profiles 目录不存在 */
  }

  if (withPlugin.length === 1) return withPlugin[0];
  if (withPlugin.length > 1) {
    throw new Error(
      `多个 profile 都装了 ${PACKAGE_NAME}（${withPlugin.join(', ')}）。` +
      `为避免写到错误的环境，请显式指定：--profile <名称>（PowerShell: -Profile <名称>）`,
    );
  }
  if (withPatch.length === 1) return withPatch[0];

  throw new Error(
    `无法唯一确定 profile：装了 ${PACKAGE_NAME} 的有 [${withPlugin.join(', ') || '无'}]，` +
    `含 patch 的有 [${withPatch.join(', ') || '无'}]。请用 --profile <名称> 明确指定。`,
  );
}

/** 列出所有 profile 及其插件安装状态（不做任何写入）。 */
export function listProfiles() {
  const root = profilesDir();
  const out = [];
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(root, entry.name);
      const patch = path.join(dir, 'cordis.patch.yml');
      if (!fs.existsSync(patch)) continue;

      let bundles = [];
      try {
        bundles = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))?.dsh?.profile?.bundles ?? [];
      } catch { /* ignore */ }

      out.push({
        name: entry.name,
        installed: fs.existsSync(path.join(dir, 'node_modules', PACKAGE_NAME)),
        bundled: bundles.includes(PACKAGE_NAME),
        patchFile: patch,
      });
    }
  } catch { /* ignore */ }
  return out;
}

/** 某个 profile 的 patch 文件绝对路径。 */
export function patchPath(profileName) {
  return path.join(profilesDir(), profileName, 'cordis.patch.yml');
}

/** 读取 patch 文本 + 元信息。 */
export function readPatch(file) {
  const buf = fs.readFileSync(file);
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text = buf.toString('utf8').replace(/^\uFEFF/, '');
  const crlf = (text.match(/\r\n/g) || []).length;
  const loneLf = (text.match(/(?<!\r)\n/g) || []).length;
  return { text, hasBom, eol: crlf > loneLf ? '\r\n' : '\n' };
}

/** 按原风格写回，并留一份 .bak-<时间戳>。 */
export function writePatch(file, text, hasBom, eol) {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  const backup = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, backup);
  fs.writeFileSync(file, (hasBom ? '\uFEFF' : '') + normalized, 'utf8');
  return backup;
}

/**
 * 定位 `- id: web-search-free` 条目的行区间。
 * 条目从 `- id:` 开始，到下一个顶格 `- ` 或文件末尾结束。
 */
export function findEntryBlock(lines) {
  const start = lines.findIndex((line) => new RegExp(`^-\\s+id:\\s*["']?${ENTRY_ID}["']?\\s*$`).test(line));
  if (start === -1) return null;

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^-\s/.test(lines[i])) { end = i; break; }
  }
  return { start, end };
}

/** 从条目块里读 `provider`（引擎）。 */
export function readEngine(lines) {
  const block = findEntryBlock(lines);
  if (!block) return null;
  const re = new RegExp(`^\\s{2,}${ENGINE_KEY}:\\s*(.+?)\\s*$`);
  for (let i = block.start; i < block.end; i += 1) {
    const m = lines[i].match(re);
    if (m) return m[1].replace(/^["']|["']$/g, '');
  }
  return null;
}

/**
 * 把引擎写入条目块的 `provider`。
 * 只在该条目内部操作；条目不存在时追加整条（**不是**只追加 `- id: web`）。
 */
export function writeEngine(lines, engine) {
  const block = findEntryBlock(lines);
  const re = new RegExp(`^(\\s{2,})${ENGINE_KEY}:\\s*(.*?)\\s*$`);

  if (block) {
    // 已有 provider：就地替换
    for (let i = block.start; i < block.end; i += 1) {
      const m = lines[i].match(re);
      if (m) {
        lines[i] = `${m[1]}${ENGINE_KEY}: ${engine}`;
        return { mode: 'replaced', lines };
      }
    }
    // 没有 provider：插到 config: 之后（没有 config 就插到 id 行之后）
    let anchor = -1;
    for (let i = block.start; i < block.end; i += 1) {
      if (/^\s{2}config:\s*$/.test(lines[i])) { anchor = i; break; }
    }
    if (anchor === -1) anchor = block.start;
    lines.splice(anchor + 1, 0, `    ${ENGINE_KEY}: ${engine}`);
    return { mode: 'inserted', lines };
  }

  // 条目不存在：追加完整条目（含 name，避免变成无主配置）
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  lines.push('');
  lines.push(`- id: ${ENTRY_ID}`);
  lines.push(`  name: ${PACKAGE_NAME}`);
  lines.push('  config:');
  lines.push(`    ${ENGINE_KEY}: ${engine}`);
  lines.push('');
  return { mode: 'appended', lines };
}

/** 统计 patch 里 `- id: web` 的重复行（用于健康检查）。 */
export function countLegacyWebRows(lines) {
  return lines.filter((line) => /^-\s+id:\s*["']?web["']?\s*$/.test(line)).length;
}
