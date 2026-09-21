// 本地开发服务器：静态文件 + 诊断收集。
// 配合 index.html 里的 diag()：页面把关键事件 POST 到 /diag，落到 diag.log，
// 这样就可以在浏览器之外看到真实环境里发生了什么（例如某个 CDN 拉不到）。
import { createServer } from 'node:http';
import { readFile, appendFile, stat, rm } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 8000);
const LOG = join(ROOT, 'diag.log');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (req.method === 'POST' && url.pathname === '/diag') {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 200000) req.destroy();
    });
    req.on('end', async () => {
      try {
        await appendFile(LOG, body.trim() + '\n', 'utf8');
      } catch (err) {
        console.error('写日志失败', err);
      }
      res.writeHead(204).end();
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/diag-log') {
    try {
      const text = await readFile(LOG, 'utf8');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(text);
    } catch {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end('(暂无诊断数据)');
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/diag-clear') {
    await rm(LOG, { force: true });
    res.writeHead(204).end();
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const file = normalize(join(ROOT, pathname));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    await stat(file);
    const buf = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store', // 改完刷新就能生效，不会被缓存坑
    }).end(buf);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`serving ${ROOT}`);
  console.log(`http://127.0.0.1:${PORT}/index.html`);
  console.log(`诊断日志：http://127.0.0.1:${PORT}/diag-log`);
});
