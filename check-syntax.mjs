// 临时校验脚本：抽出 index.html 里的内联模块脚本做语法检查，用完即删。
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const target = process.argv[2] || 'index.html';
const html = readFileSync(target, 'utf8');
const scripts = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
if (!scripts.length) throw new Error('没找到内联模块脚本');

let failed = false;
for (const [i, m] of scripts.entries()) {
  const file = join(process.cwd(), `.reader-inline-${i}.mjs`);
  writeFileSync(file, m[1], 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`脚本 #${i}（${m[1].length} 字符）语法 OK`);
  } catch (err) {
    failed = true;
    console.error(`脚本 #${i} 语法错误：`);
    console.error(String(err.stderr || err.message));
  } finally {
    rmSync(file, { force: true });
  }
}

console.log(`校验对象：${target}`);

for (const marker of ['@SECTION', 'README_PLACEHOLDER']) {
  if (html.includes(marker)) {
    failed = true;
    console.error(`还有没替换的占位符：${marker}`);
  }
}

// 检查脚本里引用的元素 id 是否都在 HTML 中定义（拼错 id 是运行时才炸的低级错误）
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const script = scripts.map((m) => m[1]).join('\n');
const refs = new Set([
  ...[...script.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]),
  ...[...script.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)].map((m) => m[1]),
]);
// rd-bi-style 是运行时注入到 EPUB iframe 里的，不在主文档中
const DYNAMIC_IDS = new Set(['rd-bi-style', 'bubble-zh', 'pop-zh', 'side-list']);
const missing = [...refs].filter((id) => !ids.has(id) && !DYNAMIC_IDS.has(id));
if (missing.length) {
  failed = true;
  console.error('引用了不存在的元素 id：' + missing.join(', '));
} else {
  console.log(`元素 id 引用检查通过（${refs.size} 个引用 / ${ids.size} 个定义）`);
}

process.exit(failed ? 1 : 0);
