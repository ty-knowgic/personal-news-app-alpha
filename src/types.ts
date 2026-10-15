export const CATEGORIES = ['政治', '経済', '投資', '安全保障', '国際', '社会', 'テクノロジー', '生成AI', 'サイエンス', '文化・芸術', 'イベント'] as const;
/** 地域（発信元の所在地）。グローバルは国際機関や、複数国の発表を配信する通信社など */
export const SUBGROUPS = ['日本', 'カナダ', '米国', '欧州', 'グローバル'] as const;

export type CategoryKey = (typeof CATEGORIES)[number];
export type SubgroupKey = (typeof SUBGROUPS)[number];

/**
 * 公的機関 / 企業 / 研究機関 / 団体・NPO。一次情報（発信者自身の発表）だけを集めるため、報道機関は扱わない
 * （PR TIMES などのプレスリリース配信は、企業の発表をそのまま載せるため「企業」とする）
 */
export const SOURCE_TYPES = ['official', 'corporate', 'research', 'npo'] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export interface FeedSource {
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
  /** 記事の URL からカテゴリを決める規則（カナダ政府の全省庁フィードのように、記事ごとに担当省庁が異なる場合） */
  categoryByUrl?: [RegExp, CategoryKey][];
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
  /** マイニュース（関心プロフィールに一致する記事を関連度順に並べる） */
  forYou?: boolean;
  category?: string;
  subgroup?: string;
  sourceType?: string;
  keyword?: string;
  /** 利用者が選んだ地域・分野（空なら限定しない） */
  regions?: string[];
  categories?: string[];
  /** 利用者がオフにした情報源の ID */
  excludedSources?: Set<string>;
  /** 利用者が非表示にした記事の ID */
  hiddenItems?: Set<string>;
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
