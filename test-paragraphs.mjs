// 用合成的 pdf.js 文本项验证 index.html 里的 PDF 段落合并逻辑。
// 之所以要抽出来测：这段是启发式规则，改坏了不会报错，只会让对照变乱。
import { readFileSync } from 'node:fs';

const lines = readFileSync('index.html', 'utf8').split('\n');
const start = lines.findIndex((l) => l.includes('function extractParagraphs(textContent, viewport) {'));
if (start < 0) throw new Error('没找到 extractParagraphs');
let end = -1;
for (let i = start + 1; i < lines.length; i++) {
  if (lines[i] === '        }') {
    end = i;
    break;
  }
}
if (end < 0) throw new Error('没找到函数结尾');

const fnText = lines.slice(start, end + 1).join('\n');
const hashId = (s) => 'h' + s.length + '_' + String(s).slice(0, 6);
const extractParagraphs = new Function('hashId', `return (${fnText});`)(hashId);

const viewport = {
  width: 612,
  height: 792,
  viewBox: [0, 0, 612, 792],
  scale: 1,
  convertToViewportPoint: (x, y) => [x, 792 - y],
};

/** 造一行：pdf.js 的每个 text item 带 transform[4]=x, transform[5]=y */
function line(str, x, y) {
  return { str, transform: [12, 0, 0, 12, x, y], width: str.length * 6.2, height: 12 };
}

function run(name, items, expectTexts) {
  const got = extractParagraphs({ items }, viewport).map((p) => p.text);
  const ok = JSON.stringify(got) === JSON.stringify(expectTexts);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}`);
  if (!ok) {
    console.log('  want:', JSON.stringify(expectTexts));
    console.log('  got :', JSON.stringify(got));
  }
  return ok;
}

let pass = true;

// 单栏：一段 4 行（末行短） + 一段 2 行
pass =
  run(
    '单栏 / 两个段落',
    [
      line('reading in a foreign', 72, 700),
      line('language is slow at first', 72, 688),
      line('but it gets much easier', 72, 676),
      line('with practice', 72, 664),
      line('the second paragraph', 72, 640),
      line('continues here', 72, 628),
    ],
    ['reading in a foreign language is slow at first but it gets much easier with practice', 'the second paragraph continues here'],
  ) && pass;

// 双栏：左栏 4 行、右栏 3 行，应按「先左栏后右栏」而不是交错
pass =
  run(
    '双栏 / 阅读顺序',
    [
      line('left column first line', 72, 700),
      line('left column second line', 72, 688),
      line('left column third line', 72, 676),
      line('left column last', 72, 664),
      line('right column first line', 320, 700),
      line('right column second line', 320, 688),
      line('right column third line', 320, 676),
    ],
    [
      'left column first line left column second line left column third line left column last',
      'right column first line right column second line right column third line',
    ],
  ) && pass;

// 行距一致、没有缩进时，应该是同一段
pass =
  run(
    '行距一致 / 段内合并',
    [line('it keeps going', 72, 700), line('on the same run', 72, 688), line('until the end', 72, 676)],
    ['it keeps going on the same run until the end'],
  ) && pass;

// 明显短的行 + 句末标点 = 段落结束
pass =
  run(
    '短行 + 句末标点 / 分段',
    [
      line('a short sentence.', 72, 700),
      line('and the next paragraph', 72, 688),
      line('continues right here', 72, 676),
    ],
    ['a short sentence.', 'and the next paragraph continues right here'],
  ) && pass;

// 首行缩进 = 新段落
pass =
  run(
    '首行缩进 / 分段',
    [
      line('first line of paragraph', 72, 700),
      line('continues without indent', 72, 688),
      line('still same paragraph', 72, 676),
      line('an indented new one', 86, 664),
      line('carries on here', 72, 652),
    ],
    [
      'first line of paragraph continues without indent still same paragraph',
      'an indented new one carries on here',
    ],
  ) && pass;

// 一行由多个 item 组成时要补空格；纯数字的页码属于噪声，不当作段落
pass =
  run(
    '同一行多 item / 页码过滤',
    [line('Introduction to', 72, 700), line('reading', 170, 700), line('42', 560, 700)],
    ['Introduction to reading'],
  ) && pass;

// 页面里只有图片、没有文字
pass = run('无文字层', [], []) && pass;

process.exit(pass ? 0 : 1);
