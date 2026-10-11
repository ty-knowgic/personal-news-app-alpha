const tabsEl = document.getElementById('tabs');
const subgroupFilter = document.getElementById('subgroupFilter');
const keywordInput = document.getElementById('keywordInput');
const searchToggle = document.getElementById('searchToggle');
const searchBar = document.getElementById('searchBar');
const listView = document.getElementById('listView');
const newsList = document.getElementById('newsList');
const moreButton = document.getElementById('moreButton');
const status = document.getElementById('status');
const detailView = document.getElementById('detailView');
const backButton = document.getElementById('backButton');

const ALL_TAB = '';
const PAGE_SIZE = 40;
const STORAGE_KEY = 'personal-news:list-state';

const state = {
  tab: ALL_TAB,
  // タブごとに地域の選択を覚えておく
  subgroupByTab: {},
  keyword: '',
  items: [],
  total: 0
};

// 一覧で取得済みの記事。詳細画面を開いたときに即座に表示するために使う
const itemsById = new Map();
let requestSeq = 0;
let listScrollY = 0;
let openedFromList = false;

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// ---------- 共通 ----------

// フィード由来の文字列は信頼できないため、HTML に埋め込む前に必ずエスケープする
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[ch]);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString('ja-JP')} ${date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatRelative(value) {
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return '';
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'たった今';
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}日前`;
  return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
}

function saveListState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tab: state.tab, subgroupByTab: state.subgroupByTab }));
  } catch {
    // プライベートブラウズなどで保存できなくても動作は続ける
  }
}

function restoreListState() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (saved) {
      state.tab = saved.tab ?? ALL_TAB;
      state.subgroupByTab = saved.subgroupByTab ?? {};
    }
  } catch {
    // 保存データが読めない場合は初期状態で始める
  }
}

// ---------- タブ ----------

function renderTabs(categories) {
  const tabs = [{ value: ALL_TAB, label: 'トップ' }, ...categories.map(c => ({ value: c, label: c }))];
  if (!tabs.some(tab => tab.value === state.tab)) state.tab = ALL_TAB;

  tabsEl.innerHTML = tabs.map(tab => `
    <button class="tab" type="button" role="tab" data-tab="${escapeHtml(tab.value)}"
      aria-selected="${tab.value === state.tab}">${escapeHtml(tab.label)}</button>
  `).join('');
}

function selectTab(value) {
  if (value === state.tab) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  state.tab = value;
  tabsEl.querySelectorAll('.tab').forEach(tab => {
    const selected = tab.dataset.tab === value;
    tab.setAttribute('aria-selected', String(selected));
    if (selected) tab.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  });
  subgroupFilter.value = state.subgroupByTab[state.tab] ?? '';
  saveListState();
  window.scrollTo(0, 0);
  refreshNews();
}

tabsEl.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) selectTab(tab.dataset.tab);
});

// ---------- 一覧 ----------

function regionLabel(item) {
  const category = state.tab || item.category;
  return `${category}・${item.subgroup}`;
}

function renderItem(item, isLead) {
  const image = safeUrl(item.imageUrl);
  return `
    <a class="news-item${isLead && image ? ' is-lead' : ''}" href="#/article/${encodeURIComponent(item.id)}" data-id="${escapeHtml(item.id)}">
      <div class="news-text">
        <span class="news-label${item.isSample ? ' is-sample' : ''}">${item.isSample ? 'サンプル' : escapeHtml(regionLabel(item))}</span>
        <h2 class="news-title">${escapeHtml(item.title)}</h2>
        ${isLead && item.summary ? `<p class="news-summary">${escapeHtml(item.summary)}</p>` : ''}
        <div class="news-meta">
          <span>${escapeHtml(item.sourceName)}</span>
          <time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(formatRelative(item.publishedAt))}</time>
        </div>
      </div>
      ${image ? `<img class="news-thumb" src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}
    </a>
  `;
}

function renderNews() {
  if (!state.items.length) {
    const scope = [state.tab || 'すべてのカテゴリ', state.subgroupByTab[state.tab]].filter(Boolean).join('・');
    newsList.innerHTML = `<div class="empty-state">${escapeHtml(scope)}に一致するニュースはまだありません。</div>`;
    moreButton.hidden = true;
    return;
  }

  newsList.innerHTML = state.items.map((item, index) => renderItem(item, index === 0)).join('');
  moreButton.hidden = state.items.length >= state.total;
}

function renderSkeleton() {
  newsList.innerHTML = Array.from({ length: 6 }, () => `
    <div class="skeleton-item" aria-hidden="true">
      <div class="skeleton-line" style="width: 20%"></div>
      <div class="skeleton-line" style="width: 92%"></div>
      <div class="skeleton-line" style="width: 70%"></div>
    </div>
  `).join('');
  moreButton.hidden = true;
}

async function fetchNewsPage(offset) {
  const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
  const subgroup = state.subgroupByTab[state.tab];
  if (state.tab) params.set('category', state.tab);
  if (subgroup) params.set('subgroup', subgroup);
  if (state.keyword) params.set('keyword', state.keyword);

  const response = await fetch(`/api/news?${params.toString()}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const items = await response.json();
  items.forEach(item => itemsById.set(item.id, item));
  return { items, total: Number(response.headers.get('X-Total-Count') ?? items.length) };
}

function updateStatus() {
  const sampleOnly = state.items.length > 0 && state.items.every(item => item.isSample);
  status.textContent = sampleOnly
    ? '公式フィードを取得できなかったため、サンプルを表示しています'
    : `${state.total}件${state.keyword ? `（「${state.keyword}」で検索）` : ''}`;
}

async function refreshNews() {
  // 古いリクエストの応答が後から届いても、最新の結果を上書きしないようにする
  const seq = ++requestSeq;
  status.textContent = '更新中...';
  if (!state.items.length) renderSkeleton();

  try {
    const page = await fetchNewsPage(0);
    if (seq !== requestSeq) return;
    state.items = page.items;
    state.total = page.total;
    renderNews();
    updateStatus();
  } catch (error) {
    if (seq !== requestSeq) return;
    state.items = [];
    newsList.innerHTML = '<div class="empty-state">ニュースの取得に失敗しました。通信状況を確認して再読み込みしてください。</div>';
    status.textContent = `取得失敗（${error.message}）`;
  }
}

async function loadMore() {
  const seq = requestSeq;
  moreButton.disabled = true;
  moreButton.textContent = '読み込み中...';
  try {
    const page = await fetchNewsPage(state.items.length);
    if (seq !== requestSeq) return;
    state.items = [...state.items, ...page.items];
    state.total = page.total;
    newsList.insertAdjacentHTML('beforeend', page.items.map(item => renderItem(item, false)).join(''));
    moreButton.hidden = state.items.length >= state.total;
  } catch {
    // 失敗時はボタンを戻して再試行できるようにする
  } finally {
    moreButton.disabled = false;
    moreButton.textContent = 'もっと見る';
  }
}

moreButton.addEventListener('click', loadMore);

subgroupFilter.addEventListener('change', (event) => {
  state.subgroupByTab[state.tab] = event.target.value;
  saveListState();
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

searchToggle.addEventListener('click', () => {
  const open = searchBar.hidden;
  searchBar.hidden = !open;
  searchToggle.setAttribute('aria-expanded', String(open));
  if (open) {
    keywordInput.focus();
  } else if (state.keyword) {
    keywordInput.value = '';
    state.keyword = '';
    refreshNews();
  }
});

newsList.addEventListener('click', (event) => {
  if (event.target.closest('.news-item')) {
    listScrollY = window.scrollY;
    openedFromList = true;
  }
});

// ---------- 詳細 ----------

// サイト共通の OGP 画像（ロゴなど）は記事の内容を表さないため表示しない
function isGenericImage(url) {
  return /ogp|og_img|og-image|social-default|social-media-card|logo|default|title_j/i.test(url);
}

function renderDetail(item, content) {
  const labels = [
    ...item.categories.map(category => `<span class="pill">${escapeHtml(category)}</span>`),
    `<span class="pill">${escapeHtml(item.subgroup)}</span>`,
    item.isSample ? '<span class="pill is-sample">サンプル（取得失敗時の表示）</span>' : ''
  ].join('');

  const contentImage = content?.imageUrl && !isGenericImage(content.imageUrl) ? safeUrl(content.imageUrl) : '';
  const image = contentImage || safeUrl(item.imageUrl);
  const sourceUrl = safeUrl(item.sourceUrl);

  let body;
  if (!content) {
    body = `
      ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ''}
      <div aria-hidden="true">
        <div class="skeleton-line" style="width: 100%"></div>
        <div class="skeleton-line" style="width: 94%"></div>
        <div class="skeleton-line" style="width: 60%"></div>
      </div>
      <p class="visually-hidden">概要を読み込み中...</p>
    `;
  } else if (content.paragraphs.length) {
    body = content.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('');
    if (content.truncated) body += '<p class="detail-continue">（続きは元記事でご覧ください）</p>';
  } else {
    const fallback = content.description || item.summary;
    const notice = content.status === 'pdf'
      ? '発表資料はPDFで公開されています。内容は元資料でご確認ください。'
      : '発信元ページから概要を取得できませんでした。内容は元記事でご確認ください。';
    body = `${fallback ? `<p>${escapeHtml(fallback)}</p>` : ''}<p class="detail-continue">${notice}</p>`;
  }

  detailView.innerHTML = `
    <div class="detail-labels">${labels}</div>
    <h1 class="detail-title">${escapeHtml(item.title)}</h1>
    <div class="detail-meta">
      <strong>${escapeHtml(item.sourceName)}</strong>
      <time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(formatDate(item.publishedAt))}</time>
    </div>
    ${image ? `<figure class="detail-image"><img src="${escapeHtml(image)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></figure>` : ''}
    <section class="detail-body" aria-label="概要">${body}</section>
    ${sourceUrl ? `<a class="primary-button" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">元記事を読む（${escapeHtml(item.sourceName)}）</a>` : ''}
    <p class="detail-note">この概要は発信元の公式ページから冒頭部分をそのまま抽出したものです。要約や独自の解釈は加えていません。</p>
    <div class="hashtags">
      ${item.hashtags.map(tag => `<button class="hashtag" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}
    </div>
  `;
}

async function showDetail(id) {
  document.body.classList.add('is-detail');
  listView.hidden = true;
  detailView.hidden = false;
  backButton.hidden = false;
  window.scrollTo(0, 0);

  const known = itemsById.get(id);
  if (known) {
    renderDetail(known, null);
    document.title = `${known.title} | Personal News`;
  } else {
    detailView.innerHTML = '<div class="empty-state">読み込み中...</div>';
  }

  try {
    const response = await fetch(`/api/news/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(response.status === 404 ? 'not-found' : `HTTP ${response.status}`);
    const { item, content } = await response.json();
    // 読み込み中に別の画面へ移動していたら描画しない
    if (location.hash !== `#/article/${encodeURIComponent(id)}`) return;
    itemsById.set(item.id, item);
    renderDetail(item, content);
    document.title = `${item.title} | Personal News`;
  } catch (error) {
    if (location.hash !== `#/article/${encodeURIComponent(id)}`) return;
    if (known) {
      renderDetail(known, { status: 'unavailable', paragraphs: [], truncated: false });
    } else {
      detailView.innerHTML = error.message === 'not-found'
        ? '<div class="empty-state">この記事は掲載期間が終了したか、見つかりませんでした。</div>'
        : '<div class="empty-state">記事を読み込めませんでした。通信状況を確認してください。</div>';
    }
  }
}

function showList() {
  document.body.classList.remove('is-detail');
  detailView.hidden = true;
  detailView.innerHTML = '';
  listView.hidden = false;
  backButton.hidden = true;
  document.title = 'Personal News';
  window.scrollTo(0, listScrollY);
}

backButton.addEventListener('click', () => {
  // 一覧から開いた場合はブラウザの履歴を戻り、スクロール位置も含めて元の状態に戻す
  if (openedFromList) {
    history.back();
  } else {
    location.hash = '#/';
  }
});

detailView.addEventListener('click', (event) => {
  const tag = event.target.closest('.hashtag');
  if (!tag) return;
  searchBar.hidden = false;
  searchToggle.setAttribute('aria-expanded', 'true');
  keywordInput.value = tag.dataset.tag;
  state.keyword = tag.dataset.tag;
  listScrollY = 0;
  location.hash = '#/';
  refreshNews();
});

// ---------- ルーティング ----------

function route() {
  const match = location.hash.match(/^#\/article\/([^/?#]+)/);
  if (match) {
    showDetail(decodeURIComponent(match[1]));
  } else {
    showList();
    openedFromList = false;
  }
}

window.addEventListener('hashchange', route);

(async () => {
  restoreListState();
  try {
    const response = await fetch('/api/categories');
    const groups = await response.json();
    renderTabs(groups.map(group => group.category));
  } catch {
    renderTabs([]);
  }
  subgroupFilter.value = state.subgroupByTab[state.tab] ?? '';
  route();
  await refreshNews();
})();
