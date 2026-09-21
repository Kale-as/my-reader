/** 文本处理小工具。v1 会把 lemmaOf 换成 ECDICT + WordNet 词形还原。 */

export function firstWord(text: string): string {
  const m = text.match(/[A-Za-z][A-Za-z'’-]*/);
  return m ? m[0] : text.trim().slice(0, 32);
}

export function lookupKey(word: string): string {
  return word.toLowerCase().replace(/[^a-z'’-]/g, '');
}

const LEMMA_RULES: Array<[RegExp, string]> = [
  [/ies$/, 'y'],
  [/ves$/, 'f'],
  [/(?:ses|xes|zes|ches|shes)$/, ''],
  [/ing$/, ''],
  [/ed$/, ''],
  [/es$/, ''],
  [/s$/, ''],
  [/est$/, ''],
  [/er$/, ''],
];

/** 极简规则还原：只做去屈折，够生词本去重用；不规则动词（went/ran）留给 v1 的词典。 */
export function lemmaOf(word: string): string {
  const w = lookupKey(word);
  if (w.length <= 4) return w;

  for (const [re, replacement] of LEMMA_RULES) {
    if (!re.test(w)) continue;
    let base = w.replace(re, replacement);
    if (base.length < 3) continue;
    // running -> runn -> run
    if (/([bdfglmnprt])\1$/.test(base)) base = base.slice(0, -1);
    return base;
  }
  return w;
}

/** 从正文里截取包含 [index, index + length) 的那句话。 */
export function sentenceAround(text: string, index: number, length: number, maxLen = 360): string {
  if (!text) return '';
  const start = Math.max(0, Math.min(index, text.length));
  const end = Math.max(start, Math.min(index + length, text.length));

  let s = start;
  let e = end;
  while (s > 0 && !/[.!?。！？\n]/.test(text[s - 1])) s--;
  while (e < text.length && !/[.!?。！？\n]/.test(text[e])) e++;
  if (e < text.length) e++;

  let out = text.slice(s, e);
  if (out.length > maxLen) {
    const half = Math.floor(maxLen / 2);
    const mid = start - s;
    out = text.slice(s + Math.max(0, mid - half), s + Math.min(out.length, mid + half));
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** 在 pageText 里找到 selected 的位置，再扩成整句。找不到就退回选区本身。 */
export function contextFor(pageText: string, selected: string): string | undefined {
  const needle = selected.replace(/\s+/g, ' ').trim();
  if (!needle) return undefined;
  const flat = pageText.replace(/\s+/g, ' ');
  const idx = flat.indexOf(needle);
  if (idx < 0) return undefined;
  return sentenceAround(flat, idx, needle.length);
}
