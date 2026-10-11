const categoryFilter = document.getElementById('categoryFilter');
const subgroupFilter = document.getElementById('subgroupFilter');
const keywordInput = document.getElementById('keywordInput');
const newsList = document.getElementById('newsList');
const status = document.getElementById('status');

const state = { category: '', subgroup: '', keyword: '' };

function renderCategories(groups) {
  const options = ['<option value="">全カテゴリ</option>'];
  for (const group of groups) {
    options.push(`<option value="${group.category}">${group.category}</option>`);
  }
  categoryFilter.innerHTML = options.join('');
}

async function loadCategories() {
  const response = await fetch('/api/categories');
  const data = await response.json();
  renderCategories(data);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toLocaleDateString('ja-JP')} ${date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
}

function renderNews(items) {
  if (!items.length) {
    newsList.innerHTML = '<div class="empty-state">条件に一致するニュースがありません。</div>';
    return;
  }

  newsList.innerHTML = items.map((item) => `
    <article class="news-card">
      <div class="meta-row">
        <span class="pill">${item.category}</span>
        <span class="pill">${item.subgroup}</span>
      </div>
      <h3>${item.title}</h3>
      <p class="summary">${item.summary}</p>
      <div class="meta-line">
        <span>${item.sourceName}</span>
        <span>${formatDate(item.publishedAt)}</span>
      </div>
      <div class="hashtags">
        ${item.hashtags.map(tag => `<span class="hashtag">${tag}</span>`).join('')}
      </div>
      <a class="link" href="${item.sourceUrl}" target="_blank" rel="noreferrer">一次情報元を見る</a>
    </article>
  `).join('');
}

async function refreshNews() {
  const params = new URLSearchParams();
  if (state.category) params.set('category', state.category);
  if (state.subgroup) params.set('subgroup', state.subgroup);
  if (state.keyword) params.set('keyword', state.keyword);

  status.textContent = 'ニュースを更新中...';
  const response = await fetch(`/api/news?${params.toString()}`);
  const items = await response.json();
  renderNews(items);
  status.textContent = `表示件数: ${items.length}件`;
}

categoryFilter.addEventListener('change', (event) => {
  state.category = event.target.value;
  refreshNews();
});

subgroupFilter.addEventListener('change', (event) => {
  state.subgroup = event.target.value;
  refreshNews();
});

keywordInput.addEventListener('input', (event) => {
  state.keyword = event.target.value.trim();
  refreshNews();
});

(async () => {
  await loadCategories();
  await refreshNews();
})();
