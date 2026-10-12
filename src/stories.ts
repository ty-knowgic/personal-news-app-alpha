import { itemSimilarity } from './embeddings.js';
import type { NewsItem } from './types.js';

/**
 * 同じ出来事についての発表・報道をまとめる（生成AIは使わない）。
 * 埋め込みベクトルの近さだけでは「◯◯国 渡航情報」「総理ビデオメッセージ」のように
 * 書式が同じ別々の発表もまとまってしまうため、珍しい語（固有名詞など）を共有していることも条件にする。
 */

/** これ以上近ければ、珍しい語を共有していなくても同じ話題とみなす（翻訳版や、ほぼ同じ文面の発表） */
const NEAR_DUPLICATE = 0.86;
/** 珍しい語を2つ以上共有している場合に、同じ話題とみなす近さ */
const SAME_STORY = 0.72;
/** まとめる記事の公開日時の差の上限 */
const WINDOW_HOURS = 96;
/** この記事数以下にしか出てこない語を「珍しい語」とする */
const RARE_DOC_FREQUENCY = 8;

const STOP_WORDS = new Set(('the and for with from that this into over after about under more than will have has its new are was were their our your not but all can '
  + 'government canada canadian minister announces announce statement news release update report press support federal program').split(' '));

/** 見出しと説明文から、照合に使う語を取り出す。英語は単語、日本語はカタカナ語と漢字の2文字の並び */
function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9'’-]{2,}/g) ?? []) {
    const normalized = word.replace(/['’]s$/, '');
    if (!STOP_WORDS.has(normalized)) tokens.add(normalized);
  }
  for (const word of text.match(/[ァ-ヶー]{3,}/g) ?? []) tokens.add(word);
  for (const run of text.match(/[一-龯々]{2,}/g) ?? []) {
    for (let i = 0; i < run.length - 1; i += 1) tokens.add(run.slice(i, i + 2));
  }
  return tokens;
}

export interface StoryIndex {
  tokens: Map<string, Set<string>>;
  documentFrequency: Map<string, number>;
}

let cachedIndex: { items: NewsItem[]; index: StoryIndex } | null = null;

/** 蓄積中の全記事から、語の出現数を数える（記事一覧が更新されるまで再利用する） */
export function buildStoryIndex(allItems: NewsItem[]): StoryIndex {
  if (cachedIndex?.items === allItems) return cachedIndex.index;
  const tokens = new Map<string, Set<string>>();
  const documentFrequency = new Map<string, number>();
  for (const item of allItems) {
    const set = tokenize(`${item.title} ${item.summary.slice(0, 400)}`);
    tokens.set(item.id, set);
    for (const token of set) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const index = { tokens, documentFrequency };
  cachedIndex = { items: allItems, index };
  return index;
}

/** 珍しい語を2つ以上共有しているか（1語だけだと「ビデオメッセージ」のような定型の語でつながってしまう） */
function sharesRareTokens(a: string, b: string, index: StoryIndex): boolean {
  const ta = index.tokens.get(a);
  const tb = index.tokens.get(b);
  if (!ta || !tb) return false;
  let shared = 0;
  for (const token of ta) {
    if (tb.has(token) && (index.documentFrequency.get(token) ?? 0) <= RARE_DOC_FREQUENCY && ++shared >= 2) return true;
  }
  return false;
}

export function isSameStory(a: NewsItem, b: NewsItem, index: StoryIndex): boolean {
  if (a.id === b.id) return false;
  const hours = Math.abs(new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()) / 3_600_000;
  if (hours > WINDOW_HOURS) return false;
  const similarity = itemSimilarity(a.id, b.id);
  if (similarity === undefined) return false;
  return similarity >= NEAR_DUPLICATE || (similarity >= SAME_STORY && sharesRareTokens(a.id, b.id, index));
}

export interface RelatedItem {
  id: string;
  title: string;
  sourceName: string;
  sourceType: string;
  subgroup: string;
  publishedAt: string;
}

function toRelated(item: NewsItem): RelatedItem {
  const { id, title, sourceName, sourceType, subgroup, publishedAt } = item;
  return { id, title, sourceName, sourceType, subgroup, publishedAt };
}

/**
 * 表示順に並んだ記事をまとめる。各まとまりの先頭（表示順で最も上の記事）を代表にし、
 * 残りを related として添える。まとまりの全員と同じ話題の場合だけ加える（連鎖して無関係な記事がつながるのを防ぐ）
 */
export function groupStories<T extends NewsItem>(items: T[], index: StoryIndex): (T & { related: RelatedItem[] })[] {
  const groups: { lead: T; members: T[] }[] = [];
  for (const item of items) {
    const group = groups.find(candidate => candidate.members.length < 8 && candidate.members.every(member => isSameStory(member, item, index)));
    if (group) group.members.push(item);
    else groups.push({ lead: item, members: [item] });
  }
  return groups.map(({ lead, members }) => ({ ...lead, related: members.slice(1).map(toRelated) }));
}

/** 詳細画面用: ある記事と同じ話題の記事（新しい順） */
export function findRelated(item: NewsItem, allItems: NewsItem[], index: StoryIndex): RelatedItem[] {
  return allItems
    .filter(other => isSameStory(item, other, index))
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 8)
    .map(toRelated);
}
