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

const parser = new Parser<Record<string, unknown>, { mediaContent?: MediaField; mediaThumbnail?: MediaField; language?: string }>({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail'],
      ['dc:language', 'language']
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
  { sourceType: 'official', category: '政治', subgroup: '日本', sourceName: '首相官邸', sourceUrl: 'https://www.kantei.go.jp/', feedUrl: 'https://www.kantei.go.jp/index-jnews.rdf', label: '首相官邸 新着情報' },
  { sourceType: 'official', category: '政治', subgroup: '日本', sourceName: '総務省', sourceUrl: 'https://www.soumu.go.jp/', feedUrl: 'https://www.soumu.go.jp/news.rdf', label: '総務省 報道資料' },
  { sourceType: 'official', category: '政治', subgroup: '海外', sourceName: '米国務省', sourceUrl: 'https://www.state.gov/', feedUrl: 'https://www.state.gov/rss-feed/press-releases/feed/', label: 'U.S. Department of State Press Releases' },
  // 経済（公的機関）: 発表量が多く定型的なお知らせも多いため、件数を抑えて定型告知を除外する
  { sourceType: 'official', category: '経済', subgroup: '日本', sourceName: '日本銀行', sourceUrl: 'https://www.boj.or.jp/', feedUrl: 'https://www.boj.or.jp/rss/whatsnew.xml', label: '日本銀行 新着情報', maxItems: 6, excludeRoutine: true },
  { sourceType: 'official', category: '経済', subgroup: '日本', sourceName: '財務省', sourceUrl: 'https://www.mof.go.jp/', feedUrl: 'https://www.mof.go.jp/news.rss', label: '財務省 新着情報', maxItems: 6, excludeRoutine: true },
  { sourceType: 'official', category: '経済', subgroup: '日本', sourceName: '経済産業省', sourceUrl: 'https://www.meti.go.jp/', feedUrl: 'https://www.meti.go.jp/ml_index_release_atom.xml', label: '経済産業省 ニュースリリース', maxItems: 8, excludeRoutine: true },
  { sourceType: 'official', category: '経済', subgroup: '日本', sourceName: '金融庁', sourceUrl: 'https://www.fsa.go.jp/', feedUrl: 'https://www.fsa.go.jp/fsaNewsListAll_rss2.xml', label: '金融庁 新着情報', maxItems: 6, excludeRoutine: true },
  { sourceType: 'official', category: '経済', subgroup: '日本', sourceName: 'JPX', sourceUrl: 'https://www.jpx.co.jp/', feedUrl: 'https://www.jpx.co.jp/rss/jpx-news.xml', label: '日本取引所グループ ニュース' },
  { sourceType: 'official', category: '経済', subgroup: '海外', sourceName: 'FRB', sourceUrl: 'https://www.federalreserve.gov/', feedUrl: 'https://www.federalreserve.gov/feeds/press_all.xml', label: 'Federal Reserve Press Releases', maxItems: 6 },
  { sourceType: 'official', category: '経済', subgroup: '海外', sourceName: 'ECB', sourceUrl: 'https://www.ecb.europa.eu/', feedUrl: 'https://www.ecb.europa.eu/rss/press.html', label: 'ECB Press', maxItems: 6 },
  // 経済（企業の発表）: 提携・買収・決算・事業展開・事故や不祥事など、企業活動に関するプレスリリース
  { sourceType: 'corporate', matchOnly: ['経済', '投資', '生成AI'], subgroup: '日本', sourceName: 'PR TIMES', sourceUrl: 'https://prtimes.jp/', feedUrl: 'https://prtimes.jp/index.rdf', label: 'PR TIMES（企業の一次発表）' },
  { sourceType: 'corporate', matchOnly: ['経済', '投資', '生成AI'], subgroup: '日本', sourceName: '@Press', sourceUrl: 'https://www.atpress.ne.jp/', feedUrl: 'https://www.atpress.ne.jp/rss/index.rdf', label: '@Press（企業の一次発表）' },
  { sourceType: 'corporate', category: '経済', subgroup: '海外', sourceName: 'PR Newswire', sourceUrl: 'https://www.prnewswire.com/', feedUrl: 'https://www.prnewswire.com/rss/financial-services-latest-news/earnings-list.rss', label: 'PR Newswire 決算発表', languages: ['en'] },
  { sourceType: 'corporate', matchOnly: ['経済', '投資', '生成AI'], subgroup: '海外', sourceName: 'PR Newswire', sourceUrl: 'https://www.prnewswire.com/', feedUrl: 'https://www.prnewswire.com/rss/financial-services-latest-news/mergers-and-acquisitions-list.rss', label: 'PR Newswire M&A', languages: ['en'] },
  { sourceType: 'corporate', matchOnly: ['経済', '投資', '生成AI'], subgroup: '海外', sourceName: 'PR Newswire', sourceUrl: 'https://www.prnewswire.com/', feedUrl: 'https://www.prnewswire.com/rss/general-business-latest-news/general-business-latest-news-list.rss', label: 'PR Newswire 一般ビジネス', languages: ['en'] },
  // 投資（政府系の投資、スタートアップの資金調達）
  { sourceType: 'official', category: '投資', subgroup: '日本', sourceName: 'GPIF', sourceUrl: 'https://www.gpif.go.jp/', feedUrl: 'https://www.gpif.go.jp/rss.xml', label: '年金積立金管理運用独立行政法人' },
  { sourceType: 'corporate', category: '投資', subgroup: '海外', sourceName: 'PR Newswire', sourceUrl: 'https://www.prnewswire.com/', feedUrl: 'https://www.prnewswire.com/rss/financial-services-latest-news/venture-capital-list.rss', label: 'PR Newswire Venture Capital（企業の一次発表）', languages: ['en'] },
  // 社会・国際
  { sourceType: 'official', category: '社会', subgroup: '日本', sourceName: '厚生労働省', sourceUrl: 'https://www.mhlw.go.jp/', feedUrl: 'https://www.mhlw.go.jp/stf/news.rdf', label: '厚生労働省 新着情報' },
  { sourceType: 'official', category: '社会', subgroup: '日本', sourceName: '文部科学省', sourceUrl: 'https://www.mext.go.jp/', feedUrl: 'https://www.mext.go.jp/b_menu/news/index.rdf', label: '文部科学省 新着情報' },
  { sourceType: 'official', category: '社会', subgroup: '海外', sourceName: '米CDC', sourceUrl: 'https://www.cdc.gov/', feedUrl: 'https://tools.cdc.gov/api/v2/resources/media/132608.rss', label: 'CDC Newsroom' },
  { sourceType: 'official', category: '国際', subgroup: '日本', sourceName: 'JETRO', sourceUrl: 'https://www.jetro.go.jp/', feedUrl: 'https://www.jetro.go.jp/rss/biznews.xml', label: 'JETRO ビジネス短信' },
  { sourceType: 'official', category: '国際', subgroup: '海外', sourceName: 'WHO', sourceUrl: 'https://www.who.int/', feedUrl: 'https://www.who.int/rss-feeds/news-english.xml', label: 'WHO News' },
  { sourceType: 'official', category: '国際', subgroup: '海外', sourceName: '欧州委員会', sourceUrl: 'https://ec.europa.eu/', feedUrl: 'https://ec.europa.eu/commission/presscorner/api/rss?language=en', label: 'European Commission Press Corner' },
  { sourceType: 'official', category: '国際', subgroup: '海外', sourceName: '英国外務省', sourceUrl: 'https://www.gov.uk/', feedUrl: 'https://www.gov.uk/government/organisations/foreign-commonwealth-development-office.atom', label: 'UK Foreign, Commonwealth & Development Office' },
  // テクノロジー
  { sourceType: 'official', category: 'テクノロジー', subgroup: '日本', sourceName: 'デジタル庁', sourceUrl: 'https://www.digital.go.jp/', feedUrl: 'https://www.digital.go.jp/rss/news.xml', label: 'デジタル庁 新着情報' },
  { sourceType: 'official', category: 'テクノロジー', subgroup: '日本', sourceName: 'JST', sourceUrl: 'https://www.jst.go.jp/', feedUrl: 'https://www.jst.go.jp/rss/press.xml', label: '科学技術振興機構 プレスリリース' },
  { sourceType: 'official', category: 'テクノロジー', subgroup: '海外', sourceName: 'NIST', sourceUrl: 'https://www.nist.gov/', feedUrl: 'https://www.nist.gov/news-events/news/rss.xml', label: 'NIST News' },
  { sourceType: 'official', category: 'テクノロジー', subgroup: '海外', sourceName: 'NSF', sourceUrl: 'https://www.nsf.gov/', feedUrl: 'https://www.nsf.gov/rss/rss_www_news.xml', label: 'NSF News' },
  { sourceType: 'corporate', category: 'テクノロジー', subgroup: '海外', sourceName: 'NVIDIA', sourceUrl: 'https://blogs.nvidia.com/', feedUrl: 'https://blogs.nvidia.com/feed/', label: 'NVIDIA Blog' },
  // 生成AI
  { sourceType: 'corporate', category: '生成AI', subgroup: '日本', sourceName: 'Sakana AI', sourceUrl: 'https://sakana.ai/', feedUrl: 'https://sakana.ai/feed.xml', label: 'Sakana AI' },
  { sourceType: 'corporate', category: '生成AI', subgroup: '海外', sourceName: 'OpenAI', sourceUrl: 'https://openai.com/', feedUrl: 'https://openai.com/news/rss.xml', label: 'OpenAI News' },
  { sourceType: 'corporate', category: '生成AI', subgroup: '海外', sourceName: 'Google DeepMind', sourceUrl: 'https://deepmind.google/', feedUrl: 'https://deepmind.google/blog/rss.xml', label: 'Google DeepMind Blog' },
  { sourceType: 'corporate', category: '生成AI', subgroup: '海外', sourceName: 'Google', sourceUrl: 'https://blog.google/', feedUrl: 'https://blog.google/technology/ai/rss/', label: 'Google AI Blog' }
];

// 見出しと説明文に含まれる語だけでカテゴリを追加する（推測による分類はしない）
const CATEGORY_RULES: { category: CategoryKey; pattern: RegExp | RegExp[]; subgroup?: '日本'; corporateOnly?: boolean }[] = [
  {
    // 企業の発表のうち、提携・買収・決算・事業展開・事故や不祥事など企業活動に関するもの
    category: '経済',
    corporateOnly: true,
    pattern: [
      // 日本語（「BtoB」の toB を TOB と誤認しないよう、大文字小文字を区別する）
      new RegExp([
        '業務提携|資本(業務)?提携|買収|合併|経営統合|子会社化|株式(の)?取得|事業(譲渡|承継|売却|再編|撤退)|公開買付|(?<![A-Za-z])TOB(?![A-Za-z])',
        '決算|業績予想|業績(の)?修正|上方修正|下方修正|増収|減収|増益|減益|過去最高|特別損失|新規上場|上場(承認|決定|廃止)|(東証|グロース|プライム|スタンダード)(市場)?への(上場|市場変更)',
        '新工場|工場(を|の)?(新設|建設|稼働|閉鎖)|生産(能力)?(の)?(増強|拡大|開始|停止|終了)|値上げ|価格改定|販売終了|事業終了|サービス終了',
        // 事故・不祥事は、セキュリティ製品の宣伝と区別するため「お知らせ／お詫び／発生」などの報告表現を伴うものに限る
        'リコール|自主回収|製品回収',
        '(不正アクセス|サイバー攻撃|ランサムウェア|情報漏え?い|個人情報.{0,8}(流出|漏え?い)|システム障害|サービス障害|通信障害)[^。]{0,30}(お知らせ|お詫び|おわび|発生|判明|被害を受け)',
        '不適切(な)?会計|行政処分|業務改善命令|代表取締役.{0,6}(就任|異動|交代)|社長交代|新経営体制|役員人事|役員の異動|中期経営計画|海外進出|海外展開|倒産|民事再生|破産'
      ].join('|')),
      // 英語
      new RegExp([
        '\\b(acquires?|acquired|acquisition|to acquire|merger|merges?|takeover|tender offer|financial results|quarterly results|earnings|net income|guidance)\\b',
        '\\b((first|second|third|fourth) quarter|fiscal (year )?\\d{4} results|revenue of|initial public offering|IPO|bankruptcy|chapter 11|restructuring|layoffs?)\\b',
        '\\b(recall|new (plant|factory)|joint venture|divest(s|iture)?|spin-?off)\\b',
        '\\b(notice of|discloses?|experienced|reports?|announces?)\\b.{0,40}\\b(data (security )?(breach|incident)|cyber ?(security )?incident|ransomware attack|service outage)\\b',
        '\\b(names?|appoints?) .{0,40}(CEO|chief executive)\\b'
      ].join('|'), 'i')
    ]
  },
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
    sourceType: 'official',
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
    sourceType: 'official',
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

// 公的機関の発表のうち、ニュース性の低い定型的なお知らせ（入札結果、採用募集など）
const ROUTINE_NOTICE = /入札|落札|発行予定額|国債金利情報|分離状況|現在高推移|(職員|スタッフ|人材|研究員).{0,12}募集|説明会|座談会|オープン・カンパニー|ディスカッション・ペーパー|時系列統計|調達情報|オペレーション（|国庫短期証券/;

// 企業の発表を装った法律事務所の集団訴訟勧誘などは、企業活動の情報ではないため除外する
// ウェビナー・セミナーの告知も、企業活動そのものの情報ではないため除外する
const PROMOTIONAL_NOISE = /class action|shareholder alert|investor alert|securities fraud|reminds? (investors|shareholders)|lead plaintiff|on behalf of (investors|shareholders)|investors? who (lost|purchased)|have opportunity to lead|ウェビナー|オンラインセミナー|セミナー(を|の)?(開催|申込)|\bwebinar\b/i;

function trimSummary(value: string): string {
  // 一部のフィード（欧州委員会など）は改行を「\n」という文字列のまま配信するため、空白に置き換える
  const normalized = value.replace(/<[^>]*>/g, ' ').replace(/\\[nrt]/g, ' ').replace(/\s+/g, ' ').trim();
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
    .filter(rule =>
      (!rule.subgroup || rule.subgroup === source.subgroup) &&
      (!rule.corporateOnly || source.sourceType === 'corporate') &&
      [rule.pattern].flat().some(pattern => pattern.test(text)))
    .map(rule => rule.category);

  const found = source.category
    ? [...new Set([source.category, ...matched])]
    : matched.filter(category => source.matchOnly?.includes(category));

  // 投資（資金調達など）に該当する記事は経済から分けて扱う
  const categories = found.includes('投資') ? found.filter(category => category !== '経済') : found;
  if (!source.category) {
    return categories.sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b));
  }
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

// http/https や末尾のスラッシュの違いで同じ記事が重複しないよう、URL を正規化して ID に使う
function normalizeUrlForId(value: string): string {
  return value.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/+$/, '').toLowerCase();
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
function finalizeItem(entry: Omit<NewsItem, 'id' | 'category' | 'categories' | 'hashtags' | 'keywords'> & { id?: string }, categories: CategoryKey[]): NewsItem {
  return {
    ...entry,
    // 蓄積データから読み込んだ記事は古い ID を持つことがあるため、必ず作り直す
    id: makeId(`${entry.sourceName}|${normalizeUrlForId(entry.sourceUrl)}|${entry.title}`),
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
      if (items.length >= (source.maxItems ?? ITEMS_PER_FEED)) break;

      const title = normalizeTitle(item.title ?? '');
      const link = absoluteUrl(item.link, source.sourceUrl);
      const publishedAt = toIsoDate(item.isoDate ?? item.pubDate) ?? toIsoDate((item as { date?: string }).date);
      if (!title || !link || !publishedAt) continue;

      // 翻訳版など対象外の言語の記事は取り込まない
      const language = typeof item.language === 'string' ? item.language.toLowerCase() : '';
      if (source.languages && language && !source.languages.some(code => language.startsWith(code))) continue;

      const description = trimSummary(item.contentSnippet ?? item.content ?? item.summary ?? '');
      if (source.excludeRoutine && ROUTINE_NOTICE.test(title)) continue;
      if (source.sourceType === 'corporate' && PROMOTIONAL_NOISE.test(`${title} ${description}`)) continue;

      const categories = classify(source, title, description);
      if (categories.length === 0) continue;

      items.push(finalizeItem({
        subgroup: source.subgroup,
        sourceType: source.sourceType,
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
      if (source.excludeRoutine && ROUTINE_NOTICE.test(item.title)) continue;
      if (source.sourceType === 'corporate' && PROMOTIONAL_NOISE.test(`${item.title} ${item.summary}`)) continue;
      const categories = classify(source, item.title, item.summary);
      if (categories.length === 0) continue;
      const refreshed = finalizeItem({ ...item, subgroup: source.subgroup, sourceName: source.sourceName, sourceType: source.sourceType }, categories);
      archive.set(refreshed.id, refreshed);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[archive] 読み込みに失敗しました: ${(error as Error).message}`);
    }
  }

  return archive;
}

// maxItems を設定したフィード（日本銀行・財務省など）は、蓄積分も含めて1日あたりの件数を制限する
function limitPerFeedPerDay(items: NewsItem[]): NewsItem[] {
  const limits = new Map(officialFeeds.filter(feed => feed.maxItems).map(feed => [feed.feedUrl, feed.maxItems!]));
  const counts = new Map<string, number>();
  return items.filter((item) => {
    const limit = limits.get(item.feedUrl);
    if (!limit) return true;
    const key = `${item.feedUrl}|${item.publishedAt.slice(0, 10)}`;
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    return count <= limit;
  });
}

function mergeCategories(first: NewsItem, second: NewsItem): NewsItem {
  const categories = [...new Set([...first.categories, ...second.categories])];
  const merged = categories.includes('投資') ? categories.filter(category => category !== '経済') : categories;
  return finalizeItem({ ...first, imageUrl: first.imageUrl ?? second.imageUrl }, merged);
}

function sortByDate(items: NewsItem[]): NewsItem[] {
  return items.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

async function collectNews(): Promise<NewsItem[]> {
  const store = await loadArchive();
  const feedResults = await Promise.all(officialFeeds.map(fetchFeed));

  // 同じ記事が複数のフィード（PR Newswire の決算・M&A など）に載る場合は、カテゴリを統合する
  const fetched = new Map<string, NewsItem>();
  for (const item of feedResults.flat()) {
    const duplicate = fetched.get(item.id);
    fetched.set(item.id, duplicate ? mergeCategories(duplicate, item) : item);
  }

  for (const item of fetched.values()) {
    // 再取得した記事でも、記事ページから取得済みの画像は引き継ぐ
    const existing = store.get(item.id);
    store.set(item.id, existing
      ? { ...item, imageUrl: item.imageUrl ?? existing.imageUrl, imageChecked: existing.imageChecked }
      : item);
  }

  const cutoff = Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000;
  const kept = limitPerFeedPerDay(sortByDate([...store.values()]))
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
    const bySourceType = filters.sourceType ? item.sourceType === filters.sourceType : true;
    const keyword = filters.keyword?.trim().toLowerCase();
    const byKeyword = keyword
      ? [item.title, item.summary, item.sourceName, ...item.keywords, ...item.hashtags].some(value =>
          value.toLowerCase().includes(keyword)
        )
      : true;

    return byCategory && bySubgroup && bySourceType && byKeyword;
  });
}

export async function getNewsById(id: string): Promise<NewsItem | undefined> {
  const items = await loadNews();
  return items.find(item => item.id === id);
}
