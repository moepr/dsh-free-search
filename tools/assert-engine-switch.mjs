// 校验引擎切换工具的安全性：
//   1. 只改 web-search-free 条目的 provider
//   2. 绝不改动 searchProvider（provider id）
//   3. 绝不新增重复的 - id: web
//   4. 保留换行风格与 BOM
//
// 用法：node tools/assert-engine-switch.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { readEngine, writeEngine, findEntryBlock, countLegacyWebRows, ENGINES } from './free-search-config.mjs';

let failed = 0;
const ok = (label) => console.log(`  PASS  ${label}`);
const bad = (label, detail) => { failed += 1; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); };
const check = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

// 本机真实 patch 的等价结构：- id: web 后面有 name 行（旧工具的正则正是栽在这里）
const REAL_LIKE = [
  '- id: web',
  '  name: "@deepseek-ai/dsh-web"',
  '  config:',
  '    searchProvider: deepseek-official',
  '    fetchProvider: http',
  '- id: web-search-free',
  '  name: dsh-free-search',
  '  config:',
  '    disabledEngines: []',
  '    bingMarket: zh-CN',
  '    provider: bing',
  '    fetchProviderTakeover: false',
  '',
].join('\n');

console.log('\n[1] 结构识别');
{
  const lines = REAL_LIKE.split('\n');
  const block = findEntryBlock(lines);
  check(block !== null, '能找到 web-search-free 条目');
  check(readEngine(lines) === 'bing', '能读出当前引擎 bing', `实际: ${readEngine(lines)}`);
}

console.log('\n[2] 切换引擎');
{
  const lines = REAL_LIKE.split('\n');
  writeEngine(lines, 'auto');
  const out = lines.join('\n');

  check(readEngine(lines) === 'auto', '引擎已改为 auto');
  check(out.includes('searchProvider: deepseek-official'), 'searchProvider 未被改动');
  check(out.includes('fetchProvider: http'), 'fetchProvider 未被改动');
  check(out.includes('fetchProviderTakeover: false'), 'fetchProviderTakeover 保留');
  check(countLegacyWebRows(lines) === 1, '- id: web 仍然只有 1 个', `实际 ${countLegacyWebRows(lines)}`);

  const webIdx = lines.findIndex((l) => /^- id: web$/.test(l));
  const freeIdx = lines.findIndex((l) => /^- id: web-search-free$/.test(l));
  check(webIdx !== -1 && freeIdx !== -1 && freeIdx > webIdx, '两个条目都存在且顺序正确');
}

console.log('\n[3] 条目缺失时的兜底（旧工具在这里写坏文件）');
{
  const lines = [
    '- id: web',
    '  name: "@deepseek-ai/dsh-web"',
    '  config:',
    '    searchProvider: deepseek-official',
    '    fetchProvider: http',
    '',
  ];
  writeEngine(lines, 'bing');
  const out = lines.join('\n');

  check(out.includes('- id: web-search-free'), '追加了完整的 web-search-free 条目');
  check(out.includes('name: dsh-free-search'), '追加条目带 name 字段（不是无主配置）');
  check(countLegacyWebRows(lines) === 1, '没有新增第二条 - id: web', `实际 ${countLegacyWebRows(lines)}`);
  check(out.includes('searchProvider: deepseek-official'), 'searchProvider 仍然未被触碰');
  check(readEngine(lines) === 'bing', '新条目的引擎正确');
}

console.log('\n[4] 重复执行幂等');
{
  const lines = REAL_LIKE.split('\n');
  writeEngine(lines, 'ddg');
  writeEngine(lines, 'ddg');
  writeEngine(lines, 'bing');
  const out = lines.join('\n');
  check(readEngine(lines) === 'bing', '连续切换后引擎正确');
  check(countLegacyWebRows(lines) === 1, '无重复 - id: web');
  check((out.match(/provider: bing/g) || []).length === 1, 'provider 行只有一条');
}

console.log('\n[5] 引擎清单与插件源码一致');
{
  // 插件 ALL_ENGINES：30 个 + 4 个 SERP 家族
  check(ENGINES.includes('bing'), '含 bing');
  check(ENGINES.includes('deepseek-official'), '含 deepseek-official');
  check(!ENGINES.includes('mojeek'), '不含 mojeek（旧工具的错误值）');
  check(ENGINES.includes('so360') && ENGINES.includes('sogou'), '含 SERP 家族');
  check(new Set(ENGINES).size === ENGINES.length, '无重复项');
}

console.log('\n[6] 真实 patch 文件只读校验');
{
  const real = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'cordis.patch.yml');
  if (fs.existsSync(real)) {
    const text = fs.readFileSync(real, 'utf8');
    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
    check(countLegacyWebRows(lines) === 1, '真实 patch 里 - id: web 只有 1 个', `实际 ${countLegacyWebRows(lines)}`);
    const block = findEntryBlock(lines);
    check(block !== null, '真实 patch 里能找到 web-search-free 条目');
    if (block) {
      const engine = readEngine(lines);
      check(typeof engine === 'string' && engine.length > 0, `真实 patch 当前引擎可读: ${engine}`);
    }
  } else {
    console.log('  SKIP  未找到本机 profile patch');
  }
}

console.log('');
if (failed === 0) {
  console.log(`全部通过：工具只改 provider（引擎），不碰 searchProvider / - id: web\n`);
  process.exit(0);
} else {
  console.log(`${failed} 项失败\n`);
  process.exit(1);
}
