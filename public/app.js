const tabsEl = document.getElementById('tabs');
const subgroupFilter = document.getElementById('subgroupFilter');
const sourceTypeFilter = document.getElementById('sourceTypeFilter');
const keywordInput = document.getElementById('keywordInput');
const searchToggle = document.getElementById('searchToggle');
const searchBar = document.getElementById('searchBar');
const listView = document.getElementById('listView');
const newsList = document.getElementById('newsList');
const listEnd = document.getElementById('listEnd');
const moreButton = document.getElementById('moreButton');
const status = document.getElementById('status');
const detailView = document.getElementById('detailView');
const backButton = document.getElementById('backButton');
const shareButton = document.getElementById('shareButton');
const todayEl = document.getElementById('today');

const ALL_TAB = '';
const PAGE_SIZE = 30;
const STORAGE_KEY = 'personal-news:list-state';

const state = {
  tab: ALL_TAB,
  // タブごとに地域の選択を覚えておく
  subgroupByTab: {},
  // 発信元の種別（企業 / 公的機関）もタブごとに覚えておく
  sourceTypeByTab: {},
  keyword: '',
  items: [],
  total: 0,
  loadingMore: false,
  summaryEnabled: false
};

// 一覧で取得済みの記事。詳細画面を開いたときに即座に表示するために使う
const itemsById = new Map();
let requestSeq = 0;
let listScrollY = 0;
let openedFromList = false;
let currentDetail = null;

if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

const ICONS = {
  sparkle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l1.8 4.9L19 9.7l-5.2 1.8L12 16.5l-1.8-5L5 9.7l5.2-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>',
  external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'
};

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

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
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
  return date.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function dayKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const md = date.toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });
  if (dayKey(date) === dayKey(today)) return { main: '今日', sub: md };
  if (dayKey(date) === dayKey(yesterday)) return { main: '昨日', sub: md };
  return { main: md, sub: '' };
}

// 発信元名から、サムネイル代わりのタイルに表示する頭文字を作る
function sourceInitials(name) {
  const text = String(name ?? '').trim();
  if (/^[\x00-\x7F]+$/.test(text)) {
    const words = text.split(/\s+/).filter(Boolean);
    return (words.length > 1 ? words.slice(0, 2).map(w => w[0]).join('') : text.slice(0, 2)).toUpperCase();
  }
  return text.slice(0, 1);
}

function displayTitle(item) {
  return item.ai?.headlineJa || item.title;
}

function primaryCategory(item) {
  return state.tab && item.categories?.includes(state.tab) ? state.tab : item.category;
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

function saveListState() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ tab: state.tab, subgroupByTab: state.subgroupByTab, sourceTypeByTab: state.sourceTypeByTab }));
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
      state.sourceTypeByTab = saved.sourceTypeByTab ?? {};
    }
  } catch {
    // 保存データが読めない場合は初期状態で始める
  }
}

// ---------- タブ ----------

function renderTabs(categories) {
  const tabs = [{ value: ALL_TAB, label: 'トップ', cat: 'all' }, ...categories.map(c => ({ value: c, label: c, cat: c }))];
  if (!tabs.some(tab => tab.value === state.tab)) state.tab = ALL_TAB;

  tabsEl.innerHTML = tabs.map(tab => `
    <button class="tab" type="button" role="tab" data-tab="${escapeHtml(tab.value)}" data-cat="${escapeHtml(tab.cat)}"
      aria-selected="${tab.value === state.tab}">${escapeHtml(tab.label)}</button>
  `).join('');

  tabsEl.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'center' });
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
  syncFilterControls();
  saveListState();
  window.scrollTo(0, 0);
  refreshNews();
}

function syncFilterControls() {
  subgroupFilter.value = state.subgroupByTab[state.tab] ?? '';
  sourceTypeFilter.value = state.sourceTypeByTab[state.tab] ?? '';
}

tabsEl.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) selectTab(tab.dataset.tab);
});

// ---------- 一覧 ----------

function cardSummary(item) {
  if (item.ai?.summary) {
    return `<p class="card-summary"><span class="ai-mark">${ICONS.sparkle.replace('<svg', '<svg width="11" height="11"')}AI要約</span>${escapeHtml(item.ai.summary)}</p>`;
  }
  return item.summary ? `<p class="card-summary">${escapeHtml(item.summary)}</p>` : '';
}

function renderHero(item) {
  const category = primaryCategory(item);
  const summary = item.ai?.summary || item.summary;
  return `
    <a class="hero" href="#/article/${encodeURIComponent(item.id)}" data-id="${escapeHtml(item.id)}" data-cat="${escapeHtml(category)}">
      <img src="${escapeHtml(safeUrl(item.imageUrl))}" alt="" referrerpolicy="no-referrer" onerror="this.closest('.hero').classList.add('no-image');this.remove()">
      <div class="hero-body">
        <span class="cat-pill">${escapeHtml(category)}・${escapeHtml(item.subgroup)}</span>
        <h2 class="hero-title">${escapeHtml(displayTitle(item))}</h2>
        ${summary ? `<p class="hero-summary">${escapeHtml(summary)}</p>` : ''}
        <div class="hero-meta">${escapeHtml(item.sourceName)} · ${escapeHtml(formatRelative(item.publishedAt))}</div>
      </div>
    </a>
  `;
}

function renderCard(item) {
  const category = primaryCategory(item);
  const image = safeUrl(item.imageUrl);
  const media = image
    ? `<img class="thumb" src="${escapeHtml(image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.outerHTML='<div class=&quot;thumb-placeholder&quot; aria-hidden=&quot;true&quot;>${escapeHtml(escapeHtml(sourceInitials(item.sourceName)))}</div>'">`
    : `<div class="thumb-placeholder" aria-hidden="true">${escapeHtml(sourceInitials(item.sourceName))}</div>`;

  return `
    <a class="card" href="#/article/${encodeURIComponent(item.id)}" data-id="${escapeHtml(item.id)}" data-cat="${escapeHtml(category)}">
      <div class="card-body">
        <div class="card-meta">
          <span class="cat-label">${item.isSample ? 'サンプル' : `${escapeHtml(category)}・${escapeHtml(item.subgroup)}`}</span>
          <span class="sep" aria-hidden="true"></span>
          <span class="source">${escapeHtml(item.sourceName)}</span>
          ${item.sourceType === 'corporate' ? '<span class="source-badge">企業</span>' : ''}
        </div>
        <h3 class="card-title">${escapeHtml(displayTitle(item))}</h3>
        ${cardSummary(item)}
        <div class="card-foot"><time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(formatRelative(item.publishedAt))}</time></div>
      </div>
      ${media}
    </a>
  `;
}

// 日付の見出しを挟みながら記事を並べる。lastDay には直前に描画した日付を渡す
// 先頭付近（上位6件）で最初に画像がある記事を、トップのヒーローカードにする
function renderItems(items, lastDay, withHero) {
  let html = '';
  let currentDay = lastDay;
  const heroIndex = withHero ? items.slice(0, 6).findIndex(item => safeUrl(item.imageUrl)) : -1;
  if (heroIndex >= 0) html += renderHero(items[heroIndex]);

  items.forEach((item, index) => {
    if (index === heroIndex) return;
    const key = dayKey(item.publishedAt);
    if (key !== currentDay) {
      const label = dayLabel(item.publishedAt);
      html += `<h2 class="day-heading">${escapeHtml(label.main)}${label.sub ? `<small>${escapeHtml(label.sub)}</small>` : ''}</h2>`;
      currentDay = key;
    }
    html += renderCard(item);
  });
  return { html, lastDay: currentDay };
}

let lastRenderedDay = null;

function renderNews() {
  if (!state.items.length) {
    const sourceLabel = { corporate: '企業', official: '公的機関' }[state.sourceTypeByTab[state.tab]];
    const scope = [state.tab || 'すべてのカテゴリ', state.subgroupByTab[state.tab], sourceLabel].filter(Boolean).join('・');
    newsList.innerHTML = state.keyword
      ? `<div class="empty-state"><strong>「${escapeHtml(state.keyword)}」に一致する記事はありません</strong>別のキーワードをお試しください。</div>`
      : `<div class="empty-state"><strong>まだ記事がありません</strong>${escapeHtml(scope)}の新しい発表が出ると、ここに表示されます。</div>`;
    moreButton.hidden = true;
    return;
  }

  const rendered = renderItems(state.items, null, !state.keyword);
  lastRenderedDay = rendered.lastDay;
  newsList.innerHTML = rendered.html;
  moreButton.hidden = state.items.length >= state.total;
}

function renderSkeleton() {
  newsList.innerHTML = Array.from({ length: 6 }, () => `
    <div class="skeleton-card" aria-hidden="true">
      <div class="skeleton-lines">
        <div class="skeleton skeleton-line" style="width: 30%"></div>
        <div class="skeleton skeleton-line" style="width: 95%"></div>
        <div class="skeleton skeleton-line" style="width: 75%"></div>
        <div class="skeleton skeleton-line" style="width: 20%"></div>
      </div>
      <div class="skeleton" style="width: 92px; height: 92px; border-radius: 14px"></div>
    </div>
  `).join('');
  moreButton.hidden = true;
}

async function fetchNewsPage(offset) {
  const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
  const subgroup = state.subgroupByTab[state.tab];
  if (state.tab) params.set('category', state.tab);
  if (subgroup) params.set('subgroup', subgroup);
  const sourceType = state.sourceTypeByTab[state.tab];
  if (sourceType) params.set('sourceType', sourceType);
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
    : `${state.total.toLocaleString('ja-JP')}件${state.keyword ? `・「${state.keyword}」` : ''}`;
}

async function refreshNews() {
  // 古いリクエストの応答が後から届いても、最新の結果を上書きしないようにする
  const seq = ++requestSeq;
  status.textContent = '更新中…';
  renderSkeleton();

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
    newsList.innerHTML = '<div class="empty-state"><strong>ニュースを読み込めませんでした</strong>通信状況を確認して、ページを再読み込みしてください。</div>';
    status.textContent = '';
  }
}

async function loadMore() {
  if (state.loadingMore || state.items.length >= state.total) return;
  const seq = requestSeq;
  state.loadingMore = true;
  moreButton.textContent = '読み込み中…';
  try {
    const page = await fetchNewsPage(state.items.length);
    if (seq !== requestSeq) return;
    state.items = [...state.items, ...page.items];
    state.total = page.total;
    const rendered = renderItems(page.items, lastRenderedDay, false);
    lastRenderedDay = rendered.lastDay;
    newsList.insertAdjacentHTML('beforeend', rendered.html);
    moreButton.hidden = state.items.length >= state.total;
  } catch {
    // 失敗時はボタンから再試行できるようにする
  } finally {
    state.loadingMore = false;
    moreButton.textContent = 'さらに読み込む';
  }
}

moreButton.addEventListener('click', loadMore);

// 一覧の末尾が見えたら自動で続きを読み込む
if ('IntersectionObserver' in window) {
  new IntersectionObserver((entries) => {
    if (entries.some(entry => entry.isIntersecting) && !listView.hidden && state.items.length) loadMore();
  }, { rootMargin: '600px 0px' }).observe(listEnd);
}

subgroupFilter.addEventListener('change', (event) => {
  state.subgroupByTab[state.tab] = event.target.value;
  saveListState();
  refreshNews();
});

sourceTypeFilter.addEventListener('change', (event) => {
  state.sourceTypeByTab[state.tab] = event.target.value;
  saveListState();
  refreshNews();
});

let keywordTimer;
keywordInput.addEventListener('input', (event) => {
  clearTimeout(keywordTimer);
  keywordTimer = setTimeout(() => {
    state.keyword = event.target.value.trim();
    refreshNews();
  }, 300);
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
  if (event.target.closest('.card, .hero')) {
    listScrollY = window.scrollY;
    openedFromList = true;
  }
});

// ---------- 詳細 ----------

// サイト共通の OGP 画像（ロゴなど）は記事の内容を表さないため表示しない
function isGenericImage(url) {
  return /ogp|og_img|og-image|social-default|social-media-card|logo|default|title_j/i.test(url);
}

function renderAiCard(detail) {
  const { summary, summaryState, summaryError } = detail;

  if (summary) {
    const basisNote = {
      article: '発信元ページの本文のみをもとに',
      pdf: '発信元が公開した PDF 資料のみをもとに',
      feed: '発信元の配信文のみをもとに（本文を取得できなかったため簡易的な要約です）'
    }[summary.basis] ?? '';
    return `
      <section class="ai-card" aria-label="AI要約">
        <div class="ai-card-head">${ICONS.sparkle}AI要約</div>
        <p class="ai-summary">${escapeHtml(summary.summary)}</p>
        ${summary.keyPoints?.length ? `<ul class="ai-points">${summary.keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` : ''}
        <p class="ai-note">${escapeHtml(basisNote)} Claude が作成した要約です。誤りを含む可能性があるため、重要な内容は元記事でご確認ください。</p>
      </section>
    `;
  }

  if (summaryState === 'loading') {
    return `
      <section class="ai-card is-loading" aria-label="AI要約" aria-busy="true">
        <div class="ai-card-head">${ICONS.sparkle}AI要約</div>
        <p class="ai-summary">記事を読み込んで要約しています…</p>
        <div class="ai-loading" aria-hidden="true">
          <div class="skeleton" style="width: 100%"></div>
          <div class="skeleton" style="width: 92%"></div>
          <div class="skeleton" style="width: 64%"></div>
        </div>
      </section>
    `;
  }

  if (summaryState === 'error') {
    return `
      <section class="ai-card is-info" aria-label="AI要約">
        <div class="ai-card-head">${ICONS.sparkle}AI要約</div>
        <p class="ai-summary">${escapeHtml(summaryError || '要約を作成できませんでした。')}</p>
        <button class="retry-button" type="button" data-action="retry-summary">もう一度試す</button>
      </section>
    `;
  }

  if (summaryState === 'disabled') {
    return `
      <section class="ai-card is-info" aria-label="AI要約">
        <div class="ai-card-head">${ICONS.sparkle}AI要約はオフです</div>
        <p class="ai-summary">サーバーの Mac で <code>ant auth login</code> を実行するか、.env に ANTHROPIC_API_KEY を設定すると、記事ごとの要約と要点が表示されます。下の「本文の冒頭」から内容を確認できます。</p>
      </section>
    `;
  }

  return '';
}

function renderExcerpt(detail) {
  const { item, content, summary } = detail;
  let body;
  if (!content) {
    body = '<div class="ai-loading" aria-hidden="true"><div class="skeleton" style="width: 100%"></div><div class="skeleton" style="width: 80%"></div></div>';
  } else if (content.paragraphs.length) {
    body = content.paragraphs.map(paragraph => `<p>${escapeHtml(paragraph)}</p>`).join('');
    if (content.truncated) body += '<p class="excerpt-more">続きは元記事でご覧ください。</p>';
  } else {
    const fallback = content.description || item.summary;
    const notice = content.status === 'pdf'
      ? '発表資料は PDF で公開されています。'
      : '発信元ページから本文を取得できませんでした。';
    body = `${fallback ? `<p>${escapeHtml(fallback)}</p>` : ''}<p class="excerpt-more">${notice}</p>`;
  }

  // AI 要約がある場合、抜粋は補助的な情報なので閉じておく
  const open = !summary && detail.summaryState !== 'loading';
  return `
    <details class="excerpt" ${open ? 'open' : ''}>
      <summary>本文の冒頭（発信元より）</summary>
      <div class="excerpt-body">${body}</div>
    </details>
  `;
}

function renderDetail() {
  const detail = currentDetail;
  if (!detail) return;
  const { item, content, summary } = detail;
  const category = item.category;

  const contentImage = content?.imageUrl && !isGenericImage(content.imageUrl) ? safeUrl(content.imageUrl) : '';
  const image = contentImage || safeUrl(item.imageUrl);
  const sourceUrl = safeUrl(item.sourceUrl);
  const headline = summary?.headlineJa || item.ai?.headlineJa || item.title;
  const showOriginal = headline !== item.title;

  // details の開閉状態は再描画しても保つ
  const excerptOpen = detailView.querySelector('.excerpt')?.open;

  detailView.dataset.cat = category;
  detailView.innerHTML = `
    <div class="detail-kicker">
      ${item.categories.map(c => `<span class="chip" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</span>`).join('')}
      <span class="chip is-neutral">${escapeHtml(item.subgroup)}</span>
      ${item.isSample ? '<span class="chip is-sample">サンプル（取得失敗時の表示）</span>' : ''}
    </div>
    <h1 class="detail-title">${escapeHtml(headline)}</h1>
    ${showOriginal ? `<p class="detail-original" lang="en">原題: ${escapeHtml(item.title)}</p>` : ''}
    <div class="byline" data-cat="${escapeHtml(category)}">
      <span class="byline-avatar" aria-hidden="true">${escapeHtml(sourceInitials(item.sourceName))}</span>
      <span class="byline-text">
        <strong>${escapeHtml(item.sourceName)}</strong>
        <time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(formatDateTime(item.publishedAt))}</time>
      </span>
    </div>
    ${image ? `<figure class="detail-image"><img src="${escapeHtml(image)}" alt="" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></figure>` : ''}
    ${renderAiCard(detail)}
    ${renderExcerpt(detail)}
    <div class="tags">
      ${item.hashtags.map(tag => `<button class="tag" type="button" data-tag="${escapeHtml(tag)}">${escapeHtml(tag)}</button>`).join('')}
    </div>
    ${sourceUrl ? `
      <div class="read-bar">
        <a class="read-button" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">
          元記事を読む（${escapeHtml(item.sourceName)}）${ICONS.external}
        </a>
      </div>` : ''}
  `;

  if (excerptOpen !== undefined) {
    const excerpt = detailView.querySelector('.excerpt');
    if (excerpt) excerpt.open = excerptOpen;
  }
}

function isCurrentDetail(id) {
  return currentDetail?.id === id && location.hash === `#/article/${encodeURIComponent(id)}`;
}

async function loadSummary(id) {
  currentDetail.summaryState = 'loading';
  renderDetail();
  try {
    const response = await fetch(`/api/news/${encodeURIComponent(id)}/summary`);
    const data = await response.json().catch(() => ({}));
    if (!isCurrentDetail(id)) return;
    if (response.ok) {
      currentDetail.summary = data.summary;
      currentDetail.summaryState = 'done';
      // 一覧に戻ったときにも要約が表示されるよう反映する
      const known = itemsById.get(id);
      if (known) known.ai = { headlineJa: data.summary.headlineJa, summary: data.summary.summary };
    } else {
      currentDetail.summaryState = response.status === 503 ? 'disabled' : 'error';
      currentDetail.summaryError = data.error;
    }
  } catch {
    if (!isCurrentDetail(id)) return;
    currentDetail.summaryState = 'error';
    currentDetail.summaryError = '通信エラーのため要約を取得できませんでした。';
  }
  renderDetail();
}

async function showDetail(id) {
  document.body.classList.add('is-detail');
  listView.hidden = true;
  detailView.hidden = false;
  backButton.hidden = false;
  shareButton.hidden = false;
  window.scrollTo(0, 0);

  const known = itemsById.get(id);
  currentDetail = { id, item: known, content: null, summary: null, summaryState: 'idle' };

  if (known) {
    renderDetail();
    document.title = `${displayTitle(known)} | Personal News`;
  } else {
    detailView.innerHTML = '<div class="empty-state">読み込み中…</div>';
  }

  try {
    const response = await fetch(`/api/news/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error(response.status === 404 ? 'not-found' : `HTTP ${response.status}`);
    const data = await response.json();
    if (!isCurrentDetail(id)) return;

    itemsById.set(data.item.id, { ...known, ...data.item });
    Object.assign(currentDetail, { item: data.item, content: data.content, summary: data.summary });
    document.title = `${data.summary?.headlineJa || data.item.title} | Personal News`;

    if (data.summary) {
      currentDetail.summaryState = 'done';
      renderDetail();
    } else if (data.summaryEnabled && !data.item.isSample) {
      loadSummary(id);
    } else {
      currentDetail.summaryState = data.item.isSample ? 'idle' : 'disabled';
      renderDetail();
    }
  } catch (error) {
    if (!isCurrentDetail(id)) return;
    if (known) {
      currentDetail.content = { status: 'unavailable', paragraphs: [], truncated: false };
      renderDetail();
    } else {
      detailView.innerHTML = error.message === 'not-found'
        ? '<div class="empty-state"><strong>記事が見つかりません</strong>掲載期間が終了した可能性があります。</div>'
        : '<div class="empty-state"><strong>記事を読み込めませんでした</strong>通信状況を確認してください。</div>';
    }
  }
}

function showList() {
  document.body.classList.remove('is-detail');
  currentDetail = null;
  detailView.hidden = true;
  detailView.innerHTML = '';
  listView.hidden = false;
  backButton.hidden = true;
  shareButton.hidden = true;
  document.title = 'Personal News';

  // 詳細で作成された AI 要約を一覧にも反映する
  if (state.items.length) {
    state.items = state.items.map(item => itemsById.get(item.id) ?? item);
    renderNews();
  }
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

shareButton.addEventListener('click', async () => {
  const item = currentDetail?.item;
  if (!item) return;
  const title = currentDetail.summary?.headlineJa || item.title;
  const url = safeUrl(item.sourceUrl) || location.href;
  try {
    if (navigator.share) {
      await navigator.share({ title, text: currentDetail.summary?.summary ?? title, url });
    } else {
      await navigator.clipboard.writeText(`${title}\n${url}`);
      showToast('リンクをコピーしました');
    }
  } catch {
    // 共有シートを閉じた場合などは何もしない
  }
});

detailView.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="retry-summary"]') && currentDetail) {
    loadSummary(currentDetail.id);
    return;
  }

  const tag = event.target.closest('.tag');
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
  todayEl.textContent = new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' });
  restoreListState();

  const [categories] = await Promise.all([
    fetch('/api/categories').then(r => r.json()).then(groups => groups.map(g => g.category)).catch(() => []),
    fetch('/api/config').then(r => r.json()).then(config => { state.summaryEnabled = Boolean(config.summaryEnabled); }).catch(() => {})
  ]);
  renderTabs(categories);
  syncFilterControls();
  route();
  await refreshNews();
})();
