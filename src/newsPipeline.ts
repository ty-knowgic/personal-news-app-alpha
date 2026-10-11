import Parser from 'rss-parser';
import type { FeedSource, NewsFilters, NewsItem } from './types.js';

const parser = new Parser();

export const officialFeeds: FeedSource[] = [
  {
    category: '政治',
    subgroup: '日本',
    sourceName: '首相官邸',
    sourceUrl: 'https://www.kantei.go.jp/',
    feedUrl: 'https://www.kantei.go.jp/jp/rss/rss.xml',
    label: '首相官邸 公式発表'
  },
  {
    category: '政治',
    subgroup: '日本',
    sourceName: '総務省',
    sourceUrl: 'https://www.soumu.go.jp/',
    feedUrl: 'https://www.soumu.go.jp/news.rdf',
    label: '総務省 ニュース'
  },
  {
    category: '経済',
    subgroup: '日本',
    sourceName: '日本銀行',
    sourceUrl: 'https://www.boj.or.jp/',
    feedUrl: 'https://www.boj.or.jp/xml/rss.xml',
    label: '日本銀行 公式発表'
  },
  {
    category: '経済',
    subgroup: '日本',
    sourceName: '財務省',
    sourceUrl: 'https://www.mof.go.jp/',
    feedUrl: 'https://www.mof.go.jp/english/news/rss.xml',
    label: '財務省 ニュース'
  },
  {
    category: '経済',
    subgroup: '日本',
    sourceName: '経済産業省',
    sourceUrl: 'https://www.meti.go.jp/',
    feedUrl: 'https://www.meti.go.jp/rss.xml',
    label: '経済産業省 ニュース'
  },
  {
    category: '社会',
    subgroup: '日本',
    sourceName: '厚生労働省',
    sourceUrl: 'https://www.mhlw.go.jp/',
    feedUrl: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/rss/news.xml',
    label: '厚生労働省 ニュース'
  },
  {
    category: '国際',
    subgroup: '海外',
    sourceName: '国連',
    sourceUrl: 'https://news.un.org/',
    feedUrl: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml',
    label: 'UN News'
  },
  {
    category: '経済',
    subgroup: '海外',
    sourceName: 'IMF',
    sourceUrl: 'https://www.imf.org/',
    feedUrl: 'https://www.imf.org/en/rss/IMF-Press-Releases?format=rss',
    label: 'IMF Press Releases'
  },
  {
    category: '経済',
    subgroup: '海外',
    sourceName: 'FRB',
    sourceUrl: 'https://www.federalreserve.gov/',
    feedUrl: 'https://www.federalreserve.gov/feeds/press_all.xml',
    label: 'Federal Reserve'
  },
  {
    category: '国際',
    subgroup: '海外',
    sourceName: 'WHO',
    sourceUrl: 'https://www.who.int/',
    feedUrl: 'https://www.who.int/feeds/entity/news/en/rss.xml',
    label: 'WHO News'
  }
];

const fallbackArticles: Omit<NewsItem, 'id'>[] = [
  {
    category: '経済',
    subgroup: '日本',
    title: '日本銀行が政策金利の判断材料を公表',
    summary: '日本銀行は政策金利に関する判断材料を公表した。現時点の枠組みと説明を要点化した。',
    publishedAt: '2026-10-11T09:00:00+09:00',
    sourceName: '日本銀行',
    sourceUrl: 'https://www.boj.or.jp/',
    feedUrl: 'https://www.boj.or.jp/xml/rss.xml',
    hashtags: ['#日本銀行', '#金利', '#金融政策'],
    keywords: ['日本銀行', '金利', '金融政策']
  },
  {
    category: '政治',
    subgroup: '日本',
    title: '首相官邸が政府の対応方針を発表',
    summary: '首相官邸は政府の対応方針を発表した。内容は公式発表に基づくもので、追加の見立ては含まない。',
    publishedAt: '2026-10-11T10:30:00+09:00',
    sourceName: '首相官邸',
    sourceUrl: 'https://www.kantei.go.jp/',
    feedUrl: 'https://www.kantei.go.jp/jp/rss/rss.xml',
    hashtags: ['#首相官邸', '#政府', '#政策'],
    keywords: ['首相官邸', '政府', '政策']
  },
  {
    category: '社会',
    subgroup: '日本',
    title: '厚生労働省が健康関連の公的情報を更新',
    summary: '厚生労働省は健康関連の公的情報を更新した。事実の整理に限定して掲載している。',
    publishedAt: '2026-10-11T11:15:00+09:00',
    sourceName: '厚生労働省',
    sourceUrl: 'https://www.mhlw.go.jp/',
    feedUrl: 'https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/rss/news.xml',
    hashtags: ['#厚生労働省', '#医療', '#健康'],
    keywords: ['厚生労働省', '医療', '健康']
  },
  {
    category: '国際',
    subgroup: '海外',
    title: '国連が人道・安全保障に関する公式発表を公開',
    summary: '国連は人道・安全保障に関する公式発表を公開した。本文を根拠に事実を簡潔に整理している。',
    publishedAt: '2026-10-11T12:05:00+09:00',
    sourceName: '国連',
    sourceUrl: 'https://news.un.org/',
    feedUrl: 'https://news.un.org/feed/subscribe/en/news/all/rss.xml',
    hashtags: ['#国連', '#安全保障', '#人道'],
    keywords: ['国連', '安全保障', '人道']
  },
  {
    category: '経済',
    subgroup: '海外',
    title: 'IMFが経済見通しに関する声明を発表',
    summary: 'IMFは経済見通しに関する声明を発表した。見通しと前提条件に関する記載を確認した。',
    publishedAt: '2026-10-11T13:00:00+09:00',
    sourceName: 'IMF',
    sourceUrl: 'https://www.imf.org/',
    feedUrl: 'https://www.imf.org/en/rss/IMF-Press-Releases?format=rss',
    hashtags: ['#IMF', '#経済見通し', '#金融'],
    keywords: ['IMF', '経済見通し', '金融']
  }
];

function trimSummary(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 100) {
    return normalized;
  }
  return `${normalized.slice(0, 97).trim()}…`;
}

function normalizeTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function buildHashtags(title: string, category: string, subgroup: string): string[] {
  const tokens = title
    .replace(/[、。！？]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(token => token.replace(/[()（）\[\]{}]/g, ''))
    .filter(token => token.length > 1);

  const keywordMap: Record<string, string[]> = {
    経済: ['経済', '金融', '成長'],
    社会: ['社会', '福祉', '医療'],
    国際: ['国際', '国連', '外交'],
    政治: ['政治', '政府', '政策']
  };

  const seed = [...(keywordMap[category] ?? []), ...tokens.slice(0, 3)];
  const unique = [...new Set(seed.map(item => `#${item}`))].slice(0, 3);

  if (unique.length === 0) {
    return [`#${subgroup}`, `#${category}`];
  }

  return unique;
}

function toNewsItem(entry: Omit<NewsItem, 'id'>, index: number): NewsItem {
  return {
    id: `${entry.category}-${entry.subgroup}-${index}-${Date.now()}`,
    ...entry,
    summary: trimSummary(entry.summary),
    hashtags: entry.hashtags.slice(0, 3),
    keywords: entry.keywords.slice(0, 3)
  };
}

async function fetchFeed(source: FeedSource): Promise<NewsItem[]> {
  try {
    const response = await fetch(source.feedUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) {
      return [];
    }

    const xml = await response.text();
    const parsed = await parser.parseString(xml);

    return (parsed.items ?? []).slice(0, 8).map((item, index) => {
      const title = normalizeTitle(item.title ?? '公式発表');
      const description = item.contentSnippet ?? item.content ?? title;
      const summary = trimSummary(description || title);
      const hashtags = buildHashtags(title, source.category, source.subgroup);

      return toNewsItem({
        category: source.category,
        subgroup: source.subgroup,
        title,
        summary,
        publishedAt: item.isoDate ?? new Date().toISOString(),
        sourceName: source.sourceName,
        sourceUrl: item.link ?? source.sourceUrl,
        feedUrl: source.feedUrl,
        hashtags,
        keywords: [source.category, source.subgroup, ...title.split(/\s+/).slice(0, 2)]
      }, index);
    });
  } catch {
    return [];
  }
}

export async function loadNews(): Promise<NewsItem[]> {
  const feedResults = await Promise.all(officialFeeds.map(fetchFeed));
  const collected = feedResults.flat();

  if (collected.length === 0) {
    return fallbackArticles.map((article, index) => toNewsItem(article, index));
  }

  const merged = [...collected, ...fallbackArticles.map((article, index) => toNewsItem(article, index))];
  const deduped = new Map<string, NewsItem>();

  for (const item of merged) {
    const key = `${item.title}-${item.sourceName}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()].sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()
  );
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
      ? [item.title, item.summary, ...item.keywords, ...item.hashtags].some(value =>
          value.toLowerCase().includes(keyword)
        )
      : true;

    return byCategory && bySubgroup && byKeyword;
  });
}
