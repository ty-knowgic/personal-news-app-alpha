import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticleContent } from './articleContent.js';
import { getNews, getNewsById, listCategoryGroups, listFilterOptions, loadNews } from './newsPipeline.js';
import { defaultProfile, loadProfile, matchTopics, rankForYou, saveProfile } from './profile.js';
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
  res.json({ summaryEnabled: true, ...getSummaryProviderInfo() });
});

// 保存済みの要約があれば一覧用の項目に添える（ここでは新たな要約は作らない）
async function withStoredSummaries(items: NewsItem[]) {
  const summaries = await getStoredSummaries();
  return items.map((item) => {
    const summary = summaries.get(item.id);
    return summary ? { ...item, ai: { headlineJa: summary.headlineJa, summary: summary.summary, method: summary.method } } : item;
  });
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
    const result = forYou === '1'
      ? rankForYou(withSummaries, profile)
      : withSummaries.map(item => ({ ...item, matches: matchTopics(item, profile) }));

    // 蓄積データが多くなっても端末側の負荷が増えないよう、ページ単位で返す
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.min(200, Math.max(1, Number(limit) || 200));
    res.set('X-Total-Count', String(result.length));
    res.json(result.slice(start, start + size));

    // 最新記事の要約を裏で進める（抽出型は自動、LLM は AUTO_SUMMARY_LIMIT の件数まで）
    void loadNews().then(summarizeLatestInBackground).catch(error => console.error('[summary]', error));
  } catch (error) {
    console.error('[api/news]', error);
    res.status(500).json({ error: 'ニュースの取得に失敗しました。' });
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
    res.json({
      item,
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
});
