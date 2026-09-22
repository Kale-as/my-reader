#!/usr/bin/env node
// 把 Codex 的「数据 / 运行时」目录迁到 D:\tools\codex，原位置保留为目录联接（junction）。
//
//   · 不修改任何环境变量（不使用 CODEX_HOME），不修改 config.toml —— 路径与配置完全不变
//   · 程序本体（%LOCALAPPDATA%\OpenAI\Codex）与状态库（sessions / *.sqlite / skills / plugins）原地不动
//   · 默认是「预演」，只有显式加 --apply 才真正搬动数据
//
// 用法：
//   node migrate-codex-data.mjs                  # 预演：只打印将要做的事
//   node migrate-codex-data.mjs --apply          # 执行迁移（需先完全退出 Codex）
//   node migrate-codex-data.mjs --revert <名字>  # 回滚某一个目录
//   node migrate-codex-data.mjs --revert-all     # 回滚全部
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  lstatSync,
  mkdirSync,
  cpSync,
  rmSync,
  renameSync,
  readdirSync,
  readlinkSync,
  statSync,
  symlinkSync,
  statfsSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, basename } from 'node:path';

const HOME = process.env.USERPROFILE || '';
const APPDATA = process.env.APPDATA || '';
const LOCALAPPDATA = process.env.LOCALAPPDATA || '';
const TARGET_ROOT = 'D:\\tools\\codex';

const MAPPINGS = [
  { name: 'sandbox-bin', src: join(HOME, '.codex', '.sandbox-bin') },
  { name: 'tmp', src: join(HOME, '.codex', '.tmp') },
  { name: 'sandbox', src: join(HOME, '.codex', '.sandbox') },
  { name: 'skills', src: join(HOME, '.codex', 'skills') },
  { name: 'plugins', src: join(HOME, '.codex', 'plugins') },
  // 下面两项是 MSIX 打包应用的数据：默认只探测、不迁移（见 probeOnly 说明）
  { name: 'appdata-Codex', src: join(APPDATA, 'Codex'), probeOnly: true, virtualHint: 'Roaming\\Codex' },
  { name: 'localappdata-Codex', src: join(LOCALAPPDATA, 'Codex'), probeOnly: true, virtualHint: 'Local\\Codex' },
].map((m) => ({ ...m, dst: join(TARGET_ROOT, m.name) }));

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const force = args.includes('--force');
const includeMsix = args.includes('--include-msix');
const revertAll = args.includes('--revert-all');
const revertIdx = args.indexOf('--revert');
const revertName = revertIdx >= 0 ? args[revertIdx + 1] : null;

const mb = (n) => (n / 1048576).toFixed(1);
const log = (...a) => console.log(...a);

function section(t) {
  log('');
  log(`=== ${t} ===`);
}

/**
 * 统计目录的文件数与总字节。
 * tolerant=true（预演/概览）时记录读不了的子目录；false（执行/校验）时直接抛错。
 */
function treeStats(dir, tolerant = true) {
  let files = 0;
  let bytes = 0;
  const unreadable = [];
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch (err) {
      if (!tolerant) throw err;
      unreadable.push(d);
      return;
    }
    for (const entry of entries) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        files++;
        try {
          bytes += statSync(full).size;
        } catch {
          if (!tolerant) throw new Error(`文件无法读取（很可能被占用）：${full}`);
        }
      }
    }
  };
  walk(dir);
  return { files, bytes, unreadable };
}

const isReparse = (p) => {
  try {
    return Boolean(lstatSync(p).isSymbolicLink());
  } catch {
    return false;
  }
};

/** 区分「确实不存在」与「存在但当前上下文无权访问」（沙箱/受限终端里后者很常见） */
function pathState(p) {
  if (existsSync(p)) return 'exists';
  try {
    accessSync(p, fsConstants.F_OK);
    return 'exists';
  } catch (err) {
    return err && err.code === 'EACCES' ? 'denied' : 'missing';
  }
}

/** 找到 MSIX 打包应用在 %LOCALAPPDATA%\Packages 下的虚拟化数据目录 */
function findMsixCounterpart(hint) {
  const pkgRoot = join(LOCALAPPDATA, 'Packages');
  if (!existsSync(pkgRoot)) return null;
  let names;
  try {
    names = readdirSync(pkgRoot);
  } catch {
    return null;
  }
  for (const name of names) {
    if (!/^OpenAI\.Codex_/i.test(name)) continue;
    const candidate = join(pkgRoot, name, 'LocalCache', hint);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** 目录里最新的文件修改时间 */
function newestMtime(dir) {
  let newest = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try {
          const t = statSync(full).mtimeMs;
          if (t > newest) newest = t;
        } catch {
          /* ignore */
        }
      }
    }
  };
  walk(dir);
  return newest;
}

const fmtTime = (ms) => (ms ? new Date(ms).toLocaleString('zh-CN', { hour12: false }) : '(未知)');

/**
 * 路径归一化，用于比较联接指向：
 * Windows 把联接读出来常常带尾部反斜杠（D:\x\y\），也可能带 \\?\ 前缀，且大小写不敏感。
 */
const normPath = (p) =>
  String(p || '')
    .replace(/^\\\\\?\\/, '')
    .replace(/[\\/]+$/, '')
    .toLowerCase();

const junctionTarget = (p) => {
  try {
    return readlinkSync(p).replace(/^\\\\\?\\/, '');
  } catch {
    return null;
  }
};

/** Codex 是否还在运行（迁移必须完全退出） */
function runningCodexProcesses() {
  try {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        "(Get-Process -Name 'ChatGPT','codex','codex-*' -ErrorAction SilentlyContinue | Measure-Object).Count",
      ],
      { encoding: 'utf8' },
    ).trim();
    return Number(out) || 0;
  } catch {
    return -1; // 查不到就返回 -1，由调用方决定是否放行
  }
}

function freeGB(drive) {
  try {
    const s = statfsSync(drive);
    return (s.bavail * s.bsize) / 1073741824;
  } catch {
    return null;
  }
}

function preconditions() {
  section('前置检查');
  const problems = [];
  const leftovers = [];

  // 先确认环境变量解析正确：在 Codex 自己的终端 / 沙箱终端里，APPDATA 之类可能是空或被重定向，
  // 那样会把真实目录误判成"不存在"而静默跳过。
  log(`  · 路径解析：USERPROFILE = ${HOME || '(空 ✗)'}`);
  log(`              APPDATA     = ${APPDATA || '(空 ✗)'}`);
  log(`              LOCALAPPDATA= ${LOCALAPPDATA || '(空 ✗)'}`);
  for (const [key, value] of [
    ['USERPROFILE', HOME],
    ['APPDATA', APPDATA],
    ['LOCALAPPDATA', LOCALAPPDATA],
  ]) {
    if (!value) {
      problems.push(
        `${key} 环境变量为空 —— 请在普通 PowerShell / Windows Terminal 中运行本脚本（不要在 Codex 终端或沙箱终端里）`,
      );
    }
  }

  const procs = runningCodexProcesses();
  if (procs < 0) {
    log('  · Codex 进程检查：无法查询 ✗（例如在 Codex 自己的终端里运行，进程查询会被限制）');
    if (!force) {
      problems.push(
        '无法确认 Codex 是否已退出，已拒绝执行。请在 Windows Terminal / PowerShell（不是 Codex 终端）里重新运行；' +
          '确认 Codex 确实已退出时可用 --force 跳过本检查',
      );
    }
  }
  else if (procs > 0) {
    log(`  · Codex 进程检查：仍有 ${procs} 个进程在运行 ✗`);
    problems.push('请先完全退出 Codex（托盘右键退出，或任务管理器结束所有 ChatGPT/codex 进程）');
  } else log('  · Codex 进程检查：已完全退出 ✓');

  if (!existsSync(TARGET_ROOT)) {
    log(`  · 目标根目录不存在，将创建：${TARGET_ROOT}`);
  } else {
    const kids = readdirSync(TARGET_ROOT);
    if (kids.length) log(`  · 目标根目录已有内容（${kids.length} 项）：同名子目录会被跳过以避免覆盖`);
    else log(`  · 目标根目录为空 ✓  ${TARGET_ROOT}`);
  }

  for (const m of MAPPINGS) {
    const state = pathState(m.src);
    if (state === 'missing') log(`  · 源不存在（将跳过）：${m.src}`);
    else if (state === 'denied') log(`  · ⚠ 无法访问（权限或终端视角受限，不代表不存在）：${m.src}`);
    else if (isReparse(m.src)) log(`  · 源已是联接（将跳过）：${m.src} → ${junctionTarget(m.src)}`);
    else if (m.probeOnly) log(`  · MSIX 数据（默认不迁移）：${m.src} —— 详见下方探测结果`);
    else if (existsSync(m.dst)) {
      // 应用更新可能把目录重建为真实目录，从而替换掉联接；此时 D: 上的旧副本会变成孤儿
      log(`  · ⚠ 疑似失效：「${m.name}」源是真实目录，但 D: 上已有同名副本`);
      log(`        若 D: 上那份是应用重建前的旧数据，先删除它以重跑迁移：${m.dst}`);
    }
    // 上次中断可能留下的暂存目录（迁移已完成、但原数据副本还没删掉）
    for (const p of [m.src + '.__migrating', m.src + '.__reverting']) {
      if (existsSync(p)) {
        const s = treeStats(p, true);
        log(`  · ⚠ 发现上次中断的残留：${p}`);
        log(`        ${s.files} 个文件 / ${mb(s.bytes)} MB（占用 C: 空间；内容已存在于 D: 或原路径）`);
        leftovers.push(p);
      }
    }
  }

  const c = freeGB('C:\\');
  const d = freeGB('D:\\');
  if (c !== null) log(`  · C: 可用 ${c.toFixed(1)} GB`);
  if (d !== null) log(`  · D: 可用 ${d.toFixed(1)} GB`);

  // MSIX 打包应用的数据有两份（真实路径 + 虚拟化副本），先报告事实，默认不动手
  const probes = MAPPINGS.filter((m) => m.probeOnly);
  if (probes.length) {
    section('MSIX 打包应用数据（默认不迁移、不删除）');
    for (const m of probes) {
      log(`  ${m.name}`);
      const state = pathState(m.src);
      if (state === 'exists') {
        const s = treeStats(m.src, true);
        log(`    真实路径  : ${m.src}`);
        log(`                ${s.files} 文件 / ${mb(s.bytes)} MB，最近改动 ${fmtTime(newestMtime(m.src))}`);
      } else if (state === 'denied') {
        log(`    真实路径  : 无法访问（权限或终端视角受限）：${m.src}`);
      } else {
        log(`    真实路径  : 不存在：${m.src}`);
      }
      const virt = findMsixCounterpart(m.virtualHint);
      let realNewest = 0;
      let virtNewest = 0;
      if (virt) {
        const s2 = treeStats(virt, true);
        log(`    虚拟化副本: ${virt}`);
        virtNewest = newestMtime(virt);
        log(`                ${s2.files} 文件 / ${mb(s2.bytes)} MB，最近改动 ${fmtTime(virtNewest)}`);
      } else {
        log('    虚拟化副本: 未找到（%LOCALAPPDATA%\\Packages\\OpenAI.Codex_*\\LocalCache 下）');
      }
      if (state === 'exists') realNewest = newestMtime(m.src);
      if (state === 'exists' && virt && realNewest && virtNewest) {
        const hours = Math.abs(realNewest - virtNewest) / 3600000;
        if (hours < 1) {
          log('    → 两份都在最近 1 小时内被写过，无法仅凭时间判定 → 请按 README「金丝雀测试」确认');
        } else if (realNewest > virtNewest) {
          log(`    → 真实路径更新（比虚拟化副本新约 ${hours.toFixed(1)} 小时）→ 疑似活数据；`);
          log('      金丝雀测试确认后可迁移：node migrate-codex-data.mjs --include-msix --apply');
        } else {
          log(`    → 虚拟化副本更新（比真实路径新约 ${hours.toFixed(1)} 小时）→ 真实路径疑似陈旧副本；`);
          log('      金丝雀测试确认应用不依赖它后，可直接删除回收空间：');
          log(`      Remove-Item -LiteralPath '${m.src}' -Recurse -Force`);
        }
      } else if (state === 'exists') {
        log('    → 无法与虚拟化副本比较 → 请按 README「金丝雀测试」确认后再决定迁移或删除');
      }
    }
  }

  return { problems, leftovers };
}

/** 迁移单个目录：复制 → 校验 → 原位置换成联接 → 删除暂存 */
function migrateOne(m) {
  section(`迁移 ${m.name}  (${m.src} → ${m.dst})`);

  const state = pathState(m.src);
  if (state === 'missing') return { skipped: `源不存在：${m.src}` };
  if (state === 'denied') return { skipped: `无法访问（权限或终端视角受限）：${m.src}` };
  if (m.probeOnly && !includeMsix) {
    return { skipped: 'MSIX 打包应用数据，默认不迁移（判定活数据后可用 --include-msix 迁移）' };
  }
  if (isReparse(m.src)) return { skipped: `已是联接，跳过（→ ${junctionTarget(m.src)}）` };
  if (existsSync(m.dst)) {
    return {
      skipped:
        `目标已存在，跳过以避免覆盖：${m.dst}` +
        '（若 D: 上那份是应用重建目录前的旧副本，请先删除它再重跑）',
    };
  }

  const before = treeStats(m.src, !apply);
  log(`  源：${m.src}`);
  log(`       ${before.files} 个文件 / ${mb(before.bytes)} MB`);
  log(`  目标：${m.dst}`);
  if (before.unreadable.length) {
    // 执行时这是硬性中止条件：说明应用没退干净，文件仍被占用
    log(`  ✗ 有 ${before.unreadable.length} 个子目录无法读取（应用可能仍在运行）`);
    for (const p of before.unreadable.slice(0, 3)) log(`      ${p}`);
    if (apply) throw new Error('源目录存在无法读取的子目录，请先完全退出 Codex 再重试');
  }
  if (!apply) {
    log('  [预演] 将执行：复制 → 校验文件数与字节数 → 原位置改名为 .__migrating → 建联接 → 删除暂存');
    return { planned: true, stats: before };
  }

  mkdirSync(TARGET_ROOT, { recursive: true });
  log('  · 复制中…');
  cpSync(m.src, m.dst, { recursive: true, preserveTimestamps: true, errorOnExist: true });

  const after = treeStats(m.dst);
  if (after.files !== before.files || after.bytes !== before.bytes) {
    rmSync(m.dst, { recursive: true, force: true });
    throw new Error(`校验失败（源 ${before.files}/${before.bytes} vs 目标 ${after.files}/${after.bytes}），已删除副本`);
  }
  log(`  · 校验通过：${after.files} 个文件 / ${mb(after.bytes)} MB`);

  const stash = m.src + '.__migrating';
  renameSync(m.src, stash); // 同卷改名，瞬间完成；被占用时会直接报错，等于多一层保护
  try {
    symlinkSync(m.dst, m.src, 'junction');
  } catch (err) {
    renameSync(stash, m.src); // 建联接失败 → 原样还原
    rmSync(m.dst, { recursive: true, force: true });
    throw new Error(`创建目录联接失败，已还原：${err.message}`);
  }
  const linked = junctionTarget(m.src);
  if (normPath(linked) !== normPath(m.dst)) {
    throw new Error(
      `联接指向不符：期望 ${m.dst}，实际 ${linked}。` +
        '联接本身已建立（迁移已生效），请先人工确认再决定是否回滚；下次运行会自动清理残留。',
    );
  }
  // 暂存目录里是刚搬走的原始数据，删除失败不影响迁移结果（联接已建好），只提示用户稍后清理
  try {
    rmSync(stash, { recursive: true, force: true });
  } catch (err) {
    log(`  ⚠ 暂存目录删除失败（可能仍被占用）：${stash}`);
    log(`     迁移本身已生效（联接可用）；请完全退出 Codex 后再删除它以释放空间。原因：${err.message}`);
  }
  log(`  ✓ 完成：${m.src} → ${m.dst}`);
  return { migrated: true, stats: after };
}

/** 回滚：删联接 → 数据搬回原位置 */
function revertOne(m) {
  section(`回滚 ${m.name}`);
  if (!existsSync(m.src) || !isReparse(m.src)) {
    log(`  · ${m.src} 不是联接，无需回滚`);
    return;
  }
  const linked = junctionTarget(m.src);
  log(`  当前联接：${m.src} → ${linked}`);
  if (!apply) {
    log('  [预演] 将执行：删除联接 → 把数据从 D: 搬回原路径');
    return;
  }
  if (!linked || !existsSync(linked)) {
    log(`  · 联接目标不存在，仅删除联接：${linked}`);
    rmSync(m.src, { recursive: true, force: true });
    return;
  }
  const stats = treeStats(linked);
  log(`  · 数据 ${stats.files} 个文件 / ${mb(stats.bytes)} MB，正在搬回…`);
  cpSync(linked, m.src + '.__reverting', { recursive: true, preserveTimestamps: true, errorOnExist: true });
  rmSync(m.src, { recursive: true, force: true }); // 删掉联接本身
  renameSync(m.src + '.__reverting', m.src);
  rmSync(linked, { recursive: true, force: true });
  log(`  ✓ 已回滚：${m.src}`);
}

function main() {
  log('Codex 数据迁移工具（目录联接方式，不改环境与配置）');
  log(`目标根目录：${TARGET_ROOT}`);
  log(`模式：${apply ? '执行（--apply）' : '预演（不改任何东西）'}`);

  if (revertAll || revertName) {
    const list = revertName ? MAPPINGS.filter((m) => m.name === revertName) : MAPPINGS;
    if (revertName && !list.length) {
      log(`\n找不到名为「${revertName}」的项。可选：${MAPPINGS.map((m) => m.name).join(', ')}`);
      process.exit(1);
    }
    for (const m of list) revertOne(m);
    log('\n回滚结束。');
    return;
  }

  const c0 = freeGB('C:\\');
  const { problems, leftovers } = preconditions();
  if (problems.length && apply) {
    log('');
    log('中止：前置条件不满足，未做任何修改。');
    for (const p of problems) log('  - ' + p);
    process.exit(1);
  }

  // 先清掉上次中断留下的暂存目录，避免它们继续占着 C: 空间
  if (leftovers.length) {
    section('清理上次中断的残留');
    for (const p of leftovers) {
      if (!apply) {
        log(`  [预演] 将删除：${p}`);
        continue;
      }
      try {
        const s = treeStats(p, true);
        rmSync(p, { recursive: true, force: true });
        log(`  ✓ 已删除 ${p}（释放约 ${mb(s.bytes)} MB）`);
      } catch (err) {
        log(`  ⚠ 删除失败：${p} —— ${err.message}`);
      }
    }
  }

  let planned = 0;
  let done = 0;
  let bytes = 0;
  try {
    for (const m of MAPPINGS) {
      const r = migrateOne(m);
      if (r.skipped) log(`  · 跳过：${r.skipped}`);
      else if (r.planned) {
        planned++;
        bytes += r.stats.bytes;
      } else if (r.migrated) {
        done++;
        bytes += r.stats.bytes;
      }
    }
  } catch (err) {
    log('');
    log('执行中断：' + err.message);
    log('提示：若上面提到"联接已建立"，说明该项迁移已生效，无需回滚；下次运行会自动清理残留。');
    log('已完成的部分保持有效；确实要回滚时用 --revert <名字> --apply，或 --revert-all --apply。');
    process.exit(1);
  }

  section('结果');
  log(`  ${apply ? '已迁移' : '计划迁移'} ${apply ? done : planned} 个目录，涉及 ${mb(bytes)} MB`);
  const c1 = freeGB('C:\\');
  if (c0 !== null && c1 !== null) log(`  C: 可用空间 ${c0.toFixed(1)} GB → ${c1.toFixed(1)} GB`);

  section('回滚方法');
  log('  单个目录：node migrate-codex-data.mjs --revert <名字> --apply');
  log('  全部回滚：node migrate-codex-data.mjs --revert-all --apply');
  log(`  可回滚的名字：${MAPPINGS.map((m) => m.name).join(', ')}`);

  if (!apply) {
    log('');
    log('以上为预演结果，没有改动任何文件。确认无误后执行：');
    log('  1) 完全退出 Codex（托盘右键退出 / 任务管理器结束所有 ChatGPT、codex 进程）');
    log('  2) node migrate-codex-data.mjs --apply');
  }
}

main();
