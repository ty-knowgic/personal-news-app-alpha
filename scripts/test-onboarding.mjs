// 初回の質問（地域 → 分野 → テーマ）を実際の app.js でたどり、選んだテーマだけが有効なトピックとして保存されることを確かめる。
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const src = (await readFile(path.join(root, 'i18n.js'), 'utf8')) + '\n' + (await readFile(path.join(root, 'app.js'), 'utf8'));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failures++; };

const dom = new JSDOM(html, { url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true });
const w = dom.window;
let saved = null;
const profile = { onboarded: false, regions: [], categories: [], hiddenItems: [], excludedSources: [], topics: ['genai', 'health', 'space', 'local'].map(id => ({ id, label: id, enabled: false, keywords: [], weight: 1 })) };
const options = {
  regions: [{ value: '日本', sources: 3 }, { value: '米国', sources: 4 }],
  categories: [{ value: '経済', articles: 5 }, { value: 'テクノロジー', articles: 9 }],
  topics: [{ value: 'genai', label: '生成AI' }, { value: 'health', label: '医療・公衆衛生' }, { value: 'space', label: '宇宙・天文' }]
};
const respond = (body, extra = {}) => ({ ok: true, status: 200, json: async () => body, headers: new Map(), ...extra });
w.fetch = async (url, init = {}) => {
  if (url === '/api/profile') {
    if (init.method === 'PUT') { saved = JSON.parse(init.body); return respond(saved); }
    return respond(saved ?? profile);
  }
  if (url === '/api/options') return respond(options);
  if (url === '/api/filters') return respond({ categories: [], subgroups: {}, sourceTypes: [] });
  if (String(url).startsWith('/api/news')) return respond([], { headers: new Map([['X-Total-Count', '0']]) });
  if (url === '/api/briefing') return respond({ stories: [], storyCount: 0 });
  return respond({});
};
w.IntersectionObserver = class { observe() {} };
w.matchMedia ??= () => ({ matches: false, addEventListener() {}, addListener() {} });
w.Element.prototype.scrollIntoView = () => {};
w.scrollTo = () => {};
w.eval(src);
await w.i18nReady;
const until = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 20)); return cond(); };
const view = () => w.document.getElementById('onboardingView');
const click = el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
const next = () => view().querySelector('[data-action="next"]');

check('最初の質問が表示される', await until(() => view().querySelector('.choice-grid[data-kind="regions"]')));
check('何も選ばないと「次へ」は押せない', next().disabled === true);
click(view().querySelector('.choice[data-value="日本"]'));
check('選ぶと「次へ」が押せる', next().disabled === false);
click(next());
check('2つ目は分野', view().querySelector('.choice-grid[data-kind="categories"]') !== null && view().textContent.includes('2 / 3'));
click(view().querySelector('.choice[data-value="経済"]'));
click(next());
check('3つ目はテーマ（3問）', view().querySelector('.choice-grid[data-kind="topics"]') !== null && view().textContent.includes('3 / 3'));
check('テーマの名前が選択肢に出る', view().textContent.includes('医療・公衆衛生') && view().textContent.includes('宇宙'));
check('最後は「はじめる」', next().textContent.trim().length > 0 && !next().textContent.includes('次へ'));
click(view().querySelector('[data-action="back"]'));
check('「戻る」で1つ前の質問に戻る', view().querySelector('.choice-grid[data-kind="categories"]') !== null);
click(next());
click(view().querySelector('.choice[data-value="genai"]'));
click(view().querySelector('.choice[data-value="space"]'));
click(next());
check('保存される', await until(() => saved !== null));
check('選んだテーマだけが有効になる', saved?.topics.filter(t => t.enabled).map(t => t.id).join() === 'genai,space', JSON.stringify(saved?.topics.map(t => [t.id, t.enabled])));
check('選ばなかったトピックは無効のまま', saved?.topics.find(t => t.id === 'local').enabled === false && saved?.topics.find(t => t.id === 'health').enabled === false);
check('地域・分野が保存され、初回の質問は完了になる', saved?.onboarded === true && saved.regions.join() === '日本' && saved.categories.join() === '経済');

console.log(failures ? `失敗: ${failures}` : 'すべて成功');
process.exit(failures ? 1 : 0);
