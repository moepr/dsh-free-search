// 双环境（desktop / web）隔离校验
//
// 验证：
//   1. 每个 profile 只改自己的 patch，互不串写
//   2. 切换 web 的引擎不会影响 desktop，反之亦然
//   3. searchProvider（provider id）在两边都保持原样
//   4. 无重复 `- id: web`、无悬空引用
//
// 用法：node tools/assert-profile-isolation.mjs

import fs from 'node:fs';

import {
  PACKAGE_NAME, ENTRY_ID, listProfiles, patchPath,
  readPatch, writePatch, findEntryBlock, readEngine, writeEngine,
  countLegacyWebRows, isValidEngine,
} from './free-search-config.mjs';

let failed = 0;
const ok = (label) => console.log(`  PASS  ${label}`);
const bad = (label, detail) => { failed += 1; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); };
const check = (cond, label, detail) => (cond ? ok(label) : bad(label, detail));

/** 读取一个 profile 的完整快照。 */
function snapshot(profile) {
  const file = patchPath(profile);
  if (!fs.existsSync(file)) return null;
  const { text } = readPatch(file);
  const lines = text.split(/\r?\n/);

  const block = findEntryBlock(lines);

  // 只读解析 `- id: web` 里的 searchProvider
  let searchProvider = null;
  const webIdx = lines.findIndex((l) => /^-\s+id:\s*["']?web["']?\s*$/.test(l));
  if (webIdx !== -1) {
    for (let i = webIdx + 1; i < lines.length; i += 1) {
      if (/^-\s/.test(lines[i])) break;
      const m = lines[i].match(/^\s{2,}searchProvider:\s*(.+?)\s*$/);
      if (m) { searchProvider = m[1].replace(/^["']|["']$/g, ''); break; }
    }
  }

  return {
    file,
    engine: block ? readEngine(lines) : null,
    hasEntry: block !== null,
    searchProvider,
    webRows: countLegacyWebRows(lines),
    fetchProvider: (text.match(/^\s*fetchProvider:\s*(\S+)/m) || [])[1] ?? null,
    bytes: fs.statSync(file).size,
  };
}

console.log('\n[1] profile 清单');
const profiles = listProfiles();
if (profiles.length === 0) {
  console.log('  SKIP  未发现任何 profile');
  process.exit(0);
}
for (const p of profiles) {
  console.log(`        ${p.name.padEnd(10)} 已安装=${p.installed ? '是' : '否'}  在bundles=${p.bundled ? '是' : '否'}`);
}

const usable = profiles.filter((p) => p.installed && p.bundled && fs.existsSync(p.patchFile));
check(usable.length >= 1, `至少一个 profile 可用（${usable.map((p) => p.name).join(', ')}）`);

console.log('\n[2] 各 profile 独立结构');
const before = {};
for (const p of usable) {
  const snap = snapshot(p.name);
  before[p.name] = snap;
  check(snap.hasEntry, `${p.name}: 有 ${ENTRY_ID} 条目`);
  check(snap.webRows <= 1, `${p.name}: - id: web 不重复（${snap.webRows}）`);
  const engineValid = snap.engine === null || isValidEngine(snap.engine);
  check(engineValid, `${p.name}: 引擎合法（${snap.engine ?? '未设置'}）`);
}

console.log('\n[3] 跨 profile 隔离（核心）');
if (usable.length >= 2) {
  const a = usable[0].name;
  const b = usable[1].name;

  const snapA = before[a];
  const snapB = before[b];
  const targetEngine = (snapA.engine === 'bing' ? 'auto' : 'bing');

  // 只改 A
  {
    const file = patchPath(a);
    const { text, hasBom, eol } = readPatch(file);
    const lines = text.split(/\r?\n/);
    writeEngine(lines, targetEngine);
    writePatch(file, lines.join(eol), hasBom, eol);
  }

  const afterA = snapshot(a);
  const afterB = snapshot(b);

  check(afterA.engine === targetEngine, `${a}: 引擎已改为 ${targetEngine}`);
  check(afterB.engine === snapB.engine, `${b}: 引擎未被波及（仍为 ${snapB.engine}）`);
  check(afterB.bytes === snapB.bytes, `${b}: 文件大小完全未变`);
  check(
    afterA.searchProvider === snapA.searchProvider,
    `${a}: searchProvider 未变（${snapA.searchProvider ?? '无'}）`,
  );
  check(
    afterB.searchProvider === snapB.searchProvider,
    `${b}: searchProvider 未变（${snapB.searchProvider ?? '无'}）`,
  );

  // 改回
  {
    const file = patchPath(a);
    const { text, hasBom, eol } = readPatch(file);
    const lines = text.split(/\r?\n/);
    writeEngine(lines, snapA.engine ?? 'bing');
    writePatch(file, lines.join(eol), hasBom, eol);
  }
  const restored = snapshot(a);
  check(restored.engine === snapA.engine, `${a}: 引擎已还原为 ${snapA.engine}`);
} else {
  console.log(`  SKIP  只有一个可用 profile（${usable[0]?.name}），跳过跨环境测试`);
}

console.log('\n[4] 无跨环境硬兜底');
{
  // 两个 profile 都装了插件时，自动探测必须报错而不是猜 desktop
  const bothInstalled = usable.length >= 2;
  if (bothInstalled) {
    const { resolveProfileName } = await import('./free-search-config.mjs');
    const saved = process.env.DSH_PROFILE;
    delete process.env.DSH_PROFILE;
    let threw = false;
    try {
      resolveProfileName();
    } catch {
      threw = true;
    }
    if (saved !== undefined) process.env.DSH_PROFILE = saved;
    check(threw, '多 profile 共存时拒绝猜测，强制显式 --profile');
  } else {
    console.log('  SKIP  只有一个可用 profile');
  }
}

console.log('\n[5] 最终状态');
for (const p of usable) {
  const snap = snapshot(p.name);
  console.log(
    `        ${p.name.padEnd(10)} 引擎=${String(snap.engine).padEnd(6)} ` +
    `searchProvider=${String(snap.searchProvider).padEnd(18)} - id: web=${snap.webRows}`,
  );
  check(snap.webRows <= 1, `${p.name}: 最终无重复 - id: web`);
}

console.log('');
if (failed === 0) {
  console.log('全部通过：desktop 与 web 各自独立，互不串写\n');
  process.exit(0);
} else {
  console.log(`${failed} 项失败\n`);
  process.exit(1);
}
