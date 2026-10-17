// 「新着」の印と「ここまで」の表示、前回訪問の記録（30分以内の開き直しは同じ訪問）を確かめる。
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const src = (await readFile(path.join(root, 'i18n.js'), 'utf8')) + '\n' + (await readFile(path.join(root, 'app.js'), 'utf8'));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failures++; };

function open(storage) {
  const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = async () => ({ ok: true, json: async () => ({}), headers: new Map() });
  w.IntersectionObserver = class { observe() {} };
  w.matchMedia ??= () => ({ matches: false, addEventListener() {}, addListener() {} });
  w.Element.prototype.scrollIntoView = () => {};
  w.scrollTo = () => {};
  for (const [k, v] of Object.entries(storage)) w.localStorage.setItem(k, v);
  // const/let はスクリプトの外から見えないので、確かめたいものだけ window に出す
  w.eval(`${src}\nwindow.__t = { state, updateEndNote };`);
  return w;
}
const item = (id, hoursAgo) => ({ id: id.padEnd(16, '0'), title: id, summary: '', sourceName: 's', sourceType: 'official', subgroup: 'x', category: 'x', categories: ['x'], hashtags: [], keywords: [], publishedAt: new Date(Date.now() - hoursAgo * 3600e3).toISOString(), sourceUrl: 'https://example.test/', feedUrl: 'f', matches: [] });
const render = (w, items) => { const box = w.document.createElement('div'); box.innerHTML = w.eval('(items) => renderItems(items, "", false)')(items).html; return box.querySelectorAll('.new-badge').length; };

const items = [item('a', 1), item('b', 5), item('c', 30)];
const hour = 3600e3;

// 初めての訪問: 印は付けない
let w = open({});
check('初めての訪問では「新着」を付けない', render(w, items) === 0);

// 3時間前を最後に開いた（開き直しではない）→ 1時間前の記事だけが新着
const stamp = Date.now() - 3 * hour;
w = open({ 'sivry:visit': JSON.stringify({ prev: 0, current: stamp }) });
check('前回の訪問より後の記事だけに「新着」を付ける', render(w, items) === 1);
check('今回の訪問を記録する（次回の基準になる）', JSON.parse(w.localStorage.getItem('sivry:visit')).prev === stamp);

// 10分前に開いた → 同じ訪問として扱い、基準を動かさない
const earlier = Date.now() - 10 * 60e3;
w = open({ 'sivry:visit': JSON.stringify({ prev: stamp, current: earlier }) });
check('30分以内に開き直しても、基準（前回の訪問）を動かさない', JSON.parse(w.localStorage.getItem('sivry:visit')).prev === stamp && render(w, items) === 1);

// 壊れた保存データでも動く
w = open({ 'sivry:visit': '{broken' });
check('壊れた保存データでも落ちない', render(w, items) === 0);

// 「ここまで」の表示
w = open({});
w.__t.state.items = [1]; w.__t.state.total = 1; w.__t.updateEndNote();
check('最後まで表示したら「ここまで」を出す', w.document.getElementById('endNote').hidden === false);
w.__t.state.total = 5; w.__t.updateEndNote();
check('続きがあるうちは出さない', w.document.getElementById('endNote').hidden === true);
w.__t.state.items = []; w.__t.state.total = 0; w.__t.updateEndNote();
check('記事が0件のときは出さない', w.document.getElementById('endNote').hidden === true);

console.log(failures ? `失敗: ${failures}` : 'すべて成功');
process.exit(failures ? 1 : 0);
