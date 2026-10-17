// 敵意のあるフィードの内容（スクリプトや HTML を含む見出し・URL など）を画面に出しても、実行できるものが残らないことを確かめる。
// jsdom に実際の public/app.js を読み込み、描画関数に悪意のあるデータを直接渡す。
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
window.fetch = async () => ({ ok: true, json: async () => ({}), headers: new Map() });
window.IntersectionObserver = class { observe() {} };
window.matchMedia ??= () => ({ matches: false, addEventListener() {}, addListener() {} });
window.Element.prototype.scrollIntoView = () => {};
window.scrollTo = () => {};
window.localStorage.setItem('sivry:images', '1');
window.__pwned = 0;
// 「ページ内で実行されたら __pwned が増える」ペイロード
const P = [
  '<img src=x onerror="window.__pwned++">',
  '"><script>window.__pwned++</script>',
  '<svg onload="window.__pwned++">',
  "' onmouseover='window.__pwned++' x='",
  'javascript:window.__pwned++',
  '<a href="javascript:window.__pwned++">x</a>'
];
const src = (await readFile(path.join(root, 'i18n.js'), 'utf8')) + '\n' + (await readFile(path.join(root, 'app.js'), 'utf8'));
window.eval(src);
await window.i18nReady;

const items = P.map((p, i) => ({
  id: `a${i}`.padEnd(16, '0'), title: p, summary: p, sourceName: p, sourceType: 'official', subgroup: p, category: p, categories: [p],
  hashtags: [p], keywords: [p], publishedAt: new Date().toISOString(), imageUrl: i % 2 ? 'javascript:window.__pwned++' : `https://example.test/x.png?q=${encodeURIComponent(p)}"onerror="window.__pwned++`,
  sourceUrl: i % 2 ? 'javascript:window.__pwned++' : 'https://example.test/a', feedUrl: p,
  ai: { headlineJa: p, summary: p }, matches: [{ id: p, label: p, strength: 1, via: 'keyword' }]
}));
const out = window.eval('(items) => ({ list: renderItems(items, "", true).html, detail: null })');
const view = window.document.createElement('div');
view.innerHTML = out(items).list;
for (const item of items) {
  window.eval(`currentDetail = ${JSON.stringify({ id: item.id, item, content: { status: 'ok', paragraphs: [item.title], truncated: false, imageUrl: item.imageUrl }, summary: { headlineJa: item.title, summary: item.title, method: item.title }, summaryState: 'done', related: [item] })};`);
  window.eval('renderDetail()');
  view.append(window.document.getElementById('detailView').cloneNode(true));
}
const bad = [];
for (const el of view.querySelectorAll('*')) {
  const tag = el.tagName.toLowerCase();
  if (['script', 'svg', 'iframe', 'object', 'embed', 'style'].includes(tag)) bad.push(`<${tag}>`);
  for (const attr of el.attributes) {
    if (/^on/i.test(attr.name)) bad.push(`${tag}[${attr.name}]`);
    if (['href', 'src'].includes(attr.name) && /^\s*javascript:/i.test(attr.value)) bad.push(`${tag}[${attr.name}=javascript:]`);
  }
}
console.log(`描画した要素: ${view.querySelectorAll('*').length}、実行された数: ${window.__pwned}`);
if (bad.length || window.__pwned) {
  console.error('問題あり:', [...new Set(bad)].join(', ') || '(実行された)');
  process.exit(1);
}
console.log('敵意のあるデータでも、スクリプト・イベント属性・javascript: の URL は出力されません');
