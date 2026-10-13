import { buildBriefing, filterChoices, listCategoryGroups, listNews, newsDetail, onboardingOptions, sourcesWithUsage } from '../api.js';
import type { ApiContext, SourceInfo } from '../api.js';
import { defaultProfile, ProfileSchema, semanticQueries, withDefaultDescriptions } from '../profile.js';
import type { Profile } from '../profile.js';
import type { ArticleSummary, NewsItem } from '../types.js';
import { createScorer, decodeVector, itemVectors, textKey } from '../vectors.js';

/**
 * 静的サイト版: サーバーの代わりに、ブラウザの中で `/api/...` への問い合わせに答える。
 * 記事・要約・ベクトルは定期ジョブが書き出した静的ファイル（data/*.json）から読み込み、
 * 関心プロフィールはこの端末の localStorage に保存する（アカウントもサーバーも不要）。
 */

const PROFILE_KEY = 'sivry.profile.v1';

interface Meta {
  generatedAt: string;
  model: string | null;
  threshold: number;
  /** トピックの説明文（textKey） → ベクトル（Base64）。初期設定のトピックだけを事前計算している */
  topicVectors: Record<string, string>;
}

interface StaticData {
  meta: Meta;
  items: NewsItem[];
  sources: SourceInfo[];
  summaries: Map<string, ArticleSummary>;
  sourceIds: Map<string, string>;
}

const base = new URL('.', document.currentScript instanceof HTMLScriptElement ? document.currentScript.src : location.href);

async function getJson<T>(name: string): Promise<T> {
  const response = await originalFetch(new URL(`data/${name}.json`, base), { cache: 'no-cache' });
  if (!response.ok) throw new Error(`${name}.json: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

const originalFetch = window.fetch.bind(window);
let loading: Promise<StaticData> | null = null;

function load(): Promise<StaticData> {
  loading ??= (async () => {
    const [meta, items, sources, summaries, vectors] = await Promise.all([
      getJson<Meta>('meta'),
      getJson<NewsItem[]>('news'),
      getJson<SourceInfo[]>('sources'),
      getJson<Record<string, ArticleSummary>>('summaries'),
      getJson<Record<string, string>>('vectors')
    ]);
    for (const [id, vector] of Object.entries(vectors)) itemVectors.set(id, decodeVector(vector));
    return {
      meta,
      items,
      sources,
      summaries: new Map(Object.entries(summaries)),
      sourceIds: new Map(sources.map(source => [source.feedUrl, source.id]))
    };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

function loadProfile(): Profile {
  try {
    const saved = localStorage.getItem(PROFILE_KEY);
    if (saved) return withDefaultDescriptions(ProfileSchema.parse(JSON.parse(saved)));
  } catch {
    // 壊れた保存データは初期設定に戻す
  }
  return defaultProfile();
}

function saveProfile(input: unknown): Profile {
  const profile = ProfileSchema.parse(input);
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  return profile;
}

/** 事前計算したトピックのベクトルがある関心だけ、意味での一致に使う（自分で追加したトピックはキーワードだけで判定する） */
function semanticFor(profile: Profile, meta: Meta) {
  const vectors = new Map<string, Float32Array>();
  for (const topic of semanticQueries(profile)) {
    const encoded = meta.topicVectors[textKey(topic.description)];
    if (encoded) vectors.set(topic.id, decodeVector(encoded));
  }
  return createScorer(vectors, meta.threshold);
}

async function context(withSemantic = false): Promise<ApiContext> {
  const data = await load();
  const profile = loadProfile();
  return {
    items: data.items,
    summaries: data.summaries,
    profile,
    semantic: withSemantic ? semanticFor(profile, data.meta) : null,
    hasVectors: itemVectors.size > 0,
    sources: data.sources,
    sourceIdOf: feedUrl => data.sourceIds.get(feedUrl) ?? ''
  };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

async function handle(url: URL, method: string, request: Request): Promise<Response> {
  const path = url.pathname.replace(/^.*?\/api\//, '/api/');
  const query = url.searchParams;

  if (path === '/api/health') return json({ status: 'ok', version: 'static' });

  if (path === '/api/config') {
    const { meta } = await load();
    return json({
      summaryEnabled: true,
      provider: 'extractive',
      method: 'extractive',
      semantic: { enabled: Boolean(meta.model), model: meta.model, available: Boolean(meta.model), embeddedCount: itemVectors.size, threshold: meta.threshold, error: null },
      static: true,
      generatedAt: meta.generatedAt
    });
  }

  if (path === '/api/profile') {
    if (method === 'PUT') {
      try {
        return json(saveProfile(await request.json()));
      } catch (error) {
        return json({ error: `プロフィールの形式が正しくありません: ${(error as Error).message.slice(0, 300)}` }, 400);
      }
    }
    return json(loadProfile());
  }
  if (path === '/api/profile/reset' && method === 'POST') return json(saveProfile(defaultProfile()));

  if (path === '/api/categories') return json(listCategoryGroups());
  if (path === '/api/filters') return json(filterChoices(loadProfile()));
  if (path === '/api/options') return json(onboardingOptions(await context()));
  if (path === '/api/sources') return json(sourcesWithUsage(await context()));
  if (path === '/api/briefing') return json(buildBriefing(await context(true)));

  if (path === '/api/news') {
    const text = (name: string) => query.get(name) ?? undefined;
    const { items, total } = listNews(await context(true), {
      forYou: query.get('forYou') === '1',
      category: text('category'),
      subgroup: text('subgroup'),
      sourceType: text('sourceType'),
      keyword: text('keyword'),
      offset: Number(query.get('offset')),
      limit: Number(query.get('limit'))
    });
    return json(items, 200, { 'X-Total-Count': String(total) });
  }

  const detail = path.match(/^\/api\/news\/([^/]+)(\/summary)?$/);
  if (detail) {
    const id = decodeURIComponent(detail[1]);
    const found = newsDetail(await context(), id);
    if (!found) return json({ error: '記事が見つかりません。' }, 404);
    if (detail[2]) {
      return found.summary
        ? json({ summary: found.summary })
        : json({ error: 'この記事の要約はまだ作成されていません。次の更新をお待ちください。' }, 502);
    }
    // 発信元のページはブラウザから直接読めないため、本文の抜粋は付けない（元記事へのリンクで読める）
    return json({ ...found, summaryEnabled: true, content: { status: 'unavailable', paragraphs: [], truncated: false } });
  }

  return json({ error: 'Not found' }, 404);
}

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const request = new Request(input, init);
  const url = new URL(request.url, location.href);
  if (url.origin !== location.origin || !/(^|\/)api\//.test(url.pathname)) return originalFetch(input, init);
  try {
    return await handle(url, request.method, request);
  } catch (error) {
    console.error('[static-api]', error);
    return json({ error: 'データを読み込めませんでした。通信状況を確認してください。' }, 500);
  }
};
