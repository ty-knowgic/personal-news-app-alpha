import { CATEGORIES, SOURCE_TYPES, SUBGROUPS } from './types.js';
import type { CategoryKey, NewsFilters, NewsItem } from './types.js';

/** 記事の絞り込みと表示用の整形（サーバーでもブラウザでも使う） */

export function listCategoryGroups() {
  return CATEGORIES.map(category => ({ category, subgroups: [...SUBGROUPS] }));
}

export function listFilterOptions() {
  return { categories: [...CATEGORIES], regions: [...SUBGROUPS], sourceTypes: [...SOURCE_TYPES] };
}

/** sourceIdOf: フィードの URL から情報源の ID を求める関数（情報源をオフにした記事を除くのに使う） */
export function filterNews(allItems: NewsItem[], filters: NewsFilters, sourceIdOf: (feedUrl: string) => string): NewsItem[] {
  return allItems.filter((item) => {
    const byCategory = filters.category ? item.categories.includes(filters.category as CategoryKey) : true;
    const bySubgroup = filters.subgroup ? item.subgroup === filters.subgroup : true;
    const bySourceType = filters.sourceType ? item.sourceType === filters.sourceType : true;
    if (filters.hiddenItems?.size && filters.hiddenItems.has(item.id)) return false;
    if (filters.excludedSources?.size && filters.excludedSources.has(sourceIdOf(item.feedUrl))) return false;
    if (filters.regions?.length && !filters.regions.includes(item.subgroup)) return false;
    if (filters.categories?.length && !item.categories.some(category => filters.categories!.includes(category))) return false;
    const keyword = filters.keyword?.trim().toLowerCase();
    const byKeyword = keyword
      ? [item.title, item.summary, item.sourceName, ...item.keywords, ...item.hashtags].some(value =>
          value.toLowerCase().includes(keyword)
        )
      : true;

    return byCategory && bySubgroup && bySourceType && byKeyword;
  });
}

/** 主カテゴリが利用者の選んだ分野にない記事は、選んだ分野のうち最初に該当するものを主カテゴリとして表示する */
export function withPrimaryCategory<T extends NewsItem>(item: T, categories: string[]): T {
  if (!categories.length || categories.includes(item.category)) return item;
  const primary = item.categories.find(category => categories.includes(category));
  return primary ? { ...item, category: primary } : item;
}
