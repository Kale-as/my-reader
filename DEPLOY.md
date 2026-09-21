# 部署到网页

这个阅读器是**纯静态**的：只有一个 `index.html`，没有后端、没有数据库、不上传任何文件。
所以任何静态托管都能跑，而且不需要服务器。

## 第 0 步：生成可部署目录

```bash
node build-dist.mjs
```

会生成 `dist/`，里面**只有**网页本身：

```
dist/
  index.html   ← 全部功能都在这一个文件里
  _headers     ← 静态托管的响应头（Netlify / Cloudflare Pages 识别）
```

**不要**把整个工作区上传：`diag.log` 里记录着你的书名和访问路径，`serve.mjs` /
`check-syntax.mjs` / `test-paragraphs.mjs` 是开发用的，公网上没有意义。

## 方式一：Cloudflare Pages（推荐，国内访问相对稳）

1. 打开 <https://pages.cloudflare.com>，登录后选 **Create a project → Direct Upload**；
2. 把 `dist/` 文件夹整个拖进去；
3. 部署完会给你一个 `https://xxx.pages.dev` 的地址，直接能用。

想自动更新就把仓库连上，构建命令留空、输出目录填 `dist`（本仓库已经带了
`.github/workflows/deploy-pages.yml`，也可以走 GitHub Pages 那条路）。

## 方式二：Netlify

1. 打开 <https://app.netlify.com/drop>，把 `dist/` 拖进去；
2. 立刻得到 `https://xxx.netlify.app`。

## 方式三：GitHub Pages（仓库里已配好工作流）

```bash
git init
git add .
git commit -m "在线阅读器"
git branch -M main
git remote add origin git@github.com:<你的用户名>/<仓库名>.git
git push -u origin main
```

然后到仓库 **Settings → Pages → Source** 选 **GitHub Actions**。
之后每次推 `main`，工作流会自动 `node build-dist.mjs` 并发布 `dist/`，
发布前还会跑一遍语法与元素 id 校验。

> `.gitignore` 已经把 `dist/`、`diag.log` 排除在版本库之外。

## 方式四：自己的服务器（nginx）

把 `dist/index.html` 丢到站点目录即可：

```nginx
server {
    listen 443 ssl;
    server_name reader.example.com;
    root /var/www/reader;
    index index.html;

    add_header X-Content-Type-Options nosniff;
    add_header Referrer-Policy no-referrer;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

一定要有 **HTTPS**：不是 https（也不是 localhost）时，浏览器会限制 IndexedDB、
WASM、剪贴板这些能力，OCR 和书架都会不正常。

## 部署后必须知道的几件事

### 1. 书架和设置是跟域名走的

书籍存在浏览器 IndexedDB 里，**按域名隔离**。所以：

- 在 `localhost:8000` 导入的书，部署后访问线上地址**看不到**，需要重新导入一次；
- 翻译设置里的 API Key、主题、行距等也存在本地，同样要重新设置一遍；
- 同一台电脑、同一个浏览器、同一个域名，才会看到同一份数据。

### 2. 用户文件不会上传，也不会共享

导入的 PDF / EPUB 只写进访问者自己浏览器的 IndexedDB，服务器（静态托管）只会
把 `index.html` 这个文件发出去。换句话说：**你的站点不存储、也看不到用户的任何书**，
同时也不消耗你的存储和带宽（书籍文件不经过服务器）。

### 3. 首次打开需要联网

页面从 CDN 拉 4 个库：pdf.js、epub.js、jszip、tesseract.js（点 OCR 时才拉）。
如果面向国内用户、jsdelivr 不稳，可以把这些文件下载到本地，然后改 `index.html`
顶部那几处集中配置（都在内联脚本开头）：

| 数组 | 对应依赖 |
| --- | --- |
| `PDFJS_CDNS` | pdf.js（含 `pdf.worker.min.mjs` 与 `standard_fonts/`） |
| `EPUB_CDNS` | epub.js |
| `JSZIP_CDNS` | jszip（epub.js 依赖它解压） |
| `TESSERACT_CDNS` | tesseract.js 与 tesseract.js-core |
| `tessPaths.langPath` | OCR 语言模型（`eng.traineddata.gz` 等） |

把地址改成本地相对路径即可，例如 `./vendor/`。这些数组本来就是「依次尝试」的
列表，加在第一个位置最省事。

### 4. OCR 的模型下载走 CDN

第一次识别会下载语言模型（英文约 10MB、中英混合约 30MB），由访问者的浏览器直接从
CDN 取，不经过你的服务器。想省掉这一步也可以把模型放到自己的站点，改 `tessPaths.langPath`。

### 5. 调试用的诊断上报已自动关闭

页面里的 `diag()` 只在 `localhost` / `127.0.0.1` 下上报，线上不会发出任何请求；
`?diag=1`、`?ui=1` 这些调试参数在线上依然可用，但只会把结果留在浏览器控制台。

## 一句话总结

```bash
node build-dist.mjs        # 生成 dist/
# 把 dist/ 拖到 Cloudflare Pages 或 Netlify → 完事
```
