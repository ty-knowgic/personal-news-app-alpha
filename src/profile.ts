import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { SemanticScorer } from './embeddings.js';
import type { NewsItem } from './types.js';

/**
 * 関心プロフィールと「マイニュース」の並べ替え。
 * 記事の見出し・説明文・要約に関心トピックのキーワードが含まれるか、または
 * トピックの説明文と記事の意味が近いか（手元で動く埋め込みモデルによる判定）で一致とする。生成AIは使わない。
 * 将来の複数ユーザー化に備え、プロフィールは ID ごとに保存する。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, '../data/profiles');
export const DEFAULT_PROFILE_ID = 'default';

const TopicSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  label: z.string().min(1).max(40),
  enabled: z.boolean().default(true),
  /** 意味で探すための説明文（日本語・英語どちらでも）。空の場合はキーワードだけで判定する（地域名のように意味では判定しにくいトピック） */
  description: z.string().max(600).optional(),
  /** いずれかを含めば一致（英字は単語単位、大文字小文字を区別しない） */
  keywords: z.array(z.string().min(1).max(60)).max(80).default([]),
  /** 指定した場合、さらにこのいずれかも含む記事だけを一致とする（例: 日本×カナダ） */
  alsoRequires: z.array(z.string().min(1).max(60)).max(80).default([]),
  /** 記事の地域がこれらの場合は alsoRequires を満たしたものとみなす */
  alsoRequiresRegions: z.array(z.string()).default([]),
  /** 指定した地域の記事に限る */
  regions: z.array(z.string()).default([]),
  /** 指定した種類の発信元（official / corporate / research / npo）の記事に限る */
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
  /** 初回の質問（地域・分野）に答えたか */
  onboarded: z.boolean().default(false),
  /** 受け取る国・地域（空ならすべて）。対象外の地域の情報源は取り込まない */
  regions: z.array(z.string().max(20)).max(20).default([]),
  /** 柱とする分野（空ならすべて）。タブの並びと、すべてのタブ・ブリーフィングの対象を決める */
  categories: z.array(z.string().max(20)).max(30).default([]),
  topics: z.array(TopicSchema).max(30),
  /** 使わない情報源の ID（すべてのタブ・ブリーフィングから除き、誰も使わない情報源は取り込まない） */
  excludedSources: z.array(z.string().regex(/^[0-9a-f]{10}$/)).max(500).default([])
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Topic = z.infer<typeof TopicSchema>;

/** 初期プロフィール（ウォータールー在住、生成AI・Physical AI・日加・米欧・数学に関心のある事業開発コンサルタント） */
const DEFAULT_PROFILE: Profile = {
  name: 'Waterloo, ON',
  onboarded: false,
  regions: [],
  categories: [],
  excludedSources: [],
  topics: [
    {
      id: 'local', label: 'ウォータールー周辺', enabled: true, weight: 1, sourceTypes: [], regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: ['ウォータールー市', 'キッチナー市', 'ケンブリッジ市', 'ウォータールー・リージョン'], boostOnly: false,
      keywords: ['Waterloo', 'Kitchener', 'Guelph', 'Region of Waterloo', 'Waterloo Region', 'Wellington County', 'Communitech', 'Perimeter Institute', 'University of Waterloo', 'Wilfrid Laurier', 'Conestoga', 'southern Ontario', 'FedDev', 'ウォータールー', 'キッチナー']
    },
    {
      id: 'ontario', label: 'オンタリオ州', enabled: true, weight: 0.6, sourceTypes: [], regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: ['オンタリオ州政府'], boostOnly: false,
      keywords: ['Ontario', 'Ont.', 'Toronto', 'オンタリオ', 'トロント']
    },
    {
      id: 'genai', label: '生成AI',
      description: '生成AI: 大規模言語モデル（LLM）、AIエージェント、基盤モデルの研究開発、生成AIの企業導入、AIスタートアップ、AIインフラ。Generative AI, large language models, AI agents, foundation models, enterprise AI adoption, AI startups and AI infrastructure.', enabled: true, weight: 1.6, regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: [], boostOnly: false, sourceTypes: [],
      keywords: ['生成AI', '生成ＡＩ', 'LLM', '大規模言語モデル', 'AIエージェント', 'ChatGPT', 'generative AI', 'GenAI', 'large language model', 'AI agent', 'AI agents', 'foundation model', 'OpenAI', 'Anthropic', 'Gemini', 'Claude', 'Cohere', 'Mistral', 'artificial intelligence']
    },
    {
      id: 'physical-ai', label: 'Physical AI・ロボット',
      description: 'Physical AI・ロボット: ロボティクス、ヒューマノイド、ロボット学習、自動運転、ドローン、身体性AI、シミュレーションと世界モデル。Physical AI and robotics: humanoids, robot learning, manipulation, autonomous vehicles, drones, embodied AI, world models and simulation.', enabled: true, weight: 1.6, regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: [], boostOnly: false, sourceTypes: [],
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
      id: 'us-eu-tech-policy', label: '米国・EU のテック政策',
      description: '米国・EUのテクノロジー政策: AI規制、半導体、輸出管理、デジタル市場、サイバーセキュリティ、技術標準。US and EU technology policy: AI regulation and safety, semiconductors, export controls, digital markets, cybersecurity and technical standards.', enabled: true, weight: 1.2, regions: ['米国', '欧州'], alsoRequiresRegions: [], sources: [], boostOnly: false,
      // 企業ブログはどれも「AI」を含むため、政府・研究機関の発表に限る
      sourceTypes: ['official', 'research'],
      keywords: ['AI', 'artificial intelligence', 'AI Act', 'digital', 'semiconductor', 'semiconductors', 'chips', 'quantum', 'cybersecurity', 'standards', 'export control', 'export controls', 'tariff', 'tariffs'],
      alsoRequires: []
    },
    {
      id: 'math', label: '数学・新発見',
      description: '数学・新発見: 数学の研究、定理や予想の証明、理論物理や量子などの基礎科学の新しい発見、数理科学の研究者と研究資金。Mathematics and new scientific discoveries: theorems, conjectures, fundamental science, quantum research, mathematicians and research funding.', enabled: true, weight: 1.5, sourceTypes: [], regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: ['Simons Foundation', 'Clay Mathematics Institute'], boostOnly: false,
      keywords: ['数学', '数学者', '定理', 'アルゴリズム', '量子', 'mathematics', 'mathematical', 'mathematician', 'mathematicians', 'theorem', 'conjecture', 'algorithm', 'algorithms', 'topology', 'geometry', 'number theory', 'combinatorics', 'quantum']
    },
    {
      // 本業に近い分野（生成AI・Physical AI・日加など）での提携や資金調達の記事を上位にする
      id: 'bizdev', label: '提携・資金調達・M&A',
      description: '事業提携・資金調達・M&A: 業務提携、資本提携、スタートアップの資金調達、買収、合弁会社、海外市場への進出。Business partnerships, startup funding rounds, acquisitions, joint ventures and market expansion.', enabled: true, weight: 1, regions: [], alsoRequires: [], alsoRequiresRegions: [], sources: [], boostOnly: true, sourceTypes: [],
      keywords: ['業務提携', '資本提携', '資金調達', '買収', '出資', '合弁', 'partnership', 'partners with', 'acquisition', 'acquires', 'funding', 'raises $', 'investment', 'joint venture', 'expansion', 'launches in Canada', 'market entry']
    }
  ]
};

const cache = new Map<string, Profile>();

/** 説明文の導入前に保存したプロフィールには、初期設定の同じトピックの説明文を補う */
function withDefaultDescriptions(profile: Profile): Profile {
  const defaults = new Map(DEFAULT_PROFILE.topics.map(topic => [topic.id, topic.description]));
  return { ...profile, topics: profile.topics.map(topic => (topic.description === undefined ? { ...topic, description: defaults.get(topic.id) } : topic)) };
}

/** 意味での一致判定に使う、各トピックの説明文 */
export function semanticQueries(profile: Profile): { id: string; description: string }[] {
  return profile.topics
    .filter(topic => topic.enabled && topic.description?.trim())
    .map(topic => ({ id: topic.id, description: topic.description!.trim() }));
}

function profilePath(id: string): string {
  return path.join(PROFILE_DIR, `${id.replace(/[^a-z0-9-]/gi, '')}.json`);
}

export async function loadProfile(id = DEFAULT_PROFILE_ID): Promise<Profile> {
  const cached = cache.get(id);
  if (cached) return cached;
  let profile = DEFAULT_PROFILE;
  try {
    profile = withDefaultDescriptions(ProfileSchema.parse(JSON.parse(await readFile(profilePath(id), 'utf8'))));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[profile] 読み込みに失敗したため初期設定を使います: ${(error as Error).message}`);
    }
  }
  cache.set(id, profile);
  return profile;
}

/** 保存済みのプロフィールの ID の一覧（初期設定のままなら default だけ） */
export async function listProfileIds(): Promise<string[]> {
  try {
    const ids = (await readdir(PROFILE_DIR)).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
    return ids.includes(DEFAULT_PROFILE_ID) ? ids : [DEFAULT_PROFILE_ID, ...ids];
  } catch {
    return [DEFAULT_PROFILE_ID];
  }
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
  /** 0〜1。見出し（または発信元）で一致した場合 1、本文・説明文だけで一致した場合 0.5、意味の近さで一致した場合はその度合い */
  strength: number;
  /** 一致の根拠: キーワード / 意味の近さ / 発信元 */
  via: 'keyword' | 'semantic' | 'source';
}

/** キーワードで一致しても、類似度がしきい値よりこれ以上低ければ弱い一致とする（手元の評価では、ここより下はほとんどが誤一致） */
const WEAK_MARGIN = 0.13;
/** 発信元で一致した記事を、内容が離れているとみなす差（手元の評価: 植物学の奨学金 0.21、数学関連 0.25 以上） */
const SOURCE_MARGIN = 0.04;

/**
 * 類似度がしきい値ちょうどなら 0.3、しきい値より約 0.09 高ければ 1。
 * しきい値付近は「AI の家庭教師」が Physical AI に一致するような誤りが多いため、弱い一致として扱う
 */
function semanticStrength(similarity: number, threshold: number): number {
  return Math.min(1, 0.3 + (similarity - threshold) * 8);
}

/**
 * 特定の分野に絞ったフィードの記事は、見出しに語が無くても（ロボット学会の開催報告など）そのトピックに一致とする。
 * 保存済みのプロフィールを書き換えずに使えるよう、フィードの URL で対応づける。内容が離れた記事は発信元と同じ基準で弱い一致にする
 */
const DEDICATED_FEEDS: Record<string, string[]> = {
  'https://www.openrobotics.org/blog?format=rss': ['physical-ai'],
  'https://www.ri.cmu.edu/feed/': ['physical-ai'],
  'https://news.mit.edu/topic/mitrobotics-rss.xml': ['physical-ai'],
  'https://www.clearpathrobotics.com/feed/': ['physical-ai'],
  'https://sanctuary.ai/feed/': ['physical-ai'],
  'https://www.ntia.gov/rss.xml': ['us-eu-tech-policy'],
  'https://digital-strategy.ec.europa.eu/en/rss.xml': ['us-eu-tech-policy'],
  'https://www.gov.uk/government/organisations/department-for-science-innovation-and-technology.atom': ['us-eu-tech-policy'],
  'https://www.gov.uk/government/organisations/ai-security-institute.atom': ['us-eu-tech-policy']
};

export function matchTopics(
  item: NewsItem & { ai?: { summary?: string; headlineJa?: string } },
  profile: Profile,
  semantic?: SemanticScorer | null
): TopicMatch[] {
  const headline = `${item.title} ${item.ai?.headlineJa ?? ''}`;
  const text = `${headline} ${item.summary} ${item.ai?.summary ?? ''} ${item.sourceName}`;
  const matches: TopicMatch[] = [];

  for (const topic of profile.topics) {
    if (!topic.enabled) continue;
    if (topic.regions.length && !topic.regions.includes(item.subgroup)) continue;
    if (topic.sourceTypes.length && !topic.sourceTypes.includes(item.sourceType)) continue;
    if (topic.sources.includes(item.sourceName) || DEDICATED_FEEDS[item.feedUrl]?.includes(topic.id)) {
      // 発信元で一致としても、内容がトピックと大きく離れている記事（例: 数学の財団による植物学の奨学金）は弱い一致にする
      const similarity = semantic?.similarity(item.id, topic.id);
      // 発信元は分野が広い場合がある（Simons Foundation は数学以外の科学も扱う）ため、キーワードより厳しく判定する
      const offTopic = similarity !== undefined && similarity < semantic!.threshold - SOURCE_MARGIN;
      matches.push({ id: topic.id, label: topic.label, strength: offTopic ? 0.3 : 1, via: 'source' });
      continue;
    }
    const { keywords, shortUpper, alsoRequires } = compile(topic);
    // 「日本×カナダ」のような組み合わせの条件は、意味で一致した場合にも満たす必要がある
    if (alsoRequires && !topic.alsoRequiresRegions.includes(item.subgroup) && !alsoRequires.test(text)) continue;

    const hit = Boolean(keywords?.test(text) || shortUpper?.test(text));
    // 見出しに関心の語がある記事は、本文で触れているだけの記事より関連が強い
    let keywordStrength = !hit ? 0 : (keywords?.test(headline) || shortUpper?.test(headline)) ? 1 : 0.5;
    // キーワードを含まなくても、トピックの説明文と意味が近い記事は一致とする（例: 「ロボット」と書かずにロボット学習を扱う論文）
    const similarity = semantic?.similarity(item.id, topic.id);
    // 逆に、キーワードを含んでも内容がトピックと大きく離れている記事（例: 「quantum」を含む物理学の記事が
    // テック政策に一致）は、一致の強さを半分にする
    if (keywordStrength && similarity !== undefined && similarity < semantic!.threshold - WEAK_MARGIN) keywordStrength /= 2;
    const meaningStrength = similarity !== undefined && similarity >= semantic!.threshold ? semanticStrength(similarity, semantic!.threshold) : 0;

    if (!keywordStrength && !meaningStrength) continue;
    matches.push({
      id: topic.id,
      label: topic.label,
      strength: Math.max(keywordStrength, meaningStrength),
      via: keywordStrength ? 'keyword' : 'semantic'
    });
  }

  // 補助的なトピック（提携・資金調達など）だけに一致した記事は対象外
  const boostOnly = new Set(profile.topics.filter(topic => topic.boostOnly).map(topic => topic.id));
  return matches.some(match => !boostOnly.has(match.id)) ? matches : [];
}

/** マイニュースの並べ替え: 一致したトピックの重み × 一致の強さの合計 × 新しさ（3日で約半分になる） */
export function rankForYou<T extends NewsItem>(items: T[], profile: Profile, semantic?: SemanticScorer | null): (T & { matches: TopicMatch[]; score: number })[] {
  const weights = new Map(profile.topics.map(topic => [topic.id, topic.weight]));
  const now = Date.now();

  return items
    .map(item => ({ ...item, matches: matchTopics(item, profile, semantic) }))
    .filter(item => item.matches.length > 0)
    .map((item) => {
      const relevance = item.matches.reduce((sum, match) => sum + (weights.get(match.id) ?? 1) * match.strength, 0);
      const ageHours = Math.max(0, (now - new Date(item.publishedAt).getTime()) / 3_600_000);
      return { item, score: relevance * Math.pow(0.5, ageHours / 72) };
    })
    .sort((a, b) => b.score - a.score)
    .map(({ item, score }) => ({ ...item, score }));
}
