// 生成可部署目录 dist/ —— 只包含该公开的文件。
// 整个应用就是一个 index.html，所以这个脚本的核心作用是「别把开发文件和日志一起发出去」。
//
// 用法：node build-dist.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, statSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const OUT = join(ROOT, 'dist');

// 递归删除前先确认目标就在工作区内，避免手滑删到别处
if (!OUT.startsWith(ROOT)) throw new Error('输出目录不在工作区内，已中止');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
writeFileSync(join(OUT, 'index.html'), html, 'utf8');

// 静态托管的响应头：Netlify 与 Cloudflare Pages 都认这个文件
writeFileSync(
  join(OUT, '_headers'),
  [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: no-referrer',
    '  Cache-Control: public, max-age=0, must-revalidate',
    '',
  ].join('\n'),
  'utf8',
);

const size = statSync(join(OUT, 'index.html')).size;
console.log(`已生成 dist/（${(size / 1024).toFixed(0)} KB）`);
for (const file of readdirSync(OUT)) console.log('  ' + file);
console.log('');
console.log('注意：dist/ 里只有网页本身，不含 serve.mjs / diag.log / 测试脚本 —— 这些不要上传。');
console.log('把 dist/ 目录拖到 Cloudflare Pages 或 Netlify，或者用 DEPLOY.md 里的 GitHub Pages 流程。');
