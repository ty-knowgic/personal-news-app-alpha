import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticleContent } from './articleContent.js';
import { embedItemsInBackground, getEmbeddingStatus, loadItemVectors, prepareSemanticScorer } from './embeddings.js';
import { cleanFeedText, getNews, getNewsById, listCategoryGroups, listFilterOptions, loadNews } from './newsPipeline.js';
import { defaultProfile, loadProfile, matchTopics, rankForYou, saveProfile, semanticQueries } from './profile.js';
import { buildStoryIndex, findRelated, groupStories } from './stories.js';
import { getStoredSummaries, getSummaryProviderInfo, summarize, summarizeLatestInBackground } from './summarizer.js';
import type { NewsItem } from './types.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: 'alpha' });
});

app.get('/api/config', (_req, res) => {
  res.json({ summaryEnabled: true, ...getSummaryProviderInfo(), semantic: getEmbeddingStatus() });
});

// 保存済みの要約があれば一覧用の項目に添える（ここでは新たな要約は作らない）
async function withStoredSummaries(items: NewsItem[]) {
  const summaries = await getStoredSummaries();
  return items.map((item) => {
    const summary = summaries.get(item.id);
    return summary ? { ...item, ai: { headlineJa: summary.headlineJa, summary: summary.summary, method: summary.method } } : item;
  });
}

// 蓄積中の全記事を、要約があれば要約、なければ一覧の説明文でベクトル化する
async function embedAllInBackground() {
  try {
    const items = await withStoredSummaries(await loadNews());
    await embedItemsInBackground(items.map(item => ({
      id: item.id,
      title: item.title,
      text: ('ai' in item && item.ai?.summary) || item.summary
    })));
  } catch (error) {
    console.error('[embeddings]', error);
  }
}

/**
 * 表示順の記事を話題ごとにまとめる。マイニュースでは、複数の発信元が伝えている話題を少し上位にする
 * （官公庁の発表と報道の両方がある、など。同じ発信元の続報は数えない）
 */
async function groupForDisplay<T extends NewsItem & { score?: number }>(items: T[], byScore: boolean) {
  if (!(await loadItemVectors())) return items.map(item => ({ ...item, related: [] }));
  const grouped = groupStories(items, buildStoryIndex(await loadNews()));
  if (!byScore) return grouped;
  const coverage = (item: (typeof grouped)[number]) => new Set([item.sourceName, ...item.related.map(related => related.sourceName)]).size;
  return grouped
    .map(item => ({ item, score: (item.score ?? 0) * (1 + 0.25 * Math.min(2, coverage(item) - 1)) }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

app.get('/api/filters', (_req, res) => {
  res.json(listFilterOptions());
});

// 関心プロフィール（現在は1人分。複数ユーザー化の際はログイン中のユーザー ID で切り替える）
app.get('/api/profile', async (_req, res) => {
  res.json(await loadProfile());
});

app.put('/api/profile', async (req, res) => {
  try {
    res.json(await saveProfile(req.body));
  } catch (error) {
    res.status(400).json({ error: `プロフィールの形式が正しくありません: ${(error as Error).message.slice(0, 300)}` });
  }
});

app.post('/api/profile/reset', async (_req, res) => {
  res.json(await saveProfile(defaultProfile()));
});

app.get('/api/categories', (_req, res) => {
  res.json(listCategoryGroups());
});

app.get('/api/news', async (req, res) => {
  const { forYou, category, subgroup, sourceType, keyword, offset, limit } = req.query;

  try {
    const filtered = await getNews({
      category: typeof category === 'string' ? category : undefined,
      subgroup: typeof subgroup === 'string' ? subgroup : undefined,
      sourceType: typeof sourceType === 'string' ? sourceType : undefined,
      keyword: typeof keyword === 'string' ? keyword : undefined
    });

    // マイニュースは関心プロフィールに一致する記事を関連度順に、それ以外は新しい順に返す。
    // どちらの場合も、どの関心トピックに一致したかを添える
    const profile = await loadProfile();
    const withSummaries = await withStoredSummaries(filtered);
    // 埋め込みモデルが使えない場合は null になり、キーワードだけで判定する
    const semantic = await prepareSemanticScorer(semanticQueries(profile));
    const ranked = forYou === '1'
      ? rankForYou(withSummaries, profile, semantic)
      : withSummaries.map(item => ({ ...item, matches: matchTopics(item, profile, semantic) }));
    // 同じ出来事の発表・報道は1枚のカードにまとめる（埋め込みが使えない場合はまとめない）
    const result = await groupForDisplay(ranked, forYou === '1');

    // 蓄積データが多くなっても端末側の負荷が増えないよう、ページ単位で返す
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.min(200, Math.max(1, Number(limit) || 200));
    res.set('X-Total-Count', String(result.length));
    res.json(result.slice(start, start + size));

    // 最新記事の要約を裏で進める（抽出型は自動、LLM は AUTO_SUMMARY_LIMIT の件数まで）
    void loadNews().then(summarizeLatestInBackground).catch(error => console.error('[summary]', error));
    // 新しい記事を意味で判定できるよう、裏でベクトル化しておく
    void embedAllInBackground();
  } catch (error) {
    console.error('[api/news]', error);
    res.status(500).json({ error: 'ニュースの取得に失敗しました。' });
  }
});

/** 要約（なければ説明文）の最初の一文を、ブリーフィング用の短い説明にする */
function firstSentence(text: string, max = 90): string {
  const clean = cleanFeedText(text);
  const match = clean.match(/^.+?(?:。|[.!?](?=\s|$))/);
  const sentence = match ? match[0] : clean;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

/**
 * 今日のブリーフィング: マイニュースのうち直近の話題から、関心トピックが偏らないよう最大5件を選ぶ。
 * 文章は記事の要約・説明文から取り出すだけで、生成AIは使わない
 */
app.get('/api/briefing', async (_req, res) => {
  try {
    const profile = await loadProfile();
    const semantic = await prepareSemanticScorer(semanticQueries(profile));
    const items = await withStoredSummaries(await loadNews());
    const stories = await groupForDisplay(rankForYou(items, profile, semantic), true);
    const boostOnly = new Set(profile.topics.filter(topic => topic.boostOnly).map(topic => topic.id));
    const MAX_PER_TOPIC = 2;

    // 週末など新しい記事が少ない場合は、対象期間を広げる（関心トピックが偏らずに5件選べるまで）
    const within = (hours: number) => stories.filter(story => Date.now() - new Date(story.publishedAt).getTime() <= hours * 3_600_000);
    const pick = (candidates: typeof stories) => {
      const perTopic = new Map<string, number>();
      const picked: typeof stories = [];
      for (const story of candidates) {
        // 本文で触れているだけ・内容の近さが弱いなど、一致の弱い記事はブリーフィングには載せない
        if (!story.matches.some(match => !boostOnly.has(match.id) && match.strength >= 0.75)) continue;
        const topic = story.matches.find(match => !boostOnly.has(match.id))?.id ?? '';
        if ((perTopic.get(topic) ?? 0) >= MAX_PER_TOPIC) continue;
        perTopic.set(topic, (perTopic.get(topic) ?? 0) + 1);
        picked.push(story);
        if (picked.length >= 5) break;
      }
      return picked;
    };
    let windowHours = 24;
    let recent = within(windowHours);
    let picked = pick(recent);
    for (const hours of [48, 72]) {
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

    res.json({
      generatedAt: new Date().toISOString(),
      windowHours,
      storyCount: recent.length,
      topics: topicCounts,
      stories: picked.map(story => ({
        id: story.id,
        title: ('ai' in story && story.ai?.headlineJa) || story.title,
        line: firstSentence(('ai' in story && story.ai?.summary) || story.summary),
        category: story.category,
        subgroup: story.subgroup,
        sourceName: story.sourceName,
        sourceType: story.sourceType,
        publishedAt: story.publishedAt,
        matches: story.matches,
        related: story.related
      }))
    });
  } catch (error) {
    console.error('[api/briefing]', error);
    res.status(500).json({ error: 'ブリーフィングを作成できませんでした。' });
  }
});

// 記事詳細: 一覧の情報に加えて、発信元ページから抽出した冒頭部分（概要）を返す
app.get('/api/news/:id', async (req, res) => {
  try {
    const item = await getNewsById(req.params.id);
    if (!item) {
      res.status(404).json({ error: '記事が見つかりません。' });
      return;
    }

    const content = item.isSample
      ? { status: 'unavailable' as const, paragraphs: [], truncated: false }
      : await fetchArticleContent(item.sourceUrl);

    const summaries = await getStoredSummaries();
    const allItems = await loadNews();
    const related = (await loadItemVectors()) ? findRelated(item, allItems, buildStoryIndex(allItems)) : [];
    res.json({
      item,
      related,
      summary: summaries.get(item.id) ?? null,
      summaryEnabled: true,
      // 見出しと同じ段落は詳細画面で重複するため除く（キャッシュ側は書き換えない）
      content: { ...content, paragraphs: content.paragraphs.filter(paragraph => paragraph !== item.title) }
    });
  } catch (error) {
    console.error('[api/news/:id]', error);
    res.status(500).json({ error: '記事の取得に失敗しました。' });
  }
});

// 記事の要約: 保存済みならそれを返し、なければ作成する（抽出型は一瞬、LLM の場合は数秒〜数十秒）
app.get('/api/news/:id/summary', async (req, res) => {
  try {
    const item = await getNewsById(req.params.id);
    if (!item) {
      res.status(404).json({ error: '記事が見つかりません。' });
      return;
    }

    const result = await summarize(item);
    if (result.status === 'ok') {
      res.json({ summary: result.summary });
    } else {
      res.status(502).json({ error: result.message });
    }
  } catch (error) {
    console.error('[api/news/:id/summary]', error);
    res.status(500).json({ error: '要約の作成に失敗しました。' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(port, () => {
  console.log(`Personal news app is running at http://localhost:${port}`);
  void embedAllInBackground();
});
