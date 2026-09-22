// 诊断：Codex 桌面端「界面主体」为什么不是中文
//
// 背景（来自应用自身的代码与日志）：
//   界面多语言由服务端灰度开关 enable_i18n（statsig gate 72216192）控制，客户端默认值是 false；
//   开关数据来自 https://ab.chatgpt.com/v1/initialize。该请求失败时开关保持 false，
//   界面就固定用内置英文 —— 原生顶部菜单不受影响（它跟随系统语言，所以是中文）。
//   项目里的 [desktop].localeOverride 只是"偏好"，开关没打开时会被忽略。
//
// 用法：node check-codex-ui-lang.mjs
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOCAL = process.env.LOCALAPPDATA || '';
const PROFILE = process.env.USERPROFILE || '';
const logRoot = join(LOCAL, 'Codex', 'Logs');
const cfgPath = join(PROFILE, '.codex', 'config.toml');

function section(title) {
  console.log('');
  console.log(`=== ${title} ===`);
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (st.size > 0) out.push({ path: full, size: st.size, mtime: st.mtimeMs });
  }
  return out;
}

section('1. 本地语言设置');
if (existsSync(cfgPath)) {
  const line = readFileSync(cfgPath, 'utf8').split(/\r?\n/).find((l) => /^\s*localeOverride\s*=/.test(l));
  console.log(line ? `  config.toml : ${line.trim()}` : '  config.toml : 未设置 localeOverride');
} else {
  console.log('  找不到 config.toml');
}

section('2. 功能开关 enable_i18n 的初始化情况');
const files = walk(logRoot).sort((a, b) => b.mtime - a.mtime);
console.log(`  可用日志文件 : ${files.length} 个（取内容非空的最新 ${Math.min(files.length, 40)} 个）`);

const statsigErrors = [];
const disabledHits = [];
const routeStats = new Map();
let ok2xx = 0;

for (const f of files.slice(0, 40)) {
  const text = readFileSync(f.path, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    if (line.includes('Statsig: error')) statsigErrors.push(line.trim());
    if (line.includes('reason=statsig-disabled')) disabledHits.push(line.trim());
    const route = line.match(/routePattern=([^\s]+)/);
    const status = line.match(/\bstatus=(\d{3})/);
    if (route && status) {
      const key = `${route[1]}  status=${status[1]}`;
      routeStats.set(key, (routeStats.get(key) || 0) + 1);
      if (/^2/.test(status[1])) ok2xx++;
    }
  }
}

console.log(`  Statsig 初始化失败 : ${statsigErrors.length} 条`);
console.log(`  statsig-disabled   : ${disabledHits.length} 条（应用自报"开关未启用"）`);
for (const line of statsigErrors.slice(-2)) {
  console.log(`    ${line.replace(/\s+/g, ' ').slice(0, 200)}`);
}

section('3. 服务端请求状态分布');
const sorted = [...routeStats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
for (const [key, count] of sorted) console.log(`  ${String(count).padStart(6)} 次   ${key}`);
console.log(`  2xx 成功请求 : ${ok2xx} 次`);

section('4. 判定与下一步');
if (statsigErrors.length > 0 && ok2xx === 0) {
  console.log('  判定：界面无法本地化。开关数据源 ab.chatgpt.com 请求失败，');
  console.log('        enable_i18n 保持默认 false，本地 localeOverride 被忽略。');
  console.log('  下一步：让应用能访问 ab.chatgpt.com 与 ChatGPT 账号接口（系统代理 / VPN 走支持的地区），');
  console.log('          完全退出应用再启动，然后重跑本脚本，确认第 2、3 项是否变化。');
} else if (ok2xx > 0) {
  console.log('  判定：服务端可达。若界面仍是英文，说明 enable_i18n 尚未对该账号放量，');
  console.log('        属于服务端灰度，本地无法解决。');
} else {
  console.log('  判定：信息不足，请在应用运行一段时间后重跑。');
}
