export type CategoryKey = '経済' | '社会' | '国際' | '政治';
export type SubgroupKey = '日本' | '海外';

export interface FeedSource {
  category: CategoryKey;
  subgroup: SubgroupKey;
  sourceName: string;
  sourceUrl: string;
  feedUrl: string;
  label: string;
}

export interface NewsItem {
  id: string;
  category: CategoryKey;
  subgroup: SubgroupKey;
  title: string;
  summary: string;
  publishedAt: string;
  sourceName: string;
  sourceUrl: string;
  feedUrl: string;
  hashtags: string[];
  keywords: string[];
  isSample?: boolean;
}

export interface NewsFilters {
  category?: string;
  subgroup?: string;
  keyword?: string;
}
