import { createHash } from 'node:crypto';
import Parser from 'rss-parser';
import type { FeedSource, NewsFilters, NewsItem } from './types.js';

const parser = new Parser();

// 一部の公式サイト（FRB など）は簡易的な User-Agent を拒否するため、一般的なブラウザの値を送る
const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const ITEMS_PER_FEED = 10;

// 2026-10 時点で取得できることを確認済みのフィード
export const officialFeeds: FeedSource[] = [
  {
    category: '政治',
    subgroup: '日本',
    sourceName: '首相官邸',
    sourceUrl: 'https://www.kantei.go.jp/',
    feedUrl: 'https://www.kantei.go.jp/index-jnews.rdf',
    label: '首相官邸 新着情報'
  },
  {
    category: '政治',
    subgroup: '日本',
    sourceName: '総務省',
    sourceUrl: 'https://www.soumu.go.jp/',
    feedUrl: 'https://www.soumu.go.jp/news.rdf',
    label: '総務省 報道資料'
  },
  {
    category: '経済',
    subgroup: '日本',
    sourceName: '日本銀行',
    sourceUrl: 'https://www.boj.or.jp/',
    feedUrl: 'https://www.boj.or.jp/rss/whatsnew.xml',
    label: '日本銀行 新着情報'
  },
  {
    category: '経済',
    subgroup: '日本',
    sourceName: '財務省',
    sourceUrl: 'https://www.mof.go.jp/',
    feedUrl: 'https://www.mof.go.jp/news.rss',
    label: '財務省 新着情報'
  },
  {
    category: '経済',
    subgroup: '日本',
    sourceName: '経済産業省',
    sourceUrl: 'https://www.meti.go.jp/',
    feedUrl: 'https://www.meti.go.jp/ml_index_release_atom.xml',
    label: '経済産業省 ニュースリリース'
  },
  {
    category: '社会',
    subgroup: '日本',
    sourceName: '厚生労働省',
    sourceUrl: 'https://www.mhlw.go.jp/',
    feedUrl: 'https://www.mhlw.go.jp/stf/news.rdf',
    label: '厚生労働省 新着情報'
  },
  {
    category: '経済',
    subgroup: '海外',
    sourceName: 'FRB',
    sourceUrl: 'https://www.federalreserve.gov/',
    feedUrl: 'https://www.federalreserve.gov/feeds/press_all.xml',
    label: 'Federal Reserve Press Releases'
  },
  {
    category: '経済',
    subgroup: '海外',
    sourceName: 'ECB',
    sourceUrl: 'https://www.ecb.europa.eu/',
    feedUrl: 'https://www.ecb.europa.eu/rss/press.html',
    label: 'ECB Press'
  },
  {
    category: '国際',
    subgroup: '海外',
    sourceName: 'WHO',
    sourceUrl: 'https://www.who.int/',
    feedUrl: 'https://www.who.int/rss-feeds/news-english.xml',
    label: 'WHO News'
  },
  {
    category: '政治',
    subgroup: '海外',
    sourceName: '米国務省',
    sourceUrl: 'https://www.state.gov/',
    feedUrl: 'https://www.state.gov/rss-feed/press-releases/feed/',
    label: 'U.S. Department of State Press Releases'
  }
];

// 全フィードの取得に失敗した場合のみ表示するサンプル記事（実在の発表ではない）
const fallbackArticles: Omit<NewsItem, 'id'>[] = [
  {
    category: '経済',
    subgroup: '日本',
    title: '日本銀行が政策金利の判断材料を公表',
    summary: '日本銀行は政策金利に関する判断材料を公表した。現時点の枠組みと説明を要点化した。',
    publishedAt: '2026-10-11T09:00:00+09:00',
    sourceName: '日本銀行',
    sourceUrl: 'https://www.boj.or.jp/',
    feedUrl: 'https://www.boj.or.jp/rss/whatsnew.xml',
    hashtags: ['#日本銀行', '#金利', '#金融政策'],
    keywords: ['日本銀行', '金利', '金融政策'],
    isSample: true
  },
  {
    category: '政治',
    subgroup: '日本',
    title: '首相官邸が政府の対応方針を発表',
    summary: '首相官邸は政府の対応方針を発表した。内容は公式発表に基づくもので、追加の見立ては含まない。',
    publishedAt: '2026-10-11T10:30:00+09:00',
    sourceName: '首相官邸',
    sourceUrl: 'https://www.kantei.go.jp/',
    feedUrl: 'https://www.kantei.go.jp/index-jnews.rdf',
    hashtags: ['#首相官邸', '#政府', '#政策'],
    keywords: ['首相官邸', '政府', '政策'],
    isSample: true
  },
  {
    category: '社会',
    subgroup: '日本',
    title: '厚生労働省が健康関連の公的情報を更新',
    summary: '厚生労働省は健康関連の公的情報を更新した。事実の整理に限定して掲載している。',
    publishedAt: '2026-10-11T11:15:00+09:00',
    sourceName: '厚生労働省',
    sourceUrl: 'https://www.mhlw.go.jp/',
    feedUrl: 'https://www.mhlw.go.jp/stf/news.rdf',
    hashtags: ['#厚生労働省', '#医療', '#健康'],
    keywords: ['厚生労働省', '医療', '健康'],
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

// ハッシュタグは記事に含まれる事実（発信元・カテゴリ・地域）のみから作り、推測した語は加えない
function buildHashtags(source: FeedSource): string[] {
  return [...new Set([source.sourceName, source.category, source.subgroup])]
    .map(tag => `#${tag.replace(/\s+/g, '')}`)
    .slice(0, 3);
}

function makeId(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function toNewsItem(entry: Omit<NewsItem, 'id'>): NewsItem {
  return {
    id: makeId(`${entry.sourceName}|${entry.sourceUrl}|${entry.title}`),
    ...entry,
    summary: trimSummary(entry.summary),
    hashtags: entry.hashtags.slice(0, 3),
    keywords: entry.keywords.slice(0, 3)
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

    return (parsed.items ?? []).slice(0, ITEMS_PER_FEED).flatMap((item) => {
      const title = normalizeTitle(item.title ?? '');
      if (!title) return [];

      const description = item.contentSnippet ?? item.content ?? item.summary ?? '';
      const publishedAt = toIsoDate(item.isoDate ?? item.pubDate) ?? toIsoDate((item as { date?: string }).date);
      if (!publishedAt) return [];

      return [toNewsItem({
        category: source.category,
        subgroup: source.subgroup,
        title,
        summary: description === title ? '' : description,
        publishedAt,
        sourceName: source.sourceName,
        sourceUrl: item.link ?? source.sourceUrl,
        feedUrl: source.feedUrl,
        hashtags: buildHashtags(source),
        keywords: [source.sourceName, source.category, source.subgroup]
      })];
    });
  } catch (error) {
    console.warn(`[feed] ${source.sourceName}: ${(error as Error).message}`);
    return [];
  }
}

async function collectNews(): Promise<NewsItem[]> {
  const feedResults = await Promise.all(officialFeeds.map(fetchFeed));
  const collected = feedResults.flat();

  if (collected.length === 0) {
    return fallbackArticles.map(toNewsItem);
  }

  const deduped = new Map<string, NewsItem>();
  for (const item of collected) {
    if (!deduped.has(item.id)) {
      deduped.set(item.id, item);
    }
  }

  return [...deduped.values()].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
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
  return [
    { category: '経済', subgroups: ['日本', '海外'] },
    { category: '社会', subgroups: ['日本', '海外'] },
    { category: '国際', subgroups: ['日本', '海外'] },
    { category: '政治', subgroups: ['日本', '海外'] }
  ];
}

export async function getNews(filters: NewsFilters = {}) {
  const allItems = await loadNews();

  return allItems.filter((item) => {
    const byCategory = filters.category ? item.category === filters.category : true;
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
