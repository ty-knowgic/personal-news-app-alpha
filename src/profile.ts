import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { NewsItem } from './types.js';

/**
 * 関心プロフィールと「マイニュース」の並べ替え。
 * 記事の見出し・説明文・要約に、関心トピックのキーワードが含まれるかで判定する（生成AIは使わない）。
 * 将来の複数ユーザー化に備え、プロフィールは ID ごとに保存する。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '../data/profiles');
export const DEFAULT_PROFILE_ID = 'default';

const TopicSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().min(1).max(40),
  enabled: z.boolean().default(true),
  /** いずれかを含めば一致（英字は単語単位、大文字小文字を区別しない） */
  keywords: z.array(z.string().min(1).max(60)).max(80).default([]),
  /** 指定した場合、さらにこのいずれかも含む記事だけを一致とする（例: 日本×カナダ） */
  alsoRequires: z.array(z.string().min(1).max(60)).max(80).default([]),
  /** 記事の地域がこれらの場合は alsoRequires を満たしたものとみなす */
  alsoRequiresRegions: z.array(z.string()).default([]),
  /** 指定した地域の記事に限る */
  regions: z.array(z.string()).default([]),
  /** 指定した種類の発信元（official / corporate / research / media）の記事に限る */
  sourceTypes: z.array(z.string()).default([]),
  /** これらの発信元の記事は、キーワードがなくても一致とする（例: 地域ニュースの配信元） */
  sources: z.array(z.string()).default([]),
  /** 単独では一致とせず、他のトピックにも一致した記事の関連度を上げるだけにする */
  boostOnly: z.boolean().default(false),
  /** 関連度の重み（地域・本業に近いほど大きく） */
  weight: z.number().min(0.1).max(5).default(1)
});

export const ProfileSchema = z.object({
  name: z.string().max(60).default(''),
  topics: z.array(TopicSchema).max(30)
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Topic = z.infer<typeof TopicSchema>;

/** 初期プロフィール（ウォータールー在住、生成AI・Physical AI・日加・米欧・数学に関心のある事業開発コンサルタント） */
const DEFAULT_PROFILE: Profile = {
  name: 'Waterloo, ON',
  topics: [
    {
      id: 'local', label: 'ウォータールー周辺', enabled: true, weight: 1, sourceTypes: [], regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: ['CBC KW'], boostOnly: false,
      keywords: ['Waterloo', 'Kitchener', 'Guelph', 'Region of Waterloo', 'Waterloo Region', 'Wellington County', 'Communitech', 'Perimeter Institute', 'University of Waterloo', 'Wilfrid Laurier', 'Conestoga', 'southern Ontario', 'FedDev', 'ウォータールー', 'キッチナー']
    },
    {
      id: 'ontario', label: 'オンタリオ州', enabled: true, weight: 0.6, sourceTypes: [], regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: ['オンタリオ州政府'], boostOnly: false,
      keywords: ['Ontario', 'Ont.', 'Toronto', 'オンタリオ', 'トロント']
    },
    {
      id: 'genai', label: '生成AI', enabled: true, weight: 1.6, regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: [], boostOnly: false, sourceTypes: [],
      keywords: ['生成AI', '生成ＡＩ', 'LLM', '大規模言語モデル', 'AIエージェント', 'ChatGPT', 'generative AI', 'GenAI', 'large language model', 'AI agent', 'AI agents', 'foundation model', 'OpenAI', 'Anthropic', 'Gemini', 'Claude', 'Cohere', 'Mistral', 'artificial intelligence']
    },
    {
      id: 'physical-ai', label: 'Physical AI・ロボット', enabled: true, weight: 1.6, regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: [], boostOnly: false, sourceTypes: [],
      keywords: ['Physical AI', 'フィジカルAI', 'ロボット', 'ロボティクス', 'ヒューマノイド', '自動運転', 'robot', 'robots', 'robotics', 'robotic', 'humanoid', 'embodied', 'autonomous vehicle', 'autonomous driving', 'self-driving', 'drone', 'drones', 'manipulation', 'vision-language-action', 'world model']
    },
    {
      id: 'japan-canada', label: '日本×カナダ', enabled: true, weight: 2, regions: [], sources: [], boostOnly: false, sourceTypes: [],
      keywords: ['Canada', 'Canadian', 'Ontario', 'カナダ', 'オンタリオ', 'トロント', 'バンクーバー'],
      // カナダの記事は日本への言及があるもの、日本の記事はカナダへの言及があるものを対象にする
      alsoRequires: ['Japan', 'Japanese', 'Tokyo', 'Osaka', '日本', '日系', '日加', '東京'],
      alsoRequiresRegions: ['日本']
    },
    {
      id: 'us-eu-tech-policy', label: '米国・EU のテック政策', enabled: true, weight: 1.2, regions: ['米国', '欧州'], alsoRequiresRegions: [], sources: [], boostOnly: false,
      // 企業ブログはどれも「AI」を含むため、政府・研究機関の発表に限る
      sourceTypes: ['official', 'research'],
      keywords: ['AI', 'artificial intelligence', 'AI Act', 'digital', 'semiconductor', 'semiconductors', 'chips', 'quantum', 'cybersecurity', 'standards', 'export control', 'export controls', 'tariff', 'tariffs'],
      alsoRequires: []
    },
    {
      id: 'math', label: '数学・新発見', enabled: true, weight: 1.5, sourceTypes: [], regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: ['Simons Foundation', 'Quanta Magazine'], boostOnly: false,
      keywords: ['数学', '数学者', '定理', 'アルゴリズム', '量子', 'mathematics', 'mathematical', 'mathematician', 'mathematicians', 'theorem', 'conjecture', 'algorithm', 'algorithms', 'topology', 'geometry', 'number theory', 'combinatorics', 'quantum']
    },
    {
      // 本業に近い分野（生成AI・Physical AI・日加など）での提携や資金調達の記事を上位にする
      id: 'bizdev', label: '提携・資金調達・M&A', enabled: true, weight: 1, regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: [], boostOnly: true, sourceTypes: [],
      keywords: ['業務提携', '資本提携', '資金調達', '買収', '出資', '合弁', 'partnership', 'partners with', 'acquisition', 'acquires', 'funding', 'raises $', 'investment', 'joint venture', 'expansion', 'launches in Canada', 'market entry']
    }
  ]
};

const cache = new Map<string, Profile>();

function profilePath(id: string): string {
  return path.join(PROFILE_DIR, `${id.replace(/[^a-z0-9-]/gi, '')}.json`);
}

export async function loadProfile(id = DEFAULT_PROFILE_ID): Promise<Profile> {
  const cached = cache.get(id);
  if (cached) return cached;
  let profile = DEFAULT_PROFILE;
  try {
    profile = ProfileSchema.parse(JSON.parse(await readFile(profilePath(id), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[profile] 読み込みに失敗したため初期設定を使います: ${(error as Error).message}`);
    }
  }
  cache.set(id, profile);
  return profile;
}

export async function saveProfile(input: unknown, id = DEFAULT_PROFILE_ID): Promise<Profile> {
  const profile = ProfileSchema.parse(input);
  await mkdir(PROFILE_DIR, { recursive: true });
  await writeFile(profilePath(id), JSON.stringify(profile, null, 2));
  cache.set(id, profile);
  matcherCache.clear();
  return profile;
}

export function defaultProfile(): Profile {
  return structuredClone(DEFAULT_PROFILE);
}

// ---------- 一致判定 ----------

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** キーワードの一覧を1つの正規表現にする。英字のキーワードは単語の途中に一致しないよう境界を付ける */
function buildMatcher(keywords: string[]): RegExp | null {
  const parts = keywords
    .map(keyword => keyword.trim())
    .filter(Boolean)
    .map(keyword => /^[\x00-\x7F]+$/.test(keyword)
      // 単語の途中に一致しないよう、英数字で始まる・終わるキーワードにだけ境界を付ける（「raises $」なども扱えるように）
      ? `${/^[A-Za-z0-9]/.test(keyword) ? '(?<![A-Za-z0-9])' : ''}${escapeRegExp(keyword)}${/[A-Za-z0-9]$/.test(keyword) ? '(?![A-Za-z0-9])' : ''}`
      : escapeRegExp(keyword));
  // 「AI」のような短い英字の大文字キーワードは、大文字小文字を区別して誤一致を防ぐ
  return parts.length ? new RegExp(parts.join('|'), 'i') : null;
}

interface CompiledTopic {
  topic: Topic;
  keywords: RegExp | null;
  shortUpper: RegExp | null;
  alsoRequires: RegExp | null;
}

const matcherCache = new Map<Topic, CompiledTopic>();

function compile(topic: Topic): CompiledTopic {
  const cached = matcherCache.get(topic);
  if (cached) return cached;
  const shortUpper = topic.keywords.filter(k => /^[A-Z]{2,3}$/.test(k));
  const others = topic.keywords.filter(k => !/^[A-Z]{2,3}$/.test(k));
  const compiled = {
    topic,
    keywords: buildMatcher(others),
    shortUpper: shortUpper.length ? new RegExp(shortUpper.map(k => `(?<![A-Za-z0-9])${k}(?![A-Za-z0-9])`).join('|')) : null,
    alsoRequires: buildMatcher(topic.alsoRequires)
  };
  matcherCache.set(topic, compiled);
  return compiled;
}

export interface TopicMatch {
  id: string;
  label: string;
  /** 見出し（または発信元）で一致した場合 1、本文・説明文だけで一致した場合 0.5 */
  strength: number;
}

export function matchTopics(item: NewsItem & { ai?: { summary?: string; headlineJa?: string } }, profile: Profile): TopicMatch[] {
  const headline = `${item.title} ${item.ai?.headlineJa ?? ''}`;
  const text = `${headline} ${item.summary} ${item.ai?.summary ?? ''} ${item.sourceName}`;
  const matches: TopicMatch[] = [];

  for (const topic of profile.topics) {
    if (!topic.enabled) continue;
    if (topic.regions.length && !topic.regions.includes(item.subgroup)) continue;
    if (topic.sourceTypes.length && !topic.sourceTypes.includes(item.sourceType)) continue;
    if (topic.sources.includes(item.sourceName)) {
      matches.push({ id: topic.id, label: topic.label, strength: 1 });
      continue;
    }
    const { keywords, shortUpper, alsoRequires } = compile(topic);
    const hit = Boolean(keywords?.test(text) || shortUpper?.test(text));
    if (!hit) continue;
    if (alsoRequires && !topic.alsoRequiresRegions.includes(item.subgroup) && !alsoRequires.test(text)) continue;
    // 見出しに関心の語がある記事は、本文で触れているだけの記事より関連が強い
    const inHeadline = Boolean(keywords?.test(headline) || shortUpper?.test(headline));
    matches.push({ id: topic.id, label: topic.label, strength: inHeadline ? 1 : 0.5 });
  }

  // 補助的なトピック（提携・資金調達など）だけに一致した記事は対象外
  const boostOnly = new Set(profile.topics.filter(topic => topic.boostOnly).map(topic => topic.id));
  return matches.some(match => !boostOnly.has(match.id)) ? matches : [];
}

/** マイニュースの並べ替え: 一致したトピックの重みの合計 × 新しさ（3日で約半分になる） */
export function rankForYou<T extends NewsItem>(items: T[], profile: Profile): (T & { matches: TopicMatch[] })[] {
  const weights = new Map(profile.topics.map(topic => [topic.id, topic.weight]));
  const now = Date.now();

  return items
    .map(item => ({ ...item, matches: matchTopics(item, profile) }))
    .filter(item => item.matches.length > 0)
    .map((item) => {
      const relevance = item.matches.reduce((sum, match) => sum + (weights.get(match.id) ?? 1) * match.strength, 0);
      const ageHours = Math.max(0, (now - new Date(item.publishedAt).getTime()) / 3_600_000);
      return { item, score: relevance * Math.pow(0.5, ageHours / 72) };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}
