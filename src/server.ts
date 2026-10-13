import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticleContent } from './articleContent.js';
import { buildBriefing, filterChoices, listNews, newsDetail, onboardingOptions, sourcesWithUsage, withStoredSummaries } from './api.js';
import type { ApiContext } from './api.js';
import { embedItemsInBackground, getEmbeddingStatus, loadItemVectors, prepareSemanticScorer } from './embeddings.js';
import { getNewsById, invalidateNewsCache, listSources, loadNews, setCollectionFilter, sourceId } from './newsPipeline.js';
import { listCategoryGroups } from './newsFilters.js';
import { defaultProfile, semanticQueries } from './profile.js';
import { listProfileIds, loadProfile, saveProfile } from './profileStore.js';
import type { Profile } from './profile.js';
import { getStoredSummaries, getSummaryProviderInfo, summarize, summarizeLatestInBackground } from './summarizer.js';

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

// 蓄積中の全記事を、要約があれば要約、なければ一覧の説明文でベクトル化する
async function embedAllInBackground() {
  try {
    const items = withStoredSummaries(await getStoredSummaries(), await loadNews());
    await embedItemsInBackground(items.map(item => ({
      id: item.id,
      title: item.title,
      text: ('ai' in item && item.ai?.summary) || item.summary
    })));
  } catch (error) {
    console.error('[embeddings]', error);
  }
}

/** 画面用 API の計算に使う材料（記事・要約・プロフィール・ベクトル）をそろえる。意味による一致は必要なときだけ用意する */
async function apiContext(withSemantic = false): Promise<ApiContext> {
  const profile = await loadProfile();
  return {
    items: await loadNews(),
    summaries: await getStoredSummaries(),
    profile,
    // 埋め込みモデルが使えない場合は null になり、キーワードだけで判定する
    semantic: withSemantic ? await prepareSemanticScorer(semanticQueries(profile)) : null,
    hasVectors: await loadItemVectors(),
    sources: listSources(),
    sourceIdOf: sourceId
  };
}

/**
 * 情報源の取り込み: 利用者の誰か1人でも使っている情報源は取り込み、全員がオフにした情報源は取得も保存もしない。
 * 個々の利用者には、その人がオフにした情報源を表示しない（excludedSources）
 */
let collectedKey = '';
async function updateCollectionFilter(): Promise<void> {
  const profiles = await Promise.all((await listProfileIds()).map(id => loadProfile(id)));
  const excludedByAll = new Set(listSources()
    .filter(source => profiles.every(profile => !sourceInScope(source, profile)))
    .map(source => source.id));
  setCollectionFilter(id => !excludedByAll.has(id));
  const key = [...excludedByAll].sort().join(',');
  // 取り込む情報源が変わった場合は、次の表示で取り込み直す（オンに戻した情報源をすぐ表示するため）
  if (collectedKey && key !== collectedKey) invalidateNewsCache();
  collectedKey = key;
}

/** 利用者がオフにしておらず、選んだ地域に含まれる情報源か */
function sourceInScope(source: { id: string; subgroup: string }, profile: Profile): boolean {
  return !profile.excludedSources.includes(source.id) && (!profile.regions.length || profile.regions.includes(source.subgroup));
}

// 情報源の一覧（設定画面用）。直近30日の取り込み件数と、この利用者が使っているかを添える
app.get('/api/sources', async (_req, res) => {
  try {
    res.json(sourcesWithUsage(await apiContext()));
  } catch (error) {
    console.error('[api/sources]', error);
    res.status(500).json({ error: '情報源の一覧を取得できませんでした。' });
  }
});

app.get('/api/filters', async (_req, res) => {
  res.json(filterChoices(await loadProfile()));
});

app.get('/api/options', async (_req, res) => {
  res.json(onboardingOptions(await apiContext()));
});

// 関心プロフィール（現在は1人分。複数ユーザー化の際はログイン中のユーザー ID で切り替える）
app.get('/api/profile', async (_req, res) => {
  res.json(await loadProfile());
});

app.put('/api/profile', async (req, res) => {
  try {
    const profile = await saveProfile(req.body);
    await updateCollectionFilter();
    res.json(profile);
  } catch (error) {
    res.status(400).json({ error: `プロフィールの形式が正しくありません: ${(error as Error).message.slice(0, 300)}` });
  }
});

app.post('/api/profile/reset', async (_req, res) => {
  const profile = await saveProfile(defaultProfile());
  await updateCollectionFilter();
  res.json(profile);
});

app.get('/api/categories', (_req, res) => {
  res.json(listCategoryGroups());
});

app.get('/api/news', async (req, res) => {
  const { forYou, category, subgroup, sourceType, keyword, offset, limit } = req.query;
  const text = (value: unknown) => (typeof value === 'string' ? value : undefined);

  try {
    const { items, total } = listNews(await apiContext(true), {
      forYou: forYou === '1',
      category: text(category),
      subgroup: text(subgroup),
      sourceType: text(sourceType),
      keyword: text(keyword),
      offset: Number(offset),
      limit: Number(limit)
    });
    res.set('X-Total-Count', String(total));
    res.json(items);

    // 最新記事の要約を裏で進める（抽出型は自動、LLM は AUTO_SUMMARY_LIMIT の件数まで）
    void loadNews().then(summarizeLatestInBackground).catch(error => console.error('[summary]', error));
    // 新しい記事を意味で判定できるよう、裏でベクトル化しておく
    void embedAllInBackground();
  } catch (error) {
    console.error('[api/news]', error);
    res.status(500).json({ error: 'ニュースの取得に失敗しました。' });
  }
});

app.get('/api/briefing', async (_req, res) => {
  try {
    res.json(buildBriefing(await apiContext(true)));
  } catch (error) {
    console.error('[api/briefing]', error);
    res.status(500).json({ error: 'ブリーフィングを作成できませんでした。' });
  }
});

// 記事詳細: 一覧の情報に加えて、発信元ページから抽出した冒頭部分（概要）を返す
app.get('/api/news/:id', async (req, res) => {
  try {
    const detail = newsDetail(await apiContext(), req.params.id);
    if (!detail) {
      res.status(404).json({ error: '記事が見つかりません。' });
      return;
    }
    const { item } = detail;
    const content = item.isSample
      ? { status: 'unavailable' as const, paragraphs: [], truncated: false }
      : await fetchArticleContent(item.sourceUrl);

    res.json({
      ...detail,
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

// 最初の取り込みより前に、利用者がオフにした情報源を反映しておく
await updateCollectionFilter().catch(error => console.error('[sources]', error));

app.listen(port, () => {
  console.log(`Personal news app is running at http://localhost:${port}`);
  void embedAllInBackground();
});
