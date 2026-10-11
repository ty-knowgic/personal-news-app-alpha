import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Parser from 'rss-parser';
import { fetchArticleContent, isGenericImage } from './articleContent.js';
import { CATEGORIES, SUBGROUPS } from './types.js';
import type { CategoryKey, FeedSource, NewsFilters, NewsItem } from './types.js';

interface MediaField {
  $?: { url?: string; medium?: string; type?: string };
}

const parser = new Parser<Record<string, unknown>, { mediaContent?: MediaField; mediaThumbnail?: MediaField }>({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail']
    ]
  }
});

// 一部の公式サイト（FRB など）は簡易的な User-Agent を拒否するため、一般的なブラウザの値を送る
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ITEMS_PER_FEED = 20;
const ARCHIVE_DAYS = 30;
const ARCHIVE_LIMIT = 3000;
// フィードに画像がない記事のうち、新しい順にこの件数まで記事ページの画像を確認する
const IMAGE_ENRICH_LIMIT = 80;
const IMAGE_ENRICH_CONCURRENCY = 4;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARCHIVE_PATH = path.join(__dirname, '../data/news-archive.json');

// 2026-10 時点で取得できることを確認済みのフィード
export const officialFeeds: FeedSource[] = [
  // 政治
  { category: '政治', subgroup: '日本', sourceName: '首相官邸', sourceUrl: 'https://www.kantei.go.jp/', feedUrl: 'https://www.kantei.go.jp/index-jnews.rdf', label: '首相官邸 新着情報' },
  { category: '政治', subgroup: '日本', sourceName: '総務省', sourceUrl: 'https://www.soumu.go.jp/', feedUrl: 'https://www.soumu.go.jp/news.rdf', label: '総務省 報道資料' },
  { category: '政治', subgroup: '海外', sourceName: '米国務省', sourceUrl: 'https://www.state.gov/', feedUrl: 'https://www.state.gov/rss-feed/press-releases/feed/', label: 'U.S. Department of State Press Releases' },
  // 経済
  { category: '経済', subgroup: '日本', sourceName: '日本銀行', sourceUrl: 'https://www.boj.or.jp/', feedUrl: 'https://www.boj.or.jp/rss/whatsnew.xml', label: '日本銀行 新着情報' },
  { category: '経済', subgroup: '日本', sourceName: '財務省', sourceUrl: 'https://www.mof.go.jp/', feedUrl: 'https://www.mof.go.jp/news.rss', label: '財務省 新着情報' },
  { category: '経済', subgroup: '日本', sourceName: '経済産業省', sourceUrl: 'https://www.meti.go.jp/', feedUrl: 'https://www.meti.go.jp/ml_index_release_atom.xml', label: '経済産業省 ニュースリリース' },
  { category: '経済', subgroup: '日本', sourceName: '金融庁', sourceUrl: 'https://www.fsa.go.jp/', feedUrl: 'https://www.fsa.go.jp/fsaNewsListAll_rss2.xml', label: '金融庁 新着情報' },
  { category: '経済', subgroup: '海外', sourceName: 'FRB', sourceUrl: 'https://www.federalreserve.gov/', feedUrl: 'https://www.federalreserve.gov/feeds/press_all.xml', label: 'Federal Reserve Press Releases' },
  { category: '経済', subgroup: '海外', sourceName: 'ECB', sourceUrl: 'https://www.ecb.europa.eu/', feedUrl: 'https://www.ecb.europa.eu/rss/press.html', label: 'ECB Press' },
  // 投資（政府系の投資、スタートアップの資金調達）
  { category: '投資', subgroup: '日本', sourceName: 'GPIF', sourceUrl: 'https://www.gpif.go.jp/', feedUrl: 'https://www.gpif.go.jp/rss.xml', label: '年金積立金管理運用独立行政法人' },
  { matchOnly: ['投資', '生成AI'], subgroup: '日本', sourceName: 'PR TIMES', sourceUrl: 'https://prtimes.jp/', feedUrl: 'https://prtimes.jp/index.rdf', label: 'PR TIMES（企業の一次発表）' },
  { category: '投資', subgroup: '海外', sourceName: 'PR Newswire', sourceUrl: 'https://www.prnewswire.com/', feedUrl: 'https://www.prnewswire.com/rss/financial-services-latest-news/venture-capital-list.rss', label: 'PR Newswire Venture Capital（企業の一次発表）' },
  // 社会・国際
  { category: '社会', subgroup: '日本', sourceName: '厚生労働省', sourceUrl: 'https://www.mhlw.go.jp/', feedUrl: 'https://www.mhlw.go.jp/stf/news.rdf', label: '厚生労働省 新着情報' },
  { category: '社会', subgroup: '日本', sourceName: '文部科学省', sourceUrl: 'https://www.mext.go.jp/', feedUrl: 'https://www.mext.go.jp/b_menu/news/index.rdf', label: '文部科学省 新着情報' },
  { category: '社会', subgroup: '海外', sourceName: '米CDC', sourceUrl: 'https://www.cdc.gov/', feedUrl: 'https://tools.cdc.gov/api/v2/resources/media/132608.rss', label: 'CDC Newsroom' },
  { category: '国際', subgroup: '日本', sourceName: 'JETRO', sourceUrl: 'https://www.jetro.go.jp/', feedUrl: 'https://www.jetro.go.jp/rss/biznews.xml', label: 'JETRO ビジネス短信' },
  { category: '国際', subgroup: '海外', sourceName: 'WHO', sourceUrl: 'https://www.who.int/', feedUrl: 'https://www.who.int/rss-feeds/news-english.xml', label: 'WHO News' },
  { category: '国際', subgroup: '海外', sourceName: '欧州委員会', sourceUrl: 'https://ec.europa.eu/', feedUrl: 'https://ec.europa.eu/commission/presscorner/api/rss?language=en', label: 'European Commission Press Corner' },
  { category: '国際', subgroup: '海外', sourceName: '英国外務省', sourceUrl: 'https://www.gov.uk/', feedUrl: 'https://www.gov.uk/government/organisations/foreign-commonwealth-development-office.atom', label: 'UK Foreign, Commonwealth & Development Office' },
  // テクノロジー
  { category: 'テクノロジー', subgroup: '日本', sourceName: 'デジタル庁', sourceUrl: 'https://www.digital.go.jp/', feedUrl: 'https://www.digital.go.jp/rss/news.xml', label: 'デジタル庁 新着情報' },
  { category: 'テクノロジー', subgroup: '日本', sourceName: 'JST', sourceUrl: 'https://www.jst.go.jp/', feedUrl: 'https://www.jst.go.jp/rss/press.xml', label: '科学技術振興機構 プレスリリース' },
  { category: 'テクノロジー', subgroup: '海外', sourceName: 'NIST', sourceUrl: 'https://www.nist.gov/', feedUrl: 'https://www.nist.gov/news-events/news/rss.xml', label: 'NIST News' },
  { category: 'テクノロジー', subgroup: '海外', sourceName: 'NSF', sourceUrl: 'https://www.nsf.gov/', feedUrl: 'https://www.nsf.gov/rss/rss_www_news.xml', label: 'NSF News' },
  { category: 'テクノロジー', subgroup: '海外', sourceName: 'NVIDIA', sourceUrl: 'https://blogs.nvidia.com/', feedUrl: 'https://blogs.nvidia.com/feed/', label: 'NVIDIA Blog' },
  // 生成AI
  { category: '生成AI', subgroup: '日本', sourceName: 'Sakana AI', sourceUrl: 'https://sakana.ai/', feedUrl: 'https://sakana.ai/feed.xml', label: 'Sakana AI' },
  { category: '生成AI', subgroup: '海外', sourceName: 'OpenAI', sourceUrl: 'https://openai.com/', feedUrl: 'https://openai.com/news/rss.xml', label: 'OpenAI News' },
  { category: '生成AI', subgroup: '海外', sourceName: 'Google DeepMind', sourceUrl: 'https://deepmind.google/', feedUrl: 'https://deepmind.google/blog/rss.xml', label: 'Google DeepMind Blog' },
  { category: '生成AI', subgroup: '海外', sourceName: 'Google', sourceUrl: 'https://blog.google/', feedUrl: 'https://blog.google/technology/ai/rss/', label: 'Google AI Blog' }
];

// 見出しと説明文に含まれる語だけでカテゴリを追加する（推測による分類はしない）
const CATEGORY_RULES: { category: CategoryKey; pattern: RegExp; subgroup?: '日本' }[] = [
  {
    category: '生成AI',
    pattern: /生成\s?AI|生成ＡＩ|ChatGPT|LLM|大規模言語モデル|基盤モデル|AIエージェント|generative AI|\bGenAI\b|large language model|\bGPT-?\d|\bGemini\b|\bClaude\b|\bAI agents?\b|frontier (AI|model)|foundation models?/i
  },
  {
    category: '投資',
    pattern: /資金調達|第三者割当増資|シリーズ[A-FＡ-Ｆ](ラウンド)?|シードラウンド|プレシリーズ|ベンチャーキャピタル|スタートアップ(への)?(投資|出資|支援|育成)|出資(を受け|契約|決定)|官民ファンド|国内投資|投資促進|GX投資|対日投資|直接投資|設備投資|投資計画|\braise[sd]? \$|funding round|\bSeries [A-F]\b|seed (round|funding)|venture capital|growth equity/i
  },
  {
    category: '国際',
    pattern: /首脳|外相|外務大臣|国連|G7|G20|ASEAN|APEC|大使|国際機関|二国間/,
    subgroup: '日本'
  }
];

// 全フィードの取得に失敗し、蓄積データもない場合のみ表示するサンプル記事（実在の発表ではない）
const fallbackArticles: Omit<NewsItem, 'id'>[] = [
  {
    category: '経済',
    categories: ['経済'],
    subgroup: '日本',
    title: '日本銀行が政策金利の判断材料を公表',
    summary: '日本銀行は政策金利に関する判断材料を公表した。現時点の枠組みと説明を要点化した。',
    publishedAt: '2026-10-11T09:00:00+09:00',
    sourceName: '日本銀行',
    sourceUrl: 'https://www.boj.or.jp/',
    feedUrl: 'https://www.boj.or.jp/rss/whatsnew.xml',
    hashtags: ['#日本銀行', '#経済', '#日本'],
    keywords: ['日本銀行', '経済', '日本'],
    isSample: true
  },
  {
    category: '政治',
    categories: ['政治'],
    subgroup: '日本',
    title: '首相官邸が政府の対応方針を発表',
    summary: '首相官邸は政府の対応方針を発表した。内容は公式発表に基づくもので、追加の見立ては含まない。',
    publishedAt: '2026-10-11T10:30:00+09:00',
    sourceName: '首相官邸',
    sourceUrl: 'https://www.kantei.go.jp/',
    feedUrl: 'https://www.kantei.go.jp/index-jnews.rdf',
    hashtags: ['#首相官邸', '#政治', '#日本'],
    keywords: ['首相官邸', '政治', '日本'],
    isSample: true
  }
];

function trimSummary(value: string): string {
  const normalized = value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  if (normalized.length <= 100) {
    return normalized;
  }
  return `${normalized.slice(0, 99).trim()}…`;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function classify(source: FeedSource, title: string, summary: string): CategoryKey[] {
  const text = `${title} ${summary}`;
  const matched = CATEGORY_RULES
    .filter(rule => (!rule.subgroup || rule.subgroup === source.subgroup) && rule.pattern.test(text))
    .map(rule => rule.category);

  if (!source.category) {
    return matched.filter(category => source.matchOnly?.includes(category));
  }

  // 投資に該当する記事は経済から分けて扱う
  const base = matched.includes('投資') && source.category === '経済' ? [] : [source.category];
  const categories = [...new Set([...base, ...matched])];
  // 並び順を固定し、主カテゴリはフィードの既定カテゴリを優先する
  return categories.sort((a, b) =>
    a === source.category ? -1 : b === source.category ? 1 : CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b)
  );
}

// ハッシュタグは記事に含まれる事実（発信元・カテゴリ・地域）のみから作り、推測した語は加えない
function buildHashtags(sourceName: string, categories: CategoryKey[], subgroup: string): string[] {
  return [...new Set([sourceName, ...categories, subgroup])]
    .map(tag => `#${tag.replace(/\s+/g, '')}`)
    .slice(0, 3);
}

function makeId(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function absoluteUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function pickImage(item: Parser.Item & { mediaContent?: MediaField; mediaThumbnail?: MediaField }, base: string) {
  const enclosure = item.enclosure;
  const candidates = [
    enclosure && (enclosure.type?.startsWith('image/') || /\.(jpe?g|png|webp|gif)(\?|$)/i.test(enclosure.url))
      ? enclosure.url
      : undefined,
    item.mediaContent?.$?.medium === 'image' || item.mediaContent?.$?.type?.startsWith('image/') ||
    /\.(jpe?g|png|webp|gif)(\?|$)/i.test(item.mediaContent?.$?.url ?? '')
      ? item.mediaContent?.$?.url
      : undefined,
    item.mediaThumbnail?.$?.url
  ];
  return absoluteUrl(candidates.find(Boolean), base);
}

/** 記事の取得元設定（カテゴリ規則など）から、記事の分類関連の項目を組み立てる */
function finalizeItem(entry: Omit<NewsItem, 'id' | 'category' | 'categories' | 'hashtags' | 'keywords'>, categories: CategoryKey[]): NewsItem {
  return {
    id: makeId(`${entry.sourceName}|${entry.sourceUrl}|${entry.title}`),
    ...entry,
    summary: trimSummary(entry.summary),
    category: categories[0],
    categories,
    hashtags: buildHashtags(entry.sourceName, categories, entry.subgroup),
    keywords: [entry.sourceName, ...categories, entry.subgroup]
  };
}

// 総務省のように Shift_JIS で配信されるフィードがあるため、XML 宣言の encoding を見てデコードする
function decodeFeed(buffer: ArrayBuffer, contentType: string | null): string {
  const head = new TextDecoder('ascii').decode(buffer.slice(0, 200));
  const charset =
    head.match(/encoding=["']([\w-]+)["']/i)?.[1] ??
    contentType?.match(/charset=([\w-]+)/i)?.[1] ??
    'utf-8';

  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function toIsoDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function fetchFeed(source: FeedSource): Promise<NewsItem[]> {
  try {
    const response = await fetch(source.feedUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    if (!response.ok) {
      console.warn(`[feed] ${source.sourceName}: HTTP ${response.status}`);
      return [];
    }

    const xml = decodeFeed(await response.arrayBuffer(), response.headers.get('content-type'));
    const parsed = await parser.parseString(xml);
    const items: NewsItem[] = [];

    // フィードによっては新しい順に並んでいないため、日付順に並べ替えてから取り込む
    const sorted = [...(parsed.items ?? [])].sort(
      (a, b) => (Date.parse(b.isoDate ?? b.pubDate ?? '') || 0) - (Date.parse(a.isoDate ?? a.pubDate ?? '') || 0)
    );

    for (const item of sorted) {
      if (items.length >= ITEMS_PER_FEED) break;

      const title = normalizeTitle(item.title ?? '');
      const link = absoluteUrl(item.link, source.sourceUrl);
      const publishedAt = toIsoDate(item.isoDate ?? item.pubDate) ?? toIsoDate((item as { date?: string }).date);
      if (!title || !link || !publishedAt) continue;

      const description = trimSummary(item.contentSnippet ?? item.content ?? item.summary ?? '');
      const categories = classify(source, title, description);
      if (categories.length === 0) continue;

      items.push(finalizeItem({
        subgroup: source.subgroup,
        title,
        // 説明文が見出しと同じ場合は重複表示を避けるため空にする
        summary: description === title ? '' : description,
        publishedAt,
        sourceName: source.sourceName,
        sourceUrl: link,
        feedUrl: source.feedUrl,
        imageUrl: pickImage(item, link)
      }, categories));
    }

    return items;
  } catch (error) {
    console.warn(`[feed] ${source.sourceName}: ${(error as Error).message}`);
    return [];
  }
}

// 取得済みの記事をディスクに蓄積し、件数の少ないキーワード抽出カテゴリでも一定期間分を表示できるようにする
let archive: Map<string, NewsItem> | null = null;

async function loadArchive(): Promise<Map<string, NewsItem>> {
  if (archive) return archive;
  archive = new Map();

  try {
    const stored = JSON.parse(await readFile(ARCHIVE_PATH, 'utf8')) as NewsItem[];
    const feedsByUrl = new Map(officialFeeds.map(feed => [feed.feedUrl, feed]));

    for (const item of stored) {
      // フィード設定や分類規則が変わっても反映されるよう、現在の設定で分類し直す
      const source = feedsByUrl.get(item.feedUrl);
      if (!source) continue;
      const categories = classify(source, item.title, item.summary);
      if (categories.length === 0) continue;
      const refreshed = finalizeItem({ ...item, subgroup: source.subgroup, sourceName: source.sourceName }, categories);
      archive.set(refreshed.id, refreshed);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[archive] 読み込みに失敗しました: ${(error as Error).message}`);
    }
  }

  return archive;
}

function sortByDate(items: NewsItem[]): NewsItem[] {
  return items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

async function collectNews(): Promise<NewsItem[]> {
  const store = await loadArchive();
  const feedResults = await Promise.all(officialFeeds.map(fetchFeed));

  for (const item of feedResults.flat()) {
    // 再取得した記事でも、記事ページから取得済みの画像は引き継ぐ
    const existing = store.get(item.id);
    store.set(item.id, existing
      ? { ...item, imageUrl: item.imageUrl ?? existing.imageUrl, imageChecked: existing.imageChecked }
      : item);
  }

  const cutoff = Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  const kept = sortByDate([...store.values()])
    .filter(item => new Date(item.publishedAt).getTime() >= cutoff)
    .slice(0, ARCHIVE_LIMIT);

  store.clear();
  kept.forEach(item => store.set(item.id, item));
  dropSharedImages(kept);

  if (kept.length === 0) {
    return fallbackArticles.map(entry => ({ ...entry, id: makeId(`sample|${entry.title}`) }));
  }

  await saveArchive(kept);
  void enrichImages(kept);
  return kept;
}

async function saveArchive(items: NewsItem[]): Promise<void> {
  try {
    await mkdir(path.dirname(ARCHIVE_PATH), { recursive: true });
    await writeFile(ARCHIVE_PATH, JSON.stringify(items));
  } catch (error) {
    console.warn(`[archive] 保存に失敗しました: ${(error as Error).message}`);
  }
}

// 3件以上の記事で同じ画像が使われている場合は、サイト共通の既定画像とみなして表示しない
function dropSharedImages(items: NewsItem[]): void {
  const counts = new Map<string, number>();
  items.forEach(item => item.imageUrl && counts.set(item.imageUrl, (counts.get(item.imageUrl) ?? 0) + 1));
  items.forEach((item) => {
    if (item.imageUrl && ((counts.get(item.imageUrl) ?? 0) >= 3 || isGenericImage(item.imageUrl))) {
      item.imageUrl = undefined;
    }
  });
}

let enriching = false;

// 多くの公式フィードは画像を含まないため、記事ページの og:image を裏で取得して一覧のサムネイルに使う。
// 一覧の応答は待たせず、取得できた画像は次回以降の一覧に反映される
async function enrichImages(items: NewsItem[]): Promise<void> {
  if (enriching) return;
  enriching = true;

  try {
    const queue = items.filter(item => !item.imageUrl && !item.imageChecked && !item.isSample).slice(0, IMAGE_ENRICH_LIMIT);
    if (!queue.length) return;

    const workers = Array.from({ length: IMAGE_ENRICH_CONCURRENCY }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        const content = await fetchArticleContent(item.sourceUrl);
        // 通信エラーなど一時的な失敗は、次回の更新で再確認する
        if (content.status === 'unavailable' && content.reason && !content.reason.startsWith('HTTP')) continue;
        if (content.imageUrl && !isGenericImage(content.imageUrl)) {
          item.imageUrl = content.imageUrl;
        }
        item.imageChecked = true;
      }
    });
    await Promise.all(workers);
    dropSharedImages(items);
    await saveArchive(items);
  } catch (error) {
    console.warn(`[image] 画像の取得に失敗しました: ${(error as Error).message}`);
  } finally {
    enriching = false;
  }
}

let cache: { items: NewsItem[]; fetchedAt: number } | null = null;
let inFlight: Promise<NewsItem[]> | null = null;

export async function loadNews(): Promise<NewsItem[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return cache.items;
  }

  // 同時に来たリクエストで同じフィードを重複取得しない
  inFlight ??= collectNews()
    .then((items) => {
      // サンプル記事しか得られなかった場合はキャッシュせず、次回再取得する
      if (!items.every(item => item.isSample)) {
        cache = { items, fetchedAt: Date.now() };
      }
      return items;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function listCategoryGroups() {
  return CATEGORIES.map(category => ({ category, subgroups: [...SUBGROUPS] }));
}

export async function getNews(filters: NewsFilters = {}) {
  const allItems = await loadNews();

  return allItems.filter((item) => {
    const byCategory = filters.category ? item.categories.includes(filters.category as CategoryKey) : true;
    const bySubgroup = filters.subgroup ? item.subgroup === filters.subgroup : true;
    const keyword = filters.keyword?.trim().toLowerCase();
    const byKeyword = keyword
      ? [item.title, item.summary, item.sourceName, ...item.keywords, ...item.hashtags].some(value =>
          value.toLowerCase().includes(keyword)
        )
      : true;

    return byCategory && bySubgroup && byKeyword;
  });
}

export async function getNewsById(id: string): Promise<NewsItem | undefined> {
  const items = await loadNews();
  return items.find(item => item.id === id);
}
