// 静的サイト版のデータを site/data/ に書き出す（定期ジョブ、または手元で `npm run export` で実行する）。
// 記事の取得・要約・ベクトル化は、サーバー版と同じコードを使う。
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { embedItemsInBackground, exportItemVectors, exportQueryVectors, getEmbeddingStatus } from '../src/embeddings.js';
import { listSources, loadNews, waitForImageEnrichment } from '../src/newsPipeline.js';
import { defaultProfile } from '../src/profile.js';
import { getStoredSummaries, summarizeLatestInBackground } from '../src/summarizer.js';
import { withStoredSummaries } from '../src/api.js';

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../site/data');
await mkdir(outDir, { recursive: true });

console.log('[export] 記事を取得しています…');
const items = await loadNews();
if (items.every(item => item.isSample)) throw new Error('記事を取得できませんでした（サンプル記事のみ）。公開データは更新しません。');

await waitForImageEnrichment();
console.log(`[export] ${items.length}件。要約を作成しています…`);
await summarizeLatestInBackground(items);
const summaries = await getStoredSummaries();

console.log('[export] ベクトル化しています…');
await embedItemsInBackground(withStoredSummaries(summaries, items).map(item => ({
  id: item.id,
  title: item.title,
  text: ('ai' in item && item.ai?.summary) || item.summary
})));

const ids = new Set(items.map(item => item.id));
const vectors = await exportItemVectors([...ids]);
// 初期設定のトピックの説明文だけ、ここでベクトル化しておく（利用者が自分で足したトピックはキーワードだけで判定する）
// 初期設定のトピックは、初回の質問で選ぶまでは無効なので、有効かどうかに関わらず説明文のあるものすべてを計算する
const topicVectors = await exportQueryVectors(defaultProfile().topics.flatMap(topic => (topic.description?.trim() ? [topic.description] : [])));
const status = getEmbeddingStatus();
const semanticReady = Object.keys(vectors).length > 0 && Object.keys(topicVectors).length > 0;
// 定期ジョブでは、埋め込みが使えない状態のデータを公開しない（前回の公開データを残す）
if (!semanticReady && process.env.REQUIRE_SEMANTIC === '1') throw new Error('埋め込みを使えなかったため、公開データは更新しません。');
if (!semanticReady) console.warn('[export] 埋め込みを使えなかったため、意味による一致なし（キーワードのみ）で書き出します');

const write = (name: string, data: unknown) => writeFile(path.join(outDir, `${name}.json`), JSON.stringify(data));
await Promise.all([
  write('news', items),
  write('sources', listSources()),
  write('summaries', Object.fromEntries([...summaries].filter(([id]) => ids.has(id)))),
  write('vectors', semanticReady ? vectors : {}),
  write('meta', {
    generatedAt: new Date().toISOString(),
    model: semanticReady ? status.model : null,
    threshold: status.threshold,
    topicVectors: semanticReady ? topicVectors : {}
  })
]);
console.log(`[export] 書き出しました: 記事${items.length}件・要約${summaries.size}件・ベクトル${Object.keys(vectors).length}件 → ${outDir}`);
process.exit(0);
