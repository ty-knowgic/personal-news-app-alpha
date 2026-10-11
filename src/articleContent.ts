import { Readability } from '@mozilla/readability';
import { JSDOM, VirtualConsole } from 'jsdom';
import type { ArticleContent } from './types.js';

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const FETCH_TIMEOUT_MS = 10000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
// 詳細画面は「概要」なので、元記事の冒頭部分のみを表示し、全文は元サイトで読んでもらう
const MAX_PARAGRAPHS = 8;
const MAX_CHARS = 1400;
const CACHE_LIMIT = 300;

// 本文抽出の前に取り除く、サイト共通のナビゲーション類
const NOISE_SELECTORS = [
  'header', 'footer', 'nav', 'aside', 'form', 'script', 'style', 'noscript', 'iframe',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
  '.breadcrumb', '.breadcrumbs', '#breadcrumb', '.topicpath', '#topicpath', '.pankuzu', '#pankuzu',
  '#header', '#footer', '.header', '.footer', '#gnav', '.gnav', '#globalNav', '.skip', '.sns', '.share'
].join(',');

const MAIN_SELECTORS = ['main', '[role="main"]', 'article', '#main', '#contents', '#content', '.main', '.contents'];

const BOILERPLATE = /(All Rights Reserved|Copyright|©|法人番号|本文へ|サイトマップ|よくある御質問|ページの先頭へ|Skip to main content)/i;

const DATE_ONLY = /^(令和|平成)?[\d０-９元]+年[\d０-９]+月[\d０-９]+日.{0,6}$|^[A-Z][a-z]+ \d{1,2}, \d{4}$/;

const cache = new Map<string, ArticleSource>();

// サイト共通の OGP 画像（ロゴなど）は記事の内容を表さないため使わない
export function isGenericImage(url: string): boolean {
  return /ogp|og_img|og-image|opengraph-image|social-default|social-media-card|logo|default|title_j/i.test(url);
}

function decodeHtml(buffer: ArrayBuffer, contentType: string | null): string {
  const head = new TextDecoder('ascii').decode(buffer.slice(0, 4096));
  const charset =
    contentType?.match(/charset=["']?([\w-]+)/i)?.[1] ??
    head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ??
    'utf-8';

  try {
    return new TextDecoder(charset).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

function cleanText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function metaContent(document: Document, selectors: string[]): string | undefined {
  for (const selector of selectors) {
    const value = cleanText(document.querySelector(selector)?.getAttribute('content'));
    if (value) return value;
  }
  return undefined;
}

function toAbsoluteUrl(value: string | undefined, base: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

// Readability が返した本文 HTML から、段落単位のプレーンテキストを取り出す
function extractParagraphs(html: string): string[] {
  const { document } = new JSDOM(`<body>${html}</body>`).window;
  const blocks = [...document.querySelectorAll('p, li, h2, h3, h4, blockquote, dd')]
    // 入れ子になった要素の重複を避けるため、内側にブロック要素を持つものは除く
    .filter(el => !el.querySelector('p, li, h2, h3, h4, blockquote, dd'));

  const source = blocks.length ? blocks.map(el => el.textContent) : [document.body.textContent];
  return source
    .map(cleanText)
    // 「以上」「報道資料」のような見出し・ラベルだけの短い行や、日付だけの行は概要に含めない
    .filter(text => text.length >= 8 && !BOILERPLATE.test(text) && !DATE_ONLY.test(text));
}

function limitParagraphs(paragraphs: string[]): { paragraphs: string[]; truncated: boolean } {
  const result: string[] = [];
  let total = 0;
  for (const paragraph of paragraphs) {
    if (result.length >= MAX_PARAGRAPHS || total >= MAX_CHARS) {
      return { paragraphs: result, truncated: true };
    }
    const remaining = MAX_CHARS - total;
    const text = paragraph.length > remaining ? `${paragraph.slice(0, remaining).trim()}…` : paragraph;
    result.push(text);
    total += text.length;
  }
  return { paragraphs: result, truncated: false };
}

export interface ArticleSource {
  content: ArticleContent;
  /** 要約に使う本文全体（画面には表示しない） */
  fullText: string;
  /** 発表資料が PDF の場合の本体（Base64）。要約にのみ使い、キャッシュしない */
  pdfBase64?: string;
}

function parseHtml(html: string, url: string): ArticleSource {
  const dom = new JSDOM(html, { url, virtualConsole: new VirtualConsole() });
  const { document } = dom.window;

  const description = metaContent(document, [
    'meta[property="og:description"]',
    'meta[name="description"]',
    'meta[name="twitter:description"]'
  ]);
  const imageUrl = toAbsoluteUrl(
    metaContent(document, ['meta[property="og:image"]', 'meta[name="twitter:image"]']),
    url
  );
  const siteName = metaContent(document, ['meta[property="og:site_name"]']);

  document.querySelectorAll(NOISE_SELECTORS).forEach(el => el.remove());

  // メイン領域が特定できる場合はそこだけを対象にし、ナビゲーションの混入を防ぐ
  const main = MAIN_SELECTORS.map(s => document.querySelector(s)).find(
    el => el && cleanText(el.textContent).length > 100
  );
  if (main) {
    document.body.replaceChildren(main);
  }

  const article = new Readability(document, { charThreshold: 100 }).parse();
  const paragraphs = article?.content ? extractParagraphs(article.content) : [];
  const limited = limitParagraphs(paragraphs);

  return {
    content: {
      status: limited.paragraphs.length ? 'ok' : 'unavailable',
      paragraphs: limited.paragraphs,
      truncated: limited.truncated,
      description,
      imageUrl,
      siteName
    },
    fullText: paragraphs.join('\n\n')
  };
}

function unavailable(reason: string): ArticleSource {
  return { content: { status: 'unavailable', paragraphs: [], truncated: false, reason }, fullText: '' };
}

async function loadArticle(url: string, includePdf: boolean): Promise<ArticleSource> {
  const cached = cache.get(url);
  if (cached && !(includePdf && cached.content.status === 'pdf')) return cached;

  let source: ArticleSource;
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ja,en;q=0.8' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
    const contentType = response.headers.get('content-type');

    if (!response.ok) {
      source = unavailable(`HTTP ${response.status}`);
    } else if (contentType?.includes('pdf') || /\.pdf($|\?)/i.test(response.url)) {
      source = { content: { status: 'pdf', paragraphs: [], truncated: false }, fullText: '' };
      if (includePdf) {
        const buffer = await response.arrayBuffer();
        if (buffer.byteLength <= MAX_PDF_BYTES) {
          // PDF の本体はサイズが大きいためキャッシュには入れない
          return { ...source, pdfBase64: Buffer.from(buffer).toString('base64') };
        }
      }
    } else if (!contentType?.includes('html')) {
      source = unavailable(contentType ?? 'unknown');
    } else {
      const buffer = await response.arrayBuffer();
      source = buffer.byteLength > MAX_HTML_BYTES
        ? unavailable('too large')
        : parseHtml(decodeHtml(buffer, contentType), response.url || url);
    }
  } catch (error) {
    // 一時的な失敗はキャッシュせず、次回再取得する
    return unavailable((error as Error).message);
  }

  if (cache.size >= CACHE_LIMIT) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(url, source);
  return source;
}

/** 詳細画面に表示する、発信元ページの冒頭部分 */
export async function fetchArticleContent(url: string): Promise<ArticleContent> {
  return (await loadArticle(url, false)).content;
}

/** 要約用に、本文全体（PDF の場合は PDF 本体）を取得する */
export async function fetchArticleSource(url: string): Promise<ArticleSource> {
  return loadArticle(url, true);
}
