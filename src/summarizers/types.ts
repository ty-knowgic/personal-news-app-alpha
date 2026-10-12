import type { ArticleSummary, NewsItem } from '../types.js';

export interface SummaryInput {
  item: NewsItem;
  /** 要約対象の本文（HTML から抽出した本文、または PDF から取り出したテキスト） */
  text: string;
  /** 本文の出どころ */
  basis: ArticleSummary['basis'];
  /** 発表資料が PDF の場合の本体（PDF を直接読めるエンジン向け） */
  pdfBase64?: string;
}

export type SummaryDraft = Pick<ArticleSummary, 'headlineJa' | 'summary' | 'keyPoints' | 'insufficient'> & {
  /** 実際に使われたモデル名（LLM の場合） */
  model?: string;
};

export interface Summarizer {
  /** 保存済みの要約がどのエンジンで作られたかを判別するための ID（例: extractive, local:qwen3-4b） */
  id: string;
  method: ArticleSummary['method'];
  /** 1件あたりの費用・時間がほぼかからず、新着記事をまとめて事前に要約してよいか */
  cheap: boolean;
  summarize(input: SummaryInput): Promise<SummaryDraft>;
}
