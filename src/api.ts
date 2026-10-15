import { filterNews, listCategoryGroups, listFilterOptions, withPrimaryCategory } from './newsFilters.js';
import { matchTopics, rankForYou } from './profile.js';
import type { Profile } from './profile.js';
import { buildStoryIndex, findRelated, groupStories } from './stories.js';
import { cleanFeedText } from './text.js';
import { CATEGORIES, SUBGROUPS } from './types.js';
import type { ArticleSummary, NewsItem } from './types.js';
import type { SemanticScorer } from './vectors.js';

/**
 * 画面が使う API の中身（記事の一覧・マイニュース・ブリーフィング・情報源など）。
 * サーバー（Express）でもブラウザ（静的サイト版）でも同じ計算になるよう、
 * 記事・プロフィール・ベクトルを引数で受け取る純粋な関数にしてある。
 */

export interface SourceInfo {
  id: string;
  sourceType: string;
  sourceName: string;
  label: string;
  subgroup: string;
  categories: string[];
  sourceUrl: string;
  feedUrl: string;
  health: unknown;
}

export interface ApiContext {
  /** 蓄積中の全記事 */
  items: NewsItem[];
  /** 記事 ID → 保存済みの要約 */
  summaries: Map<string, ArticleSummary>;
  profile: Profile;
  /** 意味による一致の判定（使えない場合は null） */
  semantic: SemanticScorer | null;
  /** 記事のベクトルが読み込み済みか（同じ話題のまとめに必要） */
  hasVectors: boolean;
  sources: SourceInfo[];
  sourceIdOf(feedUrl: string): string;
}

export interface NewsQuery {
  forYou?: boolean;
  category?: string;
  subgroup?: string;
  sourceType?: string;
  keyword?: string;
  offset?: number;
  limit?: number;
}

// プレスリリース配信サービス（誰でも有料で配信できる）
const PR_WIRES = new Set(['PR TIMES', '@Press', 'PR Newswire', 'Cision Canada']);

/**
 * 発信元による重み: 政府・研究機関・団体の発表と、企業が自社サイトで公開した発表を、
 * 配信サービス経由の企業発表（宣伝や調査リリースが多い）より上位にする
 */
function sourceWeight(item: NewsItem): number {
  if (PR_WIRES.has(item.sourceName)) return 0.6;
  return item.sourceType === 'corporate' ? 0.9 : 1;
}

// 保存済みの要約があれば一覧用の項目に添える（ここでは新たな要約は作らない）
export function withStoredSummaries(summaries: Map<string, ArticleSummary>, items: NewsItem[]) {
  return items.map((item) => {
    const summary = summaries.get(item.id);
    return summary ? { ...item, ai: { headlineJa: summary.headlineJa, summary: summary.summary, method: summary.method } } : item;
  });
}

/**
 * 表示順の記事を話題ごとにまとめる。マイニュースでは、複数の発信元が伝えている話題を少し上位にする
 * （官公庁の発表と報道の両方がある、など。同じ発信元の続報は数えない）
 */
function groupForDisplay<T extends NewsItem & { score?: number }>(ctx: ApiContext, items: T[], byScore: boolean) {
  if (!ctx.hasVectors) return items.map(item => ({ ...item, related: [] }));
  const grouped = groupStories(items, buildStoryIndex(ctx.items));
  if (!byScore) return grouped;
  const coverage = (item: (typeof grouped)[number]) => new Set([item.sourceName, ...item.related.map(related => related.sourceName)]).size;
  return grouped
    .map(item => ({ item, score: (item.score ?? 0) * sourceWeight(item) * (1 + 0.25 * Math.min(2, coverage(item) - 1)) }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

/**
 * 利用者の選んだ地域・分野と、オフにした情報源による絞り込み条件。
 * マイニュースとブリーフィングは関心トピックで選ぶため、分野では絞らない
 * （例: 「社会」を選んでいなくても、関心トピック「ウォータールー周辺」に一致する市の発表は表示する）
 */
export function scopeOf(profile: Profile, forYou = false) {
  return { excludedSources: new Set(profile.excludedSources), hiddenItems: new Set(profile.hiddenItems), regions: profile.regions, categories: forYou ? [] : profile.categories };
}

/** 利用者の対象範囲（地域・情報源、マイニュース以外では分野も）に含まれる、蓄積中の全記事 */
export function visibleNews(ctx: ApiContext, forYou = false): NewsItem[] {
  return filterNews(ctx.items, scopeOf(ctx.profile, forYou), ctx.sourceIdOf).map(item => withPrimaryCategory(item, ctx.profile.categories));
}

/** 記事の一覧（マイニュースは関心プロフィールに一致する記事を関連度順に、それ以外は新しい順）。どちらも一致したトピックを添える */
export function listNews(ctx: ApiContext, query: NewsQuery) {
  const { profile } = ctx;
  const filtered = filterNews(ctx.items, {
    category: query.category,
    subgroup: query.subgroup,
    sourceType: query.sourceType,
    keyword: query.keyword,
    ...scopeOf(profile, query.forYou)
  }, ctx.sourceIdOf);

  const withSummaries = withStoredSummaries(ctx.summaries, filtered.map(item => withPrimaryCategory(item, profile.categories)));
  const ranked = query.forYou
    ? rankForYou(withSummaries, profile, ctx.semantic)
    : withSummaries.map(item => ({ ...item, matches: matchTopics(item, profile, ctx.semantic) }));
  // 同じ出来事の発表・報道は1枚のカードにまとめる（埋め込みが使えない場合はまとめない）
  const result = groupForDisplay(ctx, ranked, Boolean(query.forYou));

  // 蓄積データが多くなっても端末側の負荷が増えないよう、ページ単位で返す
  const start = Math.max(0, Number(query.offset) || 0);
  const size = Math.min(200, Math.max(1, Number(query.limit) || 200));
  return { total: result.length, items: result.slice(start, start + size) };
}

/** 要約（なければ説明文）の最初の一文を、ブリーフィング用の短い説明にする */
export function firstSentence(text: string, max = 90): string {
  const clean = cleanFeedText(text);
  const match = clean.match(/^.+?(?:。|[.!?](?=\s|$))/);
  const sentence = match ? match[0] : clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/**
 * 今日のブリーフィング: マイニュースのうち直近の話題から、関心トピックが偏らないよう最大5件を選ぶ。
 * 文章は記事の要約・説明文から取り出すだけで、生成AIは使わない
 */
export function buildBriefing(ctx: ApiContext) {
  const { profile } = ctx;
  const items = withStoredSummaries(ctx.summaries, visibleNews(ctx, true));
  const stories = groupForDisplay(ctx, rankForYou(items, profile, ctx.semantic), true);
  const boostOnly = new Set(profile.topics.filter(topic => topic.boostOnly).map(topic => topic.id));
  const MAX_PER_TOPIC = 2;

  // 週末など新しい記事が少ない場合は、対象期間を広げる（関心トピックが偏らずに5件選べるまで）
  const within = (hours: number) => stories.filter(story => Date.now() - new Date(story.publishedAt).getTime() <= hours * 3_600_000);
  const lineOf = (story: (typeof stories)[number]) => firstSentence(('ai' in story && story.ai?.summary) || story.summary);
  const pick = (candidates: typeof stories) => {
    const perTopic = new Map<string, number>();
    const picked: typeof stories = [];
    for (const story of candidates) {
      // 本文で触れているだけ・内容の近さが弱いなど、一致の弱い記事はブリーフィングには載せない
      if (!story.matches.some(match => !boostOnly.has(match.id) && match.strength >= 0.75)) continue;
      // 見出しだけで内容が分からない記事は載せない
      if (lineOf(story).length < 20) continue;
      const topic = story.matches.find(match => !boostOnly.has(match.id))?.id ?? '';
      if ((perTopic.get(topic) ?? 0) >= MAX_PER_TOPIC) continue;
      // プレスリリース配信サービスの発表は1件まで（発信元の多様さを保つ）
      if (PR_WIRES.has(story.sourceName) && picked.some(other => PR_WIRES.has(other.sourceName))) continue;
      // 同じ発信元は1件まで（トピックが違っても同じ省庁・企業の発表が並ばないように）
      if (picked.some(other => other.sourceName === story.sourceName)) continue;
      perTopic.set(topic, (perTopic.get(topic) ?? 0) + 1);
      picked.push(story);
      if (picked.length >= 5) break;
    }
    return picked;
  };
  let windowHours = 24;
  let recent = within(windowHours);
  let picked = pick(recent);
  // 連休明けなどは1週間まで広げる
  for (const hours of [48, 72, 120, 168]) {
    if (picked.length >= 5) break;
    windowHours = hours;
    recent = within(hours);
    picked = pick(recent);
  }

  // 関心トピックごとの話題数（「生成AI 12件」のように、全体の動きを一目で見られるように）
  const topicCounts = profile.topics
    .filter(topic => topic.enabled && !topic.boostOnly)
    .map(topic => ({ id: topic.id, label: topic.label, count: recent.filter(story => story.matches.some(match => match.id === topic.id)).length }))
    .filter(topic => topic.count > 0)
    .sort((a, b) => b.count - a.count);

  return {
    generatedAt: new Date().toISOString(),
    windowHours,
    storyCount: recent.length,
    topics: topicCounts,
    stories: picked.map(story => ({
      id: story.id,
      title: ('ai' in story && story.ai?.headlineJa) || story.title,
      line: lineOf(story),
      category: story.category,
      subgroup: story.subgroup,
      sourceName: story.sourceName,
      sourceType: story.sourceType,
      publishedAt: story.publishedAt,
      matches: story.matches,
      related: story.related
    }))
  };
}

/** 情報源の一覧（設定画面用）。直近30日の取り込み件数と、この利用者が使っているかを添える */
export function sourcesWithUsage(ctx: ApiContext) {
  const counts = new Map<string, number>();
  for (const item of ctx.items) {
    const id = ctx.sourceIdOf(item.feedUrl);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const { profile } = ctx;
  return ctx.sources.map(source => ({
    ...source,
    enabled: !profile.excludedSources.includes(source.id),
    // 選んだ地域の外にある情報源（設定の「地域・分野」で地域を加えると使われる）
    outOfRegion: Boolean(profile.regions.length) && !profile.regions.includes(source.subgroup),
    count: counts.get(source.id) ?? 0
  }));
}

/** タブ（分野）と地域の選択肢。利用者が選んだ分野・地域だけを、選んだ順ではなく既定の並び順で返す */
export function filterChoices(profile: Profile) {
  const pick = <T extends string>(all: readonly T[], chosen: string[]) => (chosen.length ? all.filter(value => chosen.includes(value)) : [...all]);
  return { ...listFilterOptions(), categories: pick(CATEGORIES, profile.categories), regions: pick(SUBGROUPS, profile.regions) };
}

/** 初回の質問の選択肢: 地域・分野ごとの情報源数と、直近30日の記事数 */
export function onboardingOptions(ctx: ApiContext) {
  return {
    regions: SUBGROUPS.map(region => ({ value: region, sources: ctx.sources.filter(source => source.subgroup === region).length })),
    categories: CATEGORIES.map(category => ({ value: category, articles: ctx.items.filter(item => item.categories.includes(category)).length }))
  };
}

export { listCategoryGroups };

/** 記事詳細のうち、記事自身・同じ話題の記事・保存済みの要約（本文の抜粋は発信元ページの取得が必要なため、呼び出し側で添える） */
export function newsDetail(ctx: ApiContext, id: string) {
  const item = ctx.items.find(candidate => candidate.id === id);
  if (!item) return undefined;
  const related = ctx.hasVectors ? findRelated(item, visibleNews(ctx, true), buildStoryIndex(ctx.items)) : [];
  return { item, related, summary: ctx.summaries.get(item.id) ?? null };
}
