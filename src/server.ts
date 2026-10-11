import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNews, listCategoryGroups } from './newsPipeline.js';

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
  const { category, subgroup, keyword } = req.query;

  const result = await getNews({
    category: typeof category === 'string' ? category : undefined,
    subgroup: typeof subgroup === 'string' ? subgroup : undefined,
    keyword: typeof keyword === 'string' ? keyword : undefined
  });

  res.json(result);
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(port, () => {
  console.log(`Personal news app is running at http://localhost:${port}`);
});
