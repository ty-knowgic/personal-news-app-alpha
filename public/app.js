const categoryFilter = document.getElementById('categoryFilter');
const subgroupFilter = document.getElementById('subgroupFilter');
const keywordInput = document.getElementById('keywordInput');
const newsList = document.getElementById('newsList');
const status = document.getElementById('status');

const state = { category: '', subgroup: '', keyword: '' };
let requestSeq = 0;

// フィード由来の文字列は信頼できないため、HTML に埋め込む前に必ずエスケープする
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch {
    return '#';
  }
}

function renderCategories(groups) {
  const options = ['<option value="">全カテゴリ</option>'];
  for (const group of groups) {
    const name = escapeHtml(group.category);
    options.push(`<option value="${name}">${name}</option>`);
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
        <span class="pill">${escapeHtml(item.category)}</span>
        <span class="pill">${escapeHtml(item.subgroup)}</span>
        ${item.isSample ? '<span class="pill pill-sample">サンプル（取得失敗時の表示）</span>' : ''}
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      ${item.summary ? `<p class="summary">${escapeHtml(item.summary)}</p>` : ''}
      <div class="meta-line">
        <span>${escapeHtml(item.sourceName)}</span>
        <span>${escapeHtml(formatDate(item.publishedAt))}</span>
      </div>
      <div class="hashtags">
        ${item.hashtags.map(tag => `<span class="hashtag">${escapeHtml(tag)}</span>`).join('')}
      </div>
      <a class="link" href="${escapeHtml(safeUrl(item.sourceUrl))}" target="_blank" rel="noopener noreferrer">一次情報元を見る</a>
    </article>
  `).join('');
}

async function refreshNews() {
  const params = new URLSearchParams();
  if (state.category) params.set('category', state.category);
  if (state.subgroup) params.set('subgroup', state.subgroup);
  if (state.keyword) params.set('keyword', state.keyword);

  // 古いリクエストの応答が後から届いても、最新の結果を上書きしないようにする
  const seq = ++requestSeq;
  status.textContent = 'ニュースを更新中...';
  try {
    const response = await fetch(`/api/news?${params.toString()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const items = await response.json();
    if (seq !== requestSeq) return;
    renderNews(items);
    const sampleOnly = items.length > 0 && items.every(item => item.isSample);
    status.textContent = sampleOnly
      ? '公式フィードを取得できなかったため、サンプル記事を表示しています。'
      : `表示件数: ${items.length}件`;
  } catch (error) {
    if (seq !== requestSeq) return;
    status.textContent = `ニュースの取得に失敗しました（${error.message}）。`;
  }
}

categoryFilter.addEventListener('change', (event) => {
  state.category = event.target.value;
  refreshNews();
});

subgroupFilter.addEventListener('change', (event) => {
  state.subgroup = event.target.value;
  refreshNews();
});

let keywordTimer;
keywordInput.addEventListener('input', (event) => {
  clearTimeout(keywordTimer);
  keywordTimer = setTimeout(() => {
    state.keyword = event.target.value.trim();
    refreshNews();
  }, 250);
});

(async () => {
  try {
    await loadCategories();
  } catch {
    // カテゴリが取れなくても一覧の表示は続ける
  }
  await refreshNews();
})();
