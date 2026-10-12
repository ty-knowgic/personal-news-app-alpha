export const CATEGORIES = ['政治', '経済', '投資', '社会', '国際', 'テクノロジー', '生成AI'] as const;
export const SUBGROUPS = ['日本', '海外'] as const;

export type CategoryKey = (typeof CATEGORIES)[number];
export type SubgroupKey = (typeof SUBGROUPS)[number];

export type SourceType = 'official' | 'corporate';

export interface FeedSource {
  /** 公的機関（official）か、企業の発表（corporate）か */
  sourceType: SourceType;
  /** フィードの既定カテゴリ。省略した場合はキーワード規則に一致した記事だけを取り込む */
  category?: CategoryKey;
  /** category を省略したフィードで、取り込み対象とするカテゴリ */
  matchOnly?: CategoryKey[];
  subgroup: SubgroupKey;
  sourceName: string;
  sourceUrl: string;
  feedUrl: string;
  label: string;
  /** 1回の取得で取り込む最大件数（発表量が多い公的機関の比重を抑えるため） */
  maxItems?: number;
  /** 入札結果・採用募集など定型的なお知らせを除外する */
  excludeRoutine?: boolean;
  /** フィードが言語情報を持つ場合、取り込む言語（例: ['en', 'ja']） */
  languages?: string[];
}

export interface NewsItem {
  id: string;
  /** 主カテゴリ（categories の先頭） */
  category: CategoryKey;
  categories: CategoryKey[];
  subgroup: SubgroupKey;
  sourceType: SourceType;
  title: string;
  summary: string;
  publishedAt: string;
  sourceName: string;
  sourceUrl: string;
  feedUrl: string;
  imageUrl?: string;
  /** 記事ページの画像を確認済みか（確認は1記事1回のみ） */
  imageChecked?: boolean;
  hashtags: string[];
  keywords: string[];
  isSample?: boolean;
}

export interface NewsFilters {
  category?: string;
  subgroup?: string;
  sourceType?: string;
  keyword?: string;
}

export interface ArticleContent {
  status: 'ok' | 'pdf' | 'unavailable';
  paragraphs: string[];
  truncated: boolean;
  description?: string;
  imageUrl?: string;
  siteName?: string;
  reason?: string;
}

export interface ArticleSummary {
  /** 抽出型（本文の文をそのまま抜き出す） / LLM（生成モデルが要約を書く） */
  method: 'extractive' | 'llm';
  /** 要約エンジンの ID（例: extractive, local:qwen3-4b, claude） */
  provider: string;
  /** 日本語の見出し（LLM の場合、原題が外国語なら訳。抽出型では原題のまま） */
  headlineJa: string;
  summary: string;
  keyPoints: string[];
  /** 本文から見出し以上の内容を読み取れなかった場合 true */
  insufficient: boolean;
  /** 要約の根拠: 記事本文 / PDF 資料 / RSS の説明文のみ */
  basis: 'article' | 'pdf' | 'feed';
  model: string;
  createdAt: string;
}
