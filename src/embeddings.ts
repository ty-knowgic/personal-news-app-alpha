import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createScorer, dot, itemVectors, itemSimilarity, textKey } from './vectors.js';
import type { SemanticScorer } from './vectors.js';

export { itemSimilarity };
export type { SemanticScorer };

/**
 * 意味による関心一致のための文の埋め込み（ベクトル化）。
 * 生成モデルではなく、手元やオンプレミスで動く小さなオープンソースの埋め込みモデルを使う。
 * Ollama・llama.cpp（llama-server）・vLLM・Text Embeddings Inference などが共通で提供する
 * OpenAI 互換の Embeddings API（/v1/embeddings）を使うため、実行環境やモデルは差し替えられる。
 * 実行環境が動いていない場合は何もせず、キーワードによる一致だけで動く。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '../data/embeddings.json');

const BASE_URL = (process.env.EMBEDDING_URL ?? 'http://localhost:11434/v1').replace(/\/+$/, '');
const MODEL = process.env.EMBEDDING_MODEL ?? 'embeddinggemma';
const API_KEY = process.env.EMBEDDING_API_KEY ?? '';
const ENABLED = Boolean(MODEL) && MODEL !== 'off';
const BATCH_SIZE = 32;
// 実行環境に接続できなかった場合、しばらく問い合わせを控える
const RETRY_AFTER_MS = 5 * 60 * 1000;

interface ModelProfile {
  /** 関心トピック（検索の問い）側に付ける書式 */
  query: (text: string) => string;
  /** 記事側に付ける書式 */
  document: (text: string) => string;
  /** この類似度以上で「意味が一致」とみなす（モデルごとに類似度の分布が異なるため、手元の評価で決めた値） */
  threshold: number;
}

// モデルごとの推奨書式としきい値。一覧にないモデルは書式なし・EMBEDDING_THRESHOLD（既定 0.5）で使う
const MODEL_PROFILES: Record<string, ModelProfile> = {
  embeddinggemma: {
    query: text => `task: search result | query: ${text}`,
    document: text => `title: none | text: ${text}`,
    threshold: 0.28
  },
  'qwen3-embedding': {
    query: text => `Instruct: Given a reader's interest, retrieve news articles that match it\nQuery: ${text}`,
    document: text => text,
    threshold: 0.4
  }
};

function modelProfile(): ModelProfile {
  const base = MODEL.split(':')[0].split('/').pop() ?? MODEL;
  const known = MODEL_PROFILES[base];
  const threshold = Number(process.env.EMBEDDING_THRESHOLD) || known?.threshold || 0.5;
  return { query: known?.query ?? (text => text), document: known?.document ?? (text => text), threshold };
}

const PROFILE = modelProfile();

interface StoredVector {
  /** 埋め込んだ文のハッシュ（記事の要約が更新されたら作り直す） */
  h: string;
  /** Float32 のベクトル（Base64） */
  v: string;
}

let store: Map<string, StoredVector> | null = null;
const decoded = itemVectors;
const queryVectors = new Map<string, Float32Array>();
let unavailableUntil = 0;
let lastError = '';
let running: Promise<void> | null = null;

function hash(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

function encode(vector: Float32Array): string {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
}

function decode(base64: string): Float32Array {
  const buffer = Buffer.from(base64, 'base64');
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
}

/** 長さ 1 に正規化する（内積がそのままコサイン類似度になる） */
function normalize(values: number[]): Float32Array {
  const norm = Math.hypot(...values) || 1;
  return Float32Array.from(values, value => value / norm);
}

async function loadStore(): Promise<Map<string, StoredVector>> {
  if (store) return store;
  store = new Map();
  try {
    const data = JSON.parse(await readFile(STORE_PATH, 'utf8')) as { model?: string; vectors?: Record<string, StoredVector> };
    // モデルを変えた場合、ベクトルに互換性がないため作り直す
    if (data.model === MODEL && data.vectors) store = new Map(Object.entries(data.vectors));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[embeddings] 保存データを読み込めませんでした: ${(error as Error).message}`);
  }
  return store;
}

async function saveStore(): Promise<void> {
  if (!store) return;
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, JSON.stringify({ model: MODEL, vectors: Object.fromEntries(store) }));
}

async function requestEmbeddings(inputs: string[]): Promise<Float32Array[]> {
  const response = await fetch(`${BASE_URL}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}) },
    signal: AbortSignal.timeout(120000),
    body: JSON.stringify({ model: MODEL, input: inputs })
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
  const data = await response.json() as { data?: { index?: number; embedding: number[] }[] };
  if (!data.data || data.data.length !== inputs.length) throw new Error('埋め込みの応答の形式が正しくありません');
  return [...data.data]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(entry => normalize(entry.embedding));
}

function isAvailable(): boolean {
  return ENABLED && Date.now() >= unavailableUntil;
}

function markUnavailable(error: unknown): void {
  const message = (error as Error).message ?? String(error);
  if (message !== lastError) console.warn(`[embeddings] ${BASE_URL} の ${MODEL} を使えません（キーワードでの一致だけで動きます）: ${message}`);
  lastError = message;
  unavailableUntil = Date.now() + RETRY_AFTER_MS;
}

export interface EmbeddableItem {
  id: string;
  title: string;
  /** 一覧の説明文、または保存済みの要約 */
  text: string;
}

/** 記事の埋め込みに使う文: 見出しと、説明文（要約）の冒頭 */
function documentText(item: EmbeddableItem): string {
  return `${item.title}\n${item.text.replace(/\s+/g, ' ').trim().slice(0, 600)}`;
}

/**
 * まだ埋め込んでいない記事（または内容が更新された記事）をまとめてベクトル化して保存する。
 * 一覧の表示を待たせないよう、裏で呼ぶ。同時に複数回は走らせない
 */
export function embedItemsInBackground(items: EmbeddableItem[]): Promise<void> {
  if (!isAvailable() || running) return running ?? Promise.resolve();
  running = (async () => {
    const vectors = await loadStore();
    const pending = items
      .map(item => ({ item, text: documentText(item) }))
      .filter(({ item, text }) => vectors.get(item.id)?.h !== hash(text));
    if (!pending.length) return;

    const started = Date.now();
    let done = 0;
    try {
      for (let i = 0; i < pending.length; i += BATCH_SIZE) {
        const batch = pending.slice(i, i + BATCH_SIZE);
        const embeddings = await requestEmbeddings(batch.map(({ text }) => PROFILE.document(text)));
        batch.forEach(({ item, text }, index) => {
          vectors.set(item.id, { h: hash(text), v: encode(embeddings[index]) });
          decoded.set(item.id, embeddings[index]);
        });
        done += batch.length;
      }
      lastError = '';
    } catch (error) {
      markUnavailable(error);
    } finally {
      if (done) {
        // 蓄積期間を過ぎて一覧から消えた記事のベクトルは捨てる
        const current = new Set(items.map(item => item.id));
        for (const id of vectors.keys()) if (!current.has(id)) { vectors.delete(id); decoded.delete(id); }
        await saveStore();
        console.log(`[embeddings] ${done}件をベクトル化しました（${MODEL}、${((Date.now() - started) / 1000).toFixed(1)}秒）`);
      }
    }
  })().finally(() => { running = null; });
  return running;
}

/** 保存済みのベクトルを読み込む（記事のまとめなど、問い合わせなしで類似度を使う処理の前に呼ぶ） */
export async function loadItemVectors(): Promise<boolean> {
  if (!ENABLED) return false;
  const vectors = await loadStore();
  for (const id of vectors.keys()) itemVector(id);
  return vectors.size > 0;
}

function itemVector(id: string): Float32Array | undefined {
  const cached = decoded.get(id);
  if (cached) return cached;
  const stored = store?.get(id);
  if (!stored) return undefined;
  const vector = decode(stored.v);
  decoded.set(id, vector);
  return vector;
}

/** 関心トピックの説明文をベクトル化する（説明文が変わらない限り再利用する） */
async function queryVector(text: string): Promise<Float32Array | undefined> {
  const key = hash(text);
  const cached = queryVectors.get(key);
  if (cached) return cached;
  if (!isAvailable()) return undefined;
  try {
    const [vector] = await requestEmbeddings([PROFILE.query(text)]);
    queryVectors.set(key, vector);
    return vector;
  } catch (error) {
    markUnavailable(error);
    return undefined;
  }
}

/** 関心トピックの説明文から、記事との類似度を返す関数を用意する。使えない場合は null（キーワードだけで判定） */
export async function prepareSemanticScorer(topics: { id: string; description: string }[]): Promise<SemanticScorer | null> {
  if (!ENABLED) return null;
  await loadStore();
  const vectors = new Map<string, Float32Array>();
  for (const topic of topics) {
    if (!topic.description.trim()) continue;
    const vector = await queryVector(topic.description.trim());
    if (vector) vectors.set(topic.id, vector);
  }
  return createScorer(vectors, PROFILE.threshold);
}

/** 保存済みの記事ベクトル（Base64）を、指定した記事の分だけ取り出す（静的サイトへの書き出し用） */
export async function exportItemVectors(ids: string[]): Promise<Record<string, string>> {
  const vectors = await loadStore();
  const out: Record<string, string> = {};
  for (const id of ids) {
    const stored = vectors.get(id);
    if (stored) out[id] = stored.v;
  }
  return out;
}

/** トピックの説明文のベクトル（Base64）を textKey ごとに返す（静的サイトでは、ここで事前計算したものだけを意味での一致に使う） */
export async function exportQueryVectors(texts: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const text of texts) {
    const vector = await queryVector(text.trim());
    if (vector) out[textKey(text.trim())] = encode(vector);
  }
  return out;
}

export function getEmbeddingStatus() {
  return {
    enabled: ENABLED,
    model: ENABLED ? MODEL : null,
    available: ENABLED && Date.now() >= unavailableUntil,
    embeddedCount: store?.size ?? 0,
    threshold: PROFILE.threshold,
    error: lastError || null
  };
}
