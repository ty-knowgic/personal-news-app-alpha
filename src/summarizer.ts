import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDocumentProxy } from 'unpdf';
import { fetchArticleSource } from './articleContent.js';
import { claudeSummarizer, hasClaudeCredentials } from './summarizers/claude.js';
import { extractiveSummarizer } from './summarizers/extractive.js';
import { isLocalLlmConfigured, localLlmSummarizer } from './summarizers/localLlm.js';
import type { Summarizer, SummaryInput } from './summarizers/types.js';
import type { ArticleSummary, NewsItem } from './types.js';

/**
 * 要約エンジンの切り替え口。SUMMARY_PROVIDER で選ぶ:
 *   extractive（既定）: 生成AIを使わず、本文から重要な文を抜き出す。費用ゼロ・オフラインで動作
 *   local            : 手元・オンプレミスのオープンソースモデル（Ollama / LM Studio / llama.cpp など）
 *   claude           : Claude API
 * LLM の呼び出しに失敗した場合は、抽出型の要約で代替する。
 */

const REQUESTED_PROVIDER = (process.env.SUMMARY_PROVIDER ?? 'extractive').trim().toLowerCase();
// 抽出型は軽いので、新着記事をまとめて事前に要約する。LLM の場合は AUTO_SUMMARY_LIMIT で件数を指定（既定 0）
const CHEAP_AUTO_LIMIT = 80;
const LLM_AUTO_LIMIT = Math.max(0, Number(process.env.AUTO_SUMMARY_LIMIT) || 0);
const AUTO_SUMMARY_CONCURRENCY = 3;
const MAX_PDF_PAGES = 30;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_PATH = path.join(__dirname, '../data/summaries.json');

function selectProvider(): Summarizer {
  if (REQUESTED_PROVIDER === 'local') {
    if (isLocalLlmConfigured()) return localLlmSummarizer;
    console.warn('[summary] SUMMARY_PROVIDER=local ですが LOCAL_LLM_MODEL が未設定のため、抽出型の要約を使います');
  } else if (REQUESTED_PROVIDER === 'claude') {
    if (hasClaudeCredentials()) return claudeSummarizer;
    console.warn('[summary] SUMMARY_PROVIDER=claude ですが Claude の認証情報がないため、抽出型の要約を使います');
  } else if (REQUESTED_PROVIDER !== 'extractive') {
    console.warn(`[summary] 不明な SUMMARY_PROVIDER「${REQUESTED_PROVIDER}」のため、抽出型の要約を使います`);
  }
  return extractiveSummarizer;
}

const provider = selectProvider();
console.log(`[summary] 要約エンジン: ${provider.id}`);

type SummaryResult = { status: 'ok'; summary: ArticleSummary } | { status: 'error'; message: string };

let store: Map<string, ArticleSummary> | null = null;
const inFlight = new Map<string, Promise<SummaryResult>>();

export function getSummaryProviderInfo() {
  return { provider: provider.id, method: provider.method };
}

async function loadStore(): Promise<Map<string, ArticleSummary>> {
  if (store) return store;
  store = new Map();
  try {
    const saved = JSON.parse(await readFile(STORE_PATH, 'utf8')) as Record<string, ArticleSummary>;
    Object.entries(saved).forEach(([id, summary]) => store!.set(id, summary));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[summary] 保存済み要約の読み込みに失敗しました: ${(error as Error).message}`);
    }
  }
  return store;
}

let saveTimer: NodeJS.Timeout | null = null;

// 新着記事をまとめて要約する際に毎回書き込まないよう、保存は少し待ってまとめて行う
function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!store) return;
    try {
      await mkdir(path.dirname(STORE_PATH), { recursive: true });
      await writeFile(STORE_PATH, JSON.stringify(Object.fromEntries(store)));
    } catch (error) {
      console.warn(`[summary] 要約の保存に失敗しました: ${(error as Error).message}`);
    }
  }, 1000);
}

/** 現在のエンジンで作られた保存済み要約（エンジンを切り替えた場合、以前の要約は作り直す） */
export async function getStoredSummaries(): Promise<Map<string, ArticleSummary>> {
  const saved = await loadStore();
  return new Map([...saved].filter(([, summary]) => summary.provider === provider.id));
}

async function pdfToText(base64: string): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(base64, 'base64')));
  const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const texts: string[] = [];
  for (let page = 1; page <= pages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    // 行の区切りを残しておき、後段で折り返しと段落を判別する
    texts.push(content.items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
  }
  return texts.join('\n\n');
}

async function buildInput(item: NewsItem): Promise<SummaryInput> {
  const source = await fetchArticleSource(item.sourceUrl);

  if (source.pdfBase64) {
    let text = '';
    try {
      text = await pdfToText(source.pdfBase64);
    } catch (error) {
      console.warn(`[summary] PDF のテキストを取り出せませんでした: ${(error as Error).message}`);
    }
    return { item, text, basis: 'pdf', pdfBase64: source.pdfBase64 };
  }

  if (source.fullText.length >= 200) {
    return { item, text: source.fullText, basis: 'article' };
  }
  const fallback = [source.content.description, item.summary].filter(Boolean).join('\n\n');
  return { item, text: fallback, basis: 'feed' };
}

async function generate(item: NewsItem): Promise<SummaryResult> {
  const input = await buildInput(item);
  let engine = provider;
  let draft;
  try {
    draft = await provider.summarize(input);
  } catch (error) {
    // LLM が使えない・失敗した場合でも、抽出型で要約を返す（保存はせず、次回あらためて LLM で作る）
    console.warn(`[summary] ${provider.id} での要約に失敗したため抽出型で代替します: ${(error as Error).message}`);
    if (provider === extractiveSummarizer) throw error;
    engine = extractiveSummarizer;
    draft = await extractiveSummarizer.summarize(input);
  }

  if (!draft.summary) {
    return { status: 'error', message: '本文から要約できる文が見つかりませんでした。' };
  }

  return {
    status: 'ok',
    summary: {
      method: engine.method,
      provider: engine.id,
      headlineJa: draft.headlineJa || item.title,
      summary: draft.summary,
      keyPoints: draft.keyPoints,
      insufficient: draft.insufficient,
      basis: input.basis,
      model: draft.model ?? engine.id,
      createdAt: new Date().toISOString()
    }
  };
}

/** 保存済みの要約を返し、なければ作成して保存する */
export async function summarize(item: NewsItem): Promise<SummaryResult> {
  const saved = (await loadStore()).get(item.id);
  if (saved && saved.provider === provider.id) return { status: 'ok', summary: saved };
  if (item.isSample) return { status: 'error', message: 'サンプル記事は要約できません。' };

  const pending = inFlight.get(item.id);
  if (pending) return pending;

  const task = generate(item)
    .then(async (result) => {
      // 代替の抽出型で作った要約は保存しない（LLM が復旧したら作り直すため）
      if (result.status === 'ok' && result.summary.provider === provider.id) {
        (await loadStore()).set(item.id, result.summary);
        scheduleSave();
      }
      return result;
    })
    .catch((error: unknown): SummaryResult => {
      console.error('[summary]', error);
      return { status: 'error', message: '要約の作成に失敗しました。' };
    })
    .finally(() => inFlight.delete(item.id));

  inFlight.set(item.id, task);
  return task;
}

let autoRunning = false;

/** 最新記事のうち未要約のものを裏で要約する（抽出型は自動、LLM は AUTO_SUMMARY_LIMIT 件まで） */
export async function summarizeLatestInBackground(items: NewsItem[]): Promise<void> {
  const limit = provider.cheap ? CHEAP_AUTO_LIMIT : LLM_AUTO_LIMIT;
  if (!limit || autoRunning) return;
  autoRunning = true;

  try {
    const saved = await getStoredSummaries();
    const queue = items.filter(item => !item.isSample && !saved.has(item.id)).slice(0, limit);
    if (!queue.length) return;

    const workers = Array.from({ length: AUTO_SUMMARY_CONCURRENCY }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await summarize(item);
      }
    });
    await Promise.all(workers);
  } finally {
    autoRunning = false;
  }
}
