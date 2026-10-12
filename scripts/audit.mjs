#!/usr/bin/env node
/**
 * 品質チェック: 起動中のアプリの API を読み、利用者の要望（一次情報だけ・関心に合う記事の量・
 * ブリーフィングの質・情報源の健全性）を満たしているかを数値で確かめ、問題を重大な順に並べる。
 * 使い方: npm run dev を起動した状態で npm run audit（別のアドレスは AUDIT_URL で指定）
 */

const BASE = (process.env.AUDIT_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
const DAY = 24 * 3_600_000;
const WEEK_DAYS = 7;

// 一次情報ではない（報道機関の）ドメイン・名称。情報源に紛れ込んでいないかを確かめる
const MEDIA_DOMAINS = ['cbc.ca', 'reuters.com', 'bloomberg.com', 'nikkei.com', 'nhk.or.jp', 'asahi.com', 'yomiuri.co.jp', 'mainichi.jp', 'theglobeandmail.com', 'thestar.com', 'ctvnews.ca', 'globalnews.ca', 'nytimes.com', 'wsj.com', 'ft.com', 'bbc.co.uk', 'bbc.com', 'cnn.com', 'quantamagazine.org', 'spectrum.ieee.org', 'techcrunch.com', 'theverge.com', 'wired.com', 'itmedia.co.jp', 'impress.co.jp'];
const isMedia = url => {
  try {
    const host = new URL(url).hostname;
    return MEDIA_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
};
const PR_WIRES = new Set(['PR TIMES', '@Press', 'PR Newswire', 'Cision Canada']);
// 利用者が特に重視する分野と地域（プロフィールの関心と合わせて、週あたりの最低件数を確かめる）
const FOCUS_CATEGORIES = ['生成AI', 'テクノロジー', 'サイエンス', '投資', '経済', '政治'];
const FOCUS_REGIONS = ['カナダ', '日本', '米国', '欧州'];
const MIN_PER_WEEK = { category: 10, cell: 3, topic: 5 };

async function getJson(path) {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return { body: await response.json(), headers: response.headers };
}

async function allNews(query = '') {
  const items = [];
  for (let offset = 0; ; offset += 200) {
    const { body, headers } = await getJson(`/api/news?limit=200&offset=${offset}${query}`);
    items.push(...body);
    if (items.length >= Number(headers.get('x-total-count') ?? 0) || !body.length) return items;
  }
}

const issues = [];
function issue(severity, area, message) {
  issues.push({ severity, area, message });
}

const [{ body: sources }, { body: profile }, { body: briefing }] = await Promise.all([
  getJson('/api/sources'), getJson('/api/profile'), getJson('/api/briefing')
]);
const [items, forYou] = await Promise.all([allNews(), allNews('&forYou=1')]);
const now = Date.now();
// 利用者が選んだ地域だけを確かめる（選んでいない地域の件数が0なのは正しい動作）
const regions = profile.regions?.length ? FOCUS_REGIONS.filter(region => profile.regions.includes(region)) : FOCUS_REGIONS;
const recent = items.filter(item => now - new Date(item.publishedAt).getTime() <= WEEK_DAYS * DAY);

// ---------- 1. 一次情報だけか ----------
for (const source of sources) {
  if (!['official', 'corporate', 'research', 'npo'].includes(source.sourceType)) issue(3, '一次情報', `${source.sourceName}: 種類 ${source.sourceType} は一次情報ではない`);
  if (isMedia(source.feedUrl ?? '') || isMedia(source.sourceUrl)) issue(3, '一次情報', `${source.sourceName}: 報道機関のサイト（${source.sourceUrl}）`);
}

// ---------- 2. 情報源の健全性 ----------
const newestBySource = new Map();
for (const item of [...items, ...forYou]) {
  const key = item.feedUrl;
  const time = new Date(item.publishedAt).getTime();
  if (!newestBySource.has(key) || newestBySource.get(key) < time) newestBySource.set(key, time);
}
for (const source of sources.filter(s => s.enabled && !s.outOfRegion)) {
  if (source.health && !source.health.ok) issue(2, '情報源', `${source.sourceName}（${source.label}）: 取得エラー ${source.health.error}`);
  else if (source.count === 0) {
    // フィードの最新記事が30日より前なら、更新が少ない情報源（不具合ではない）
    const newestEntry = source.health?.newestEntry ? new Date(source.health.newestEntry).getTime() : 0;
    if (newestEntry && now - newestEntry > 30 * DAY) issue(1, '情報源', `${source.sourceName}（${source.label}）: 更新が少ない（最新 ${Math.round((now - newestEntry) / DAY)}日前）`);
    // フィードに記事はあるが、分野の条件（企業活動・資金調達など）に合う記事がなかった
    else if (source.health?.ok && source.health.entries > 0) issue(1, '情報源', `${source.sourceName}（${source.label}）: フィードの${source.health.entries}件はいずれも対象外`);
    else issue(2, '情報源', `${source.sourceName}（${source.label}）: 30日間に取り込んだ記事が0件${source.health ? `（フィードの記事 ${source.health.entries}件）` : ''}`);
  }
  else {
    const newest = newestBySource.get(source.feedUrl);
    if (newest && now - newest > 21 * DAY) issue(1, '情報源', `${source.sourceName}（${source.label}）: 最新の記事が${Math.round((now - newest) / DAY)}日前`);
  }
}

// ---------- 3. 分野・地域ごとの量（直近1週間） ----------
const cell = (category, region) => recent.filter(item => item.categories.includes(category) && (!region || item.subgroup === region)).length;
const categories = profile.categories?.length ? profile.categories : FOCUS_CATEGORIES;
for (const category of FOCUS_CATEGORIES.filter(c => categories.includes(c))) {
  const total = cell(category);
  if (total < MIN_PER_WEEK.category) issue(2, '量', `${category}: 直近1週間で${total}件（目安 ${MIN_PER_WEEK.category}件以上）`);
  for (const region of regions) {
    const count = cell(category, region);
    if (count < MIN_PER_WEEK.cell) issue(1, '量', `${category}×${region}: 直近1週間で${count}件`);
  }
}

// ---------- 4. 関心トピックごとの量 ----------
const forYouRecent = forYou.filter(item => now - new Date(item.publishedAt).getTime() <= WEEK_DAYS * DAY);
for (const topic of profile.topics.filter(t => t.enabled && !t.boostOnly)) {
  const matched = forYouRecent.filter(item => item.matches?.some(match => match.id === topic.id));
  const strong = matched.filter(item => item.matches.some(match => match.id === topic.id && match.strength >= 0.75));
  if (strong.length < MIN_PER_WEEK.topic) issue(2, '関心', `${topic.label}: 直近1週間の強い一致 ${strong.length}件（一致 ${matched.length}件）`);
}

// ---------- 5. ブリーフィング ----------
const stories = briefing.stories ?? [];
if (stories.length < 5) issue(2, 'ブリーフィング', `話題が${stories.length}件（5件に満たない）`);
if (briefing.windowHours > 24) issue(1, 'ブリーフィング', `直近24時間では5件そろわず、${briefing.windowHours}時間に広げている`);
const wireCount = stories.filter(story => PR_WIRES.has(story.sourceName)).length;
if (wireCount >= 2) issue(2, 'ブリーフィング', `${stories.length}件中${wireCount}件がプレスリリース配信サービス（${stories.filter(s => PR_WIRES.has(s.sourceName)).map(s => s.title.slice(0, 24)).join(' / ')}）`);
const sourceNames = new Set(stories.map(story => story.sourceName));
if (stories.length >= 3 && sourceNames.size < stories.length - 1) issue(1, 'ブリーフィング', `同じ発信元が重複（${[...sourceNames].join('・')}）`);
const noLine = stories.filter(story => !story.line || story.line.length < 20).length;
if (noLine) issue(1, 'ブリーフィング', `${noLine}件に説明文がない`);

// ---------- 6. 一覧の説明文 ----------
const top = forYou.slice(0, 50);
const withoutText = top.filter(item => (item.ai?.summary ?? item.summary ?? '').length < 40);
if (withoutText.length > 10) issue(1, '要約', `マイニュース上位50件のうち${withoutText.length}件に説明文・要約がほぼない（${[...new Set(withoutText.map(item => item.sourceName))].slice(0, 6).join('・')}）`);

// ---------- 出力 ----------
const LABEL = { 3: '重大', 2: '要対応', 1: '注意' };
issues.sort((a, b) => b.severity - a.severity || a.area.localeCompare(b.area));
console.log(`品質チェック ${new Date().toLocaleString('ja-JP')}  記事 ${items.length}件（直近1週間 ${recent.length}件）・情報源 ${sources.length}件・マイニュース ${forYou.length}件`);
console.log('\n分野×地域（直近1週間）');
console.log(['', ...regions, '計'].join('\t'));
for (const category of categories) console.log([category, ...regions.map(region => cell(category, region)), cell(category)].join('\t'));
console.log('\nブリーフィング');
for (const story of stories) console.log(`  - [${story.sourceName}] ${story.title.slice(0, 60)} (${story.matches.map(m => m.label).join(',')})`);
console.log(`\n問題 ${issues.length}件（重大 ${issues.filter(i => i.severity === 3).length}・要対応 ${issues.filter(i => i.severity === 2).length}・注意 ${issues.filter(i => i.severity === 1).length}）`);
for (const { severity, area, message } of issues) console.log(`  [${LABEL[severity]}] ${area}: ${message}`);
if (process.argv.includes('--samples')) {
  console.log('\nマイニュース上位20件（目視確認用）');
  for (const item of forYou.slice(0, 20)) console.log(`  - [${item.sourceName}] ${item.title.slice(0, 70)} (${item.matches.map(m => `${m.label}${m.via === 'semantic' ? '≈' : ''}`).join(',')})`);
}
