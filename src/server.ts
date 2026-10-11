import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchArticleContent } from './articleContent.js';
import { getNews, getNewsById, listCategoryGroups } from './newsPipeline.js';

const app = express();
const port = Number(process.env.PORT ?? 3000);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', version: 'alpha' });
});

app.get('/api/categories', (_req, res) => {
  res.json(listCategoryGroups());
});

app.get('/api/news', async (req, res) => {
  const { category, subgroup, keyword, offset, limit } = req.query;

  try {
    const result = await getNews({
      category: typeof category === 'string' ? category : undefined,
      subgroup: typeof subgroup === 'string' ? subgroup : undefined,
      keyword: typeof keyword === 'string' ? keyword : undefined
    });

    // 蓄積データが多くなっても端末側の負荷が増えないよう、ページ単位で返す
    const start = Math.max(0, Number(offset) || 0);
    const size = Math.min(200, Math.max(1, Number(limit) || 200));
    res.set('X-Total-Count', String(result.length));
    res.json(result.slice(start, start + size));
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

    res.json({
      item,
      // 見出しと同じ段落は詳細画面で重複するため除く（キャッシュ側は書き換えない）
      content: { ...content, paragraphs: content.paragraphs.filter(paragraph => paragraph !== item.title) }
    });
  } catch (error) {
    console.error('[api/news/:id]', error);
    res.status(500).json({ error: '記事の取得に失敗しました。' });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(port, () => {
  console.log(`Personal news app is running at http://localhost:${port}`);
});
