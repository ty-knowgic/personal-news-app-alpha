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
const settingsView = document.getElementById('settingsView');
const settingsButton = document.getElementById('settingsButton');
const onboardingView = document.getElementById('onboardingView');

const ALL_TAB = '';
// 関心プロフィールに一致する記事を関連度順に並べるタブ
const FOR_YOU_TAB = '__for_you';
const SOURCE_TYPE_LABELS = { official: '政府・自治体', corporate: '企業', research: '研究機関', npo: '団体・NPO' };
const SOURCE_BADGES = { corporate: '企業', research: '研究', npo: '団体' };
// 初回の質問と設定で使う、地域・分野の説明
const REGION_INFO = {
  カナダ: '連邦政府・オンタリオ州・ウォータールー地域の自治体',
  日本: '官邸・各省庁・日本銀行・企業の発表',
  米国: '連邦政府・規制当局・企業',
  欧州: 'EU・英国',
  グローバル: '国際機関・多国籍企業'
};
const CATEGORY_INFO = {
  政治: '政府の方針・法案・選挙',
  経済: '金融政策・統計・企業の決算や M&A',
  投資: '政府の投資策・スタートアップの資金調達',
  安全保障: '防衛・サイバーセキュリティ',
  国際: '外交・国際機関',
  社会: '保健・福祉・教育・地域の暮らし',
  テクノロジー: 'ロボット・半導体・デジタル政策',
  生成AI: 'LLM・AI エージェント・AI 企業の発表',
  サイエンス: '数学・科学・工学（STEM）の研究成果',
  '文化・芸術': '芸術・文化財・文化政策',
  イベント: '催し・展示会・カンファレンス'
};
const PAGE_SIZE = 30;
const STORAGE_KEY = 'personal-news:list-state';

const state = {
  tab: FOR_YOU_TAB,
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
  quote: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h4v4H8a1 1 0 0 0-1 1v4"/><path d="M15 7h4v4h-3a1 1 0 0 0-1 1v4"/></svg>',
  stack: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l8 4-8 4-8-4z"/><path d="M4 12l8 4 8-4"/><path d="M4 16l8 4 8-4"/></svg>',
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

function isForYou() {
  return state.tab === FOR_YOU_TAB;
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
      state.tab = saved.tab ?? FOR_YOU_TAB;
      state.subgroupByTab = saved.subgroupByTab ?? {};
      state.sourceTypeByTab = saved.sourceTypeByTab ?? {};
    }
  } catch {
    // 保存データが読めない場合は初期状態で始める
  }
}

// ---------- タブ ----------

function renderTabs(categories) {
  const tabs = [
    { value: FOR_YOU_TAB, label: 'マイニュース', cat: 'foryou' },
    { value: ALL_TAB, label: 'すべて', cat: 'all' },
    ...categories.map(c => ({ value: c, label: c, cat: c }))
  ];
  if (!tabs.some(tab => tab.value === state.tab)) state.tab = FOR_YOU_TAB;

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

function renderFilterOptions(filters) {
  subgroupFilter.innerHTML = ['<option value="">すべての地域</option>',
    ...filters.regions.map(region => `<option value="${escapeHtml(region)}">${escapeHtml(region)}</option>`)].join('');
  sourceTypeFilter.innerHTML = ['<option value="">すべての発信元</option>',
    ...filters.sourceTypes.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(SOURCE_TYPE_LABELS[type] ?? type)}</option>`)].join('');
}

/** 選んだ分野・地域に合わせて、タブと地域の選択肢を作り直す */
async function reloadFilters() {
  const filters = await fetch('/api/filters').then(r => r.json());
  renderFilterOptions(filters);
  renderTabs(filters.categories);
  // 対象外になった地域が選ばれたままにならないようにする
  for (const [tab, region] of Object.entries(state.subgroupByTab)) {
    if (region && !filters.regions.includes(region)) delete state.subgroupByTab[tab];
  }
  syncFilterControls();
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
    // 抽出型（本文の文をそのまま抜粋）と、生成モデルによる要約を区別して表示する
    const mark = item.ai.method === 'llm'
      ? `<span class="ai-mark">${ICONS.sparkle.replace('<svg', '<svg width="11" height="11"')}AI要約</span>`
      : '<span class="ai-mark is-extract">要約</span>';
    return `<p class="card-summary">${mark}${escapeHtml(item.ai.summary)}</p>`;
  }
  return item.summary ? `<p class="card-summary">${escapeHtml(item.summary)}</p>` : '';
}

// どの関心トピックに一致したか（「なぜこの記事が表示されているか」）を示す
function matchChips(item) {
  if (!item.matches?.length) return '';
  return `<span class="match-chips" aria-label="関心: ${escapeHtml(item.matches.map(m => m.label).join('、'))}">${
    item.matches.slice(0, 3).map(match => (match.via === 'semantic'
      // キーワードは含まないが、内容が関心に近いと判定された記事
      ? `<span class="match-chip is-semantic" title="キーワードではなく内容の近さで一致">${escapeHtml(match.label)}</span>`
      : `<span class="match-chip">${escapeHtml(match.label)}</span>`)).join('')
  }</span>`;
}

// 同じ話題の発表・報道がまとめられている場合、「ほか◯件」と主な発信元を示す
function relatedLine(item) {
  const related = item.related ?? [];
  if (!related.length) return '';
  const others = [...new Set(related.map(r => r.sourceName).filter(name => name !== item.sourceName))];
  const sources = others.length ? `${others.slice(0, 2).join('・')}${others.length > 2 ? ' など' : ''}` : '同じ発信元の続報';
  return `<div class="related-line">${ICONS.stack}<span class="related-count">関連 ${related.length}件</span><span class="related-sources">${escapeHtml(sources)}</span></div>`;
}

// ---------- ブリーフィング（マイニュースの先頭） ----------

function showBriefing() {
  return isForYou() && !state.keyword && !state.subgroupByTab[state.tab] && !state.sourceTypeByTab[state.tab];
}

function renderBriefing(briefing) {
  if (!briefing?.stories?.length) return '';
  const period = briefing.windowHours <= 24 ? '過去24時間' : briefing.windowHours <= 72 ? `過去${briefing.windowHours}時間` : `過去${Math.round(briefing.windowHours / 24)}日間`;
  const title = briefing.windowHours <= 24 ? '今日のブリーフィング' : '最近のブリーフィング';
  return `
    <section class="briefing" aria-label="${title}">
      <div class="briefing-head">
        <span class="briefing-kicker">BRIEFING</span>
        <h2 class="briefing-title">${title}</h2>
        <p class="briefing-sub">${period}に、あなたの関心に一致した ${briefing.storyCount}件の話題から</p>
      </div>
      <ol class="briefing-list">
        ${briefing.stories.map((story, index) => `
          <li>
            <a class="briefing-item" href="#/article/${encodeURIComponent(story.id)}" data-id="${escapeHtml(story.id)}">
              <span class="briefing-num" aria-hidden="true">${index + 1}</span>
              <span class="briefing-body">
                <span class="briefing-item-title">${escapeHtml(story.title)}</span>
                ${story.line ? `<span class="briefing-line">${escapeHtml(story.line)}</span>` : ''}
                <span class="briefing-meta">${escapeHtml(story.sourceName)}${story.related?.length ? ` ほか${story.related.length}件` : ''} · ${escapeHtml(formatRelative(story.publishedAt))}${matchChips(story)}</span>
              </span>
            </a>
          </li>`).join('')}
      </ol>
      ${briefing.topics?.length ? `
        <div class="briefing-topics" aria-label="関心トピックごとの話題数">
          ${briefing.topics.map(topic => `<span class="briefing-topic">${escapeHtml(topic.label)} <b>${topic.count}</b></span>`).join('')}
        </div>` : ''}
    </section>
  `;
}

async function fetchBriefing() {
  try {
    const response = await fetch('/api/briefing');
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
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
        <div class="hero-meta">${escapeHtml(item.sourceName)} · ${escapeHtml(formatRelative(item.publishedAt))}${item.matches?.length ? ` · ${escapeHtml(item.matches.map(m => m.label).join('・'))}` : ''}</div>
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
          ${SOURCE_BADGES[item.sourceType] ? `<span class="source-badge">${SOURCE_BADGES[item.sourceType]}</span>` : ''}
        </div>
        <h3 class="card-title">${escapeHtml(displayTitle(item))}</h3>
        ${cardSummary(item)}
        <div class="card-foot">
          <time datetime="${escapeHtml(item.publishedAt)}">${escapeHtml(formatRelative(item.publishedAt))}</time>
          ${matchChips(item)}
        </div>
        ${relatedLine(item)}
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
    // マイニュースは関連度順のため、日付の見出しは付けない
    if (!isForYou() && key !== currentDay) {
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
    const sourceLabel = SOURCE_TYPE_LABELS[state.sourceTypeByTab[state.tab]];
    const tabLabel = isForYou() ? 'マイニュース' : state.tab || 'すべてのカテゴリ';
    const scope = [tabLabel, state.subgroupByTab[state.tab], sourceLabel].filter(Boolean).join('・');
    newsList.innerHTML = state.keyword
      ? `<div class="empty-state"><strong>「${escapeHtml(state.keyword)}」に一致する記事はありません</strong>別のキーワードをお試しください。</div>`
      : isForYou()
        ? `<div class="empty-state"><strong>関心に一致する記事がまだありません</strong><a href="#/settings">設定</a>で関心トピックやキーワードを追加できます。</div>`
        : `<div class="empty-state"><strong>まだ記事がありません</strong>${escapeHtml(scope)}の新しい発表が出ると、ここに表示されます。</div>`;
    moreButton.hidden = true;
    return;
  }

  const briefingHtml = showBriefing() ? renderBriefing(state.briefing) : '';
  const rendered = renderItems(state.items, null, !state.keyword && !briefingHtml);
  lastRenderedDay = rendered.lastDay;
  newsList.innerHTML = briefingHtml
    ? `${briefingHtml}<h2 class="day-heading">すべてのマイニュース</h2>${rendered.html}`
    : rendered.html;
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
  if (isForYou()) params.set('forYou', '1');
  else if (state.tab) params.set('category', state.tab);
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
    const [page, briefing] = await Promise.all([fetchNewsPage(0), showBriefing() ? fetchBriefing() : null]);
    if (seq !== requestSeq) return;
    state.briefing = briefing;
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
  if (event.target.closest('.card, .hero, .briefing-item')) {
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
    const source = {
      article: '発信元ページの本文',
      pdf: '発信元が公開した PDF 資料',
      feed: '発信元の配信文（本文を取得できなかったため）'
    }[summary.basis] ?? '発信元の本文';
    const isLlm = summary.method === 'llm';
    const title = isLlm ? 'AI要約' : '要約';
    const note = isLlm
      ? `${source}のみをもとに、AI（${summary.model}）が作成した要約です。誤りを含む可能性があるため、重要な内容は元記事でご確認ください。`
      : `${source}から重要な文をそのまま抜き出しています（AI による書き換えはしていません）。`;
    const body = summary.summary
      ? `<p class="ai-summary">${escapeHtml(summary.summary)}</p>
        ${summary.keyPoints?.length ? `<ul class="ai-points">${summary.keyPoints.map(point => `<li>${escapeHtml(point)}</li>`).join('')}</ul>` : ''}`
      : '<p class="ai-summary">発信元ページから、この記事の内容を読み取れませんでした。元記事でご確認ください。</p>';
    return `
      <section class="ai-card${isLlm ? '' : ' is-extract'}" aria-label="${title}">
        <div class="ai-card-head">${isLlm ? ICONS.sparkle : ICONS.quote}${title}</div>
        ${body}
        <p class="ai-note">${escapeHtml(note)}</p>
      </section>
    `;
  }

  if (summaryState === 'loading') {
    return `
      <section class="ai-card is-loading" aria-label="要約" aria-busy="true">
        <div class="ai-card-head">${ICONS.sparkle}要約</div>
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
      <section class="ai-card is-info" aria-label="要約">
        <div class="ai-card-head">${ICONS.sparkle}要約</div>
        <p class="ai-summary">${escapeHtml(summaryError || '要約を作成できませんでした。')}</p>
        <button class="retry-button" type="button" data-action="retry-summary">もう一度試す</button>
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

  // 要約がある場合（または作成中）は、抜粋は補助的な情報なので閉じておく
  const open = !summary && !['loading', 'idle'].includes(detail.summaryState);
  return `
    <details class="excerpt" ${open ? 'open' : ''}>
      <summary>本文の冒頭（発信元より）</summary>
      <div class="excerpt-body">${body}</div>
    </details>
  `;
}

// 同じ出来事についての、ほかの発信元の発表・報道
function renderRelated(related) {
  if (!related?.length) return '';
  return `
    <section class="related" aria-label="関連する発表・報道">
      <h2 class="related-title">関連する発表・報道</h2>
      <ul class="related-list">
        ${related.map(r => `
          <li>
            <a href="#/article/${encodeURIComponent(r.id)}">
              <span class="related-source">${escapeHtml(r.sourceName)}${SOURCE_BADGES[r.sourceType] ? `<span class="source-badge">${SOURCE_BADGES[r.sourceType]}</span>` : ''} · ${escapeHtml(formatRelative(r.publishedAt))}</span>
              <span class="related-item-title">${escapeHtml(r.title)}</span>
            </a>
          </li>`).join('')}
      </ul>
    </section>
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
    ${renderRelated(detail.related)}
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
      if (known) known.ai = { headlineJa: data.summary.headlineJa, summary: data.summary.summary, method: data.summary.method };
    } else {
      currentDetail.summaryState = 'error';
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
  document.body.classList.remove('is-onboarding');
  onboardingView.hidden = true;
  listView.hidden = true;
  settingsView.hidden = true;
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
    Object.assign(currentDetail, { item: data.item, content: data.content, summary: data.summary, related: data.related ?? [] });
    document.title = `${data.summary?.headlineJa || data.item.title} | Personal News`;

    if (data.summary) {
      currentDetail.summaryState = 'done';
      renderDetail();
    } else if (!data.item.isSample) {
      loadSummary(id);
    } else {
      currentDetail.summaryState = 'idle';
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
  document.body.classList.remove('is-detail', 'is-onboarding');
  onboardingView.hidden = true;
  currentDetail = null;
  detailView.hidden = true;
  settingsView.hidden = true;
  settingsView.innerHTML = '';
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


// ---------- 地域・分野の選択（初回の質問と設定で共通） ----------

let choiceOptions = null;

async function loadChoiceOptions() {
  choiceOptions ??= await fetch('/api/options').then(r => r.json());
  return choiceOptions;
}

const CHECK_ICON = '<svg class="choice-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function renderChoiceGrid(kind, selected) {
  const options = kind === 'regions'
    ? choiceOptions.regions.map(option => ({ value: option.value, info: REGION_INFO[option.value], meta: `情報源 ${option.sources}` }))
    : choiceOptions.categories.map(option => ({ value: option.value, info: CATEGORY_INFO[option.value], meta: `30日で${option.articles}件` }));
  return `
    <div class="choice-grid" data-kind="${kind}">
      ${options.map(option => `
        <button class="choice" type="button" data-value="${escapeHtml(option.value)}" ${kind === 'categories' ? `data-cat="${escapeHtml(option.value)}"` : ''} aria-pressed="${selected.includes(option.value)}">
          <span class="choice-text">
            <span class="choice-label">${escapeHtml(option.value)}</span>
            <span class="choice-info">${escapeHtml(option.info ?? '')}</span>
            <span class="choice-meta">${escapeHtml(option.meta)}</span>
          </span>
          ${CHECK_ICON}
        </button>`).join('')}
    </div>
  `;
}

/** 押された選択肢を切り替え、既定の並び順で選択中の値を返す */
function toggleChoice(button, selected) {
  const grid = button.closest('.choice-grid');
  const value = button.dataset.value;
  const next = selected.includes(value) ? selected.filter(v => v !== value) : [...selected, value];
  button.setAttribute('aria-pressed', String(next.includes(value)));
  const order = [...grid.querySelectorAll('.choice')].map(choice => choice.dataset.value);
  return order.filter(v => next.includes(v));
}

// ---------- 初回の質問 ----------

const onboarding = { step: 1, regions: [], categories: [] };

function renderOnboarding() {
  const isRegions = onboarding.step === 1;
  const selected = isRegions ? onboarding.regions : onboarding.categories;
  const all = (isRegions ? choiceOptions.regions : choiceOptions.categories).map(option => option.value);
  onboardingView.innerHTML = `
    <div class="onb-inner">
      <div class="onb-progress" aria-hidden="true"><span class="is-active"></span><span class="${isRegions ? '' : 'is-active'}"></span></div>
      <p class="onb-step">質問 ${onboarding.step} / 2</p>
      <h1 class="onb-title">${isRegions ? 'どの国・地域の情報を受け取りますか？' : 'どの分野を柱にしますか？'}</h1>
      <p class="onb-lead">${isRegions
        ? '政府・自治体、企業、研究機関、団体が自ら発表した一次情報を集めます。報道機関の記事は含みません。'
        : '選んだ分野がタブになります。マイニュースには、分野に関係なく関心トピックに一致する発表を表示します。'}複数選べます。</p>
      <button class="text-button onb-all" type="button" data-action="select-all">${selected.length === all.length ? 'すべて解除' : 'すべて選択'}</button>
      ${renderChoiceGrid(isRegions ? 'regions' : 'categories', selected)}
      <div class="onb-actions">
        ${isRegions ? '' : '<button class="secondary-button" type="button" data-action="back">戻る</button>'}
        <button class="primary-action" type="button" data-action="next" ${selected.length ? '' : 'disabled'}>${isRegions ? '次へ' : 'はじめる'}</button>
      </div>
      <p class="onb-note">あとから設定でいつでも変更できます。</p>
    </div>
  `;
}

async function showOnboarding() {
  document.body.classList.add('is-onboarding');
  listView.hidden = true;
  detailView.hidden = true;
  settingsView.hidden = true;
  onboardingView.hidden = false;
  document.title = 'ようこそ | Personal News';
  window.scrollTo(0, 0);
  onboardingView.innerHTML = '<div class="empty-state">読み込み中…</div>';
  try {
    await loadChoiceOptions();
    renderOnboarding();
  } catch {
    onboardingView.innerHTML = '<div class="empty-state"><strong>読み込めませんでした</strong>通信状況を確認してください。</div>';
  }
}

onboardingView.addEventListener('click', async (event) => {
  const key = onboarding.step === 1 ? 'regions' : 'categories';
  const choice = event.target.closest('.choice');
  if (choice) {
    onboarding[key] = toggleChoice(choice, onboarding[key]);
    renderOnboarding();
    return;
  }
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'select-all') {
    const all = choiceOptions[key].map(option => option.value);
    onboarding[key] = onboarding[key].length === all.length ? [] : all;
    renderOnboarding();
  } else if (action === 'back') {
    onboarding.step = 1;
    renderOnboarding();
  } else if (action === 'next' && onboarding[key].length) {
    if (onboarding.step === 1) {
      onboarding.step = 2;
      renderOnboarding();
      window.scrollTo(0, 0);
      return;
    }
    event.target.disabled = true;
    try {
      const profile = await fetch('/api/profile').then(r => r.json());
      const response = await fetch('/api/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...profile, onboarded: true, regions: onboarding.regions, categories: onboarding.categories })
      });
      if (!response.ok) throw new Error('save');
      state.needsOnboarding = false;
      document.body.classList.remove('is-onboarding');
      onboardingView.hidden = true;
      onboardingView.innerHTML = '';
      state.tab = FOR_YOU_TAB;
      state.subgroupByTab = {};
      state.sourceTypeByTab = {};
      saveListState();
      await reloadFilters();
      location.hash = '#/';
      route();
      refreshNews();
    } catch {
      event.target.disabled = false;
      showToast('保存できませんでした');
    }
  }
});

// ---------- マイニュースの設定 ----------

const WEIGHT_OPTIONS = [
  { value: 0.6, label: '低' },
  { value: 1, label: '中' },
  { value: 1.6, label: '高' },
  { value: 2.2, label: '最優先' }
];

let profileDraft = null;
let sourcesDraft = [];
// 設定画面で表示中の区分（情報源 / 関心トピック）
let settingsPane = 'scope';
const SOURCE_TYPE_ORDER = ['official', 'corporate', 'research', 'npo'];
const REGION_ORDER = ['カナダ', '日本', '米国', '欧州', 'グローバル'];

function nearestWeight(weight) {
  return WEIGHT_OPTIONS.reduce((best, option) => (Math.abs(option.value - weight) < Math.abs(best.value - weight) ? option : best)).value;
}

function splitKeywords(text) {
  return [...new Set(text.split(/[\n,、]/).map(word => word.trim()).filter(Boolean))];
}

function renderTopicEditor(topic, index) {
  const weight = nearestWeight(topic.weight);
  const conditions = [
    topic.alsoRequires?.length ? `さらに「${topic.alsoRequires.slice(0, 4).join('・')}${topic.alsoRequires.length > 4 ? '…' : ''}」のいずれかを含む` : '',
    topic.regions?.length ? `地域: ${topic.regions.join('・')}` : '',
    topic.sourceTypes?.length ? `発信元: ${topic.sourceTypes.map(type => SOURCE_TYPE_LABELS[type] ?? type).join('・')}` : '',
    topic.sources?.length ? `常に対象: ${topic.sources.join('・')}` : '',
    topic.boostOnly ? '単独では表示せず、他の関心と重なる記事を上位にする' : ''
  ].filter(Boolean);

  return `
    <section class="topic-editor${topic.enabled ? '' : ' is-disabled'}" data-index="${index}">
      <div class="topic-head">
        <label class="switch">
          <input type="checkbox" data-field="enabled" ${topic.enabled ? 'checked' : ''}>
          <span class="switch-track" aria-hidden="true"></span>
          <span class="visually-hidden">有効</span>
        </label>
        <input class="topic-label" data-field="label" value="${escapeHtml(topic.label)}" maxlength="40" aria-label="トピック名">
        <button class="icon-button topic-delete" type="button" data-action="delete-topic" aria-label="このトピックを削除">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12"/><path d="M9 7V4h6v3"/></svg>
        </button>
      </div>
      <div class="segmented" role="radiogroup" aria-label="優先度">
        ${WEIGHT_OPTIONS.map(option => `
          <label class="segment">
            <input type="radio" name="weight-${index}" data-field="weight" value="${option.value}" ${option.value === weight ? 'checked' : ''}>
            <span>${option.label}</span>
          </label>`).join('')}
      </div>
      <label class="field">
        <span>説明（内容の近さで探します。キーワードを含まない記事も対象になります。空欄ならキーワードだけで判定）</span>
        <textarea data-field="description" rows="3" maxlength="600" placeholder="読みたい記事の内容を文章で（例: 人型ロボットやロボット学習の研究と事業化）。地名は文章よりキーワード向きです">${escapeHtml(topic.description ?? '')}</textarea>
      </label>
      <label class="field">
        <span>キーワード（改行またはカンマ区切り。日本語・英語のどちらでも）</span>
        <textarea data-field="keywords" rows="3">${escapeHtml(topic.keywords.join(', '))}</textarea>
      </label>
      ${conditions.length ? `<p class="topic-conditions">${conditions.map(escapeHtml).join('<br>')}</p>` : ''}
    </section>
  `;
}

// 内容の近さによる判定（手元の埋め込みモデル）が使えるかどうか
function semanticStatusNote() {
  const semantic = state.config?.semantic;
  if (!semantic) return '';
  if (!semantic.enabled) return '<p class="settings-note">内容の近さによる判定は無効です（キーワードだけで判定しています）。</p>';
  return semantic.available
    ? `<p class="settings-note"><span class="match-chip is-semantic">生成AI</span> のように「≈」が付いた関心は、キーワードではなく内容の近さで一致した記事です。判定はこのサーバー上の埋め込みモデル（${escapeHtml(semantic.model)}）で行い、外部の AI サービスは使いません。</p>`
    : `<p class="settings-note is-warning">埋め込みモデル（${escapeHtml(semantic.model)}）に接続できないため、いまはキーワードだけで判定しています。</p>`;
}

// ---------- 情報源の選択 ----------

function isOutOfRegion(source) {
  return profileDraft.regions.length > 0 && !profileDraft.regions.includes(source.subgroup);
}

function isSourceEnabled(source) {
  return !profileDraft.excludedSources.includes(source.id) && !isOutOfRegion(source);
}

function renderSourceRow(source) {
  const enabled = isSourceEnabled(source);
  const outOfRegion = isOutOfRegion(source);
  const details = [source.label !== source.sourceName ? source.label : '', source.subgroup, source.categories.join('・'), outOfRegion ? '選んだ地域の対象外' : `30日で${source.count}件`].filter(Boolean);
  // 直近の取得に失敗した情報源（発信元のサイトの変更や、アクセスの制限など）
  const failing = !outOfRegion && source.health && !source.health.ok;
  const url = safeUrl(source.sourceUrl);
  return `
    <li class="source-row${enabled ? '' : ' is-off'}">
      <label class="switch">
        <input type="checkbox" data-source="${escapeHtml(source.id)}" ${enabled ? 'checked' : ''} ${outOfRegion ? 'disabled' : ''}>
        <span class="switch-track" aria-hidden="true"></span>
        <span class="visually-hidden">${escapeHtml(source.label)}を使う</span>
      </label>
      <div class="source-meta">
        <span class="source-name">${escapeHtml(source.sourceName)}</span>
        <span class="source-desc">${details.map(escapeHtml).join(' · ')}</span>
        ${failing ? '<span class="source-error">取得できていません（発信元のサイトの変更またはアクセス制限）</span>' : ''}
      </div>
      ${url ? `<a class="source-link icon-button" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(source.sourceName)}のサイトを開く">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>
      </a>` : ''}
    </li>
  `;
}

function renderSourceGroup(type) {
  const sources = sourcesDraft
    .filter(source => source.sourceType === type)
    // 選んだ地域の情報源を先に、対象外の地域の情報源は後ろにまとめる
    .sort((a, b) => Number(isOutOfRegion(a)) - Number(isOutOfRegion(b)) || REGION_ORDER.indexOf(a.subgroup) - REGION_ORDER.indexOf(b.subgroup));
  if (!sources.length) return '';
  const enabledCount = sources.filter(isSourceEnabled).length;
  const available = sources.filter(source => !isOutOfRegion(source)).length;
  return `
    <section class="source-group" data-type="${type}">
      <div class="source-group-head">
        <h2>${escapeHtml(SOURCE_TYPE_LABELS[type] ?? type)} <span class="source-count">${enabledCount}/${available}</span></h2>
        ${available ? `<button class="text-button" type="button" data-action="toggle-group" data-type="${type}">${enabledCount ? 'すべてオフ' : 'すべてオン'}</button>` : ''}
      </div>
      <ul class="source-list">${sources.map(renderSourceRow).join('')}</ul>
    </section>
  `;
}

function sourceSummary() {
  const available = sourcesDraft.filter(source => !isOutOfRegion(source)).length;
  const enabled = sourcesDraft.filter(isSourceEnabled).length;
  return `選んだ地域の${available}件中 <strong>${enabled}件</strong>を使用中`;
}

function renderSourcesPane() {
  return `
    <p class="settings-lead">政府・自治体、企業、研究機関、団体・NPO が自ら公開した発表だけを集めています。報道機関の記事や論評は含みません。オフにした情報源は、すべてのタブとブリーフィングに表示されず、取り込みもしません。</p>
    <p class="source-summary">${sourceSummary()}</p>
    ${SOURCE_TYPE_ORDER.map(renderSourceGroup).join('')}
  `;
}

function renderScopePane() {
  return `
    <p class="settings-lead">受け取る国・地域と、柱にする分野を選びます。選んだ分野がタブになります。選んだ地域の外の情報源は取り込みません。マイニュースとブリーフィングは関心トピックで選ぶため、分野に関係なく一致する発表を表示します。</p>
    <h2 class="settings-subtitle">国・地域</h2>
    ${renderChoiceGrid('regions', profileDraft.regions)}
    <h2 class="settings-subtitle">分野</h2>
    ${renderChoiceGrid('categories', profileDraft.categories)}
  `;
}

function renderTopicsPane() {
  return `
    <p class="settings-lead">関心のあるトピックを登録すると、キーワードを含む記事と、説明に内容が近い記事を、関連度と新しさで並べて「マイニュース」に表示します。優先度が高いトピックほど上位に表示されます。</p>
    ${semanticStatusNote()}
    <div id="topicList">${profileDraft.topics.map(renderTopicEditor).join('')}</div>
    <button class="add-topic" type="button" data-action="add-topic">＋ トピックを追加</button>
  `;
}

function renderSettings() {
  settingsView.innerHTML = `
    <h1 class="settings-title">設定</h1>
    <div class="segmented settings-tabs" role="radiogroup" aria-label="設定の区分">
      ${[['scope', '地域・分野'], ['sources', '情報源'], ['topics', '関心トピック']].map(([value, label]) => `
        <label class="segment">
          <input type="radio" name="settings-pane" value="${value}" ${settingsPane === value ? 'checked' : ''}>
          <span>${label}</span>
        </label>`).join('')}
    </div>
    <div class="settings-pane">${{ scope: renderScopePane, sources: renderSourcesPane, topics: renderTopicsPane }[settingsPane]()}</div>
    <div class="settings-actions">
      <button class="secondary-button" type="button" data-action="reset-profile">初期設定に戻す</button>
      <button class="primary-action" type="button" data-action="save-profile">保存</button>
    </div>
  `;
}

// 入力欄の内容を下書きに反映する（再描画の前に呼ぶ）
function collectSettings() {
  // 情報源のオン・オフは切り替えた時点で下書きに反映済み
  settingsView.querySelectorAll('.topic-editor').forEach((editor) => {
    const topic = profileDraft.topics[Number(editor.dataset.index)];
    topic.enabled = editor.querySelector('[data-field="enabled"]').checked;
    topic.label = editor.querySelector('[data-field="label"]').value.trim() || topic.label;
    topic.weight = Number(editor.querySelector('[data-field="weight"]:checked')?.value ?? topic.weight);
    topic.keywords = splitKeywords(editor.querySelector('[data-field="keywords"]').value);
    topic.description = editor.querySelector('[data-field="description"]').value.trim();
  });
}

async function showSettings() {
  document.body.classList.add('is-detail');
  listView.hidden = true;
  detailView.hidden = true;
  settingsView.hidden = false;
  backButton.hidden = false;
  shareButton.hidden = true;
  document.title = '設定 | Personal News';
  window.scrollTo(0, 0);
  settingsView.innerHTML = '<div class="empty-state">読み込み中…</div>';
  try {
    const [profile, sources, config] = await Promise.all([
      fetch('/api/profile').then(r => r.json()),
      fetch('/api/sources').then(r => r.json()),
      // 埋め込みモデルの接続状況は変わりうるため、設定画面を開くたびに確認する
      fetch('/api/config').then(r => r.json()).catch(() => state.config)
    ]);
    profileDraft = { ...profile, excludedSources: profile.excludedSources ?? [] };
    // 空（未選択）は「すべて」を意味するため、画面ではすべて選んだ状態で表示する
    await loadChoiceOptions();
    if (!profileDraft.regions?.length) profileDraft.regions = choiceOptions.regions.map(option => option.value);
    if (!profileDraft.categories?.length) profileDraft.categories = choiceOptions.categories.map(option => option.value);
    sourcesDraft = sources;
    state.config = config;
    renderSettings();
  } catch {
    settingsView.innerHTML = '<div class="empty-state"><strong>設定を読み込めませんでした</strong>通信状況を確認してください。</div>';
  }
}

function setSourceEnabled(id, enabled) {
  const excluded = new Set(profileDraft.excludedSources);
  if (enabled) excluded.delete(id); else excluded.add(id);
  profileDraft.excludedSources = [...excluded];
}

// 情報源の件数の表示を、切り替えに合わせて更新する（入力中の位置を保つため全体は描き直さない）
function refreshSourceCounts() {
  settingsView.querySelectorAll('.source-group').forEach((group) => {
    const html = renderSourceGroup(group.dataset.type);
    const next = document.createElement('div');
    next.innerHTML = html;
    group.querySelector('.source-group-head').replaceWith(next.querySelector('.source-group-head'));
  });
  const summary = settingsView.querySelector('.source-summary');
  if (summary) summary.innerHTML = sourceSummary();
}

settingsView.addEventListener('change', (event) => {
  if (event.target.name === 'settings-pane') {
    if (settingsPane === 'topics') collectSettings();
    settingsPane = event.target.value;
    renderSettings();
    return;
  }
  if (event.target.matches('[data-source]')) {
    setSourceEnabled(event.target.dataset.source, event.target.checked);
    event.target.closest('.source-row').classList.toggle('is-off', !event.target.checked);
    refreshSourceCounts();
    return;
  }
  if (event.target.matches('[data-field="enabled"]')) {
    event.target.closest('.topic-editor').classList.toggle('is-disabled', !event.target.checked);
  }
});

settingsView.addEventListener('click', async (event) => {
  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!profileDraft || (!action && !event.target.closest('.choice'))) return;

  const choice = event.target.closest('.choice');
  if (choice) {
    const key = choice.closest('.choice-grid').dataset.kind;
    profileDraft[key] = toggleChoice(choice, profileDraft[key]);
    return;
  }

  if (action === 'toggle-group') {
    const sources = sourcesDraft.filter(source => source.sourceType === event.target.closest('[data-type]').dataset.type && !isOutOfRegion(source));
    const turnOn = !sources.some(isSourceEnabled);
    sources.forEach(source => setSourceEnabled(source.id, turnOn));
    renderSettings();
  } else if (action === 'add-topic') {
    collectSettings();
    profileDraft.topics.push({
      id: `custom-${Date.now().toString(36)}`, label: '新しいトピック', enabled: true, weight: 1, keywords: [], description: '',
      alsoRequires: [], alsoRequiresRegions: [], regions: [], sourceTypes: [], sources: [], boostOnly: false
    });
    renderSettings();
    settingsView.querySelector('.topic-editor:last-of-type .topic-label')?.select();
  } else if (action === 'delete-topic') {
    collectSettings();
    const index = Number(event.target.closest('.topic-editor').dataset.index);
    profileDraft.topics.splice(index, 1);
    renderSettings();
  } else if (action === 'reset-profile') {
    if (!confirm('地域・分野、情報源、関心トピックを初期設定に戻し、最初の質問からやり直しますか？')) return;
    await fetch('/api/profile/reset', { method: 'POST' });
    onboarding.step = 1;
    onboarding.regions = [];
    onboarding.categories = [];
    state.needsOnboarding = true;
    location.hash = '#/';
    route();
  } else if (action === 'save-profile') {
    collectSettings();
    if (!profileDraft.regions.length || !profileDraft.categories.length) {
      showToast('地域と分野をそれぞれ1つ以上選んでください');
      return;
    }
    if (!sourcesDraft.some(isSourceEnabled)) {
      showToast('情報源を1つ以上オンにしてください');
      return;
    }
    profileDraft.topics = profileDraft.topics.filter(topic => topic.keywords.length || topic.description || topic.sources?.length);
    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profileDraft)
    });
    if (!response.ok) {
      showToast((await response.json().catch(() => ({}))).error ?? '保存できませんでした');
      return;
    }
    showToast('保存しました');
    await reloadFilters().catch(() => {});
    // 関心トピックを編集した場合は、結果を確かめられるようマイニュースを開く
    if (settingsPane === 'topics') {
      state.tab = FOR_YOU_TAB;
      saveListState();
      tabsEl.querySelectorAll('.tab').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.tab === FOR_YOU_TAB)));
    }
    state.items = [];
    listScrollY = 0;
    location.hash = '#/';
    refreshNews();
  }
});

settingsButton.addEventListener('click', () => {
  listScrollY = window.scrollY;
  openedFromList = true;
  location.hash = '#/settings';
});

// ---------- ルーティング ----------

function route() {
  const match = location.hash.match(/^#\/article\/([^/?#]+)/);
  // 初回は、地域と分野の質問に答えてから一覧を表示する（共有された記事のリンクはそのまま開く）
  if (state.needsOnboarding && !match) {
    showOnboarding();
  } else if (location.hash === '#/settings') {
    showSettings();
  } else if (match) {
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
    fetch('/api/filters').then(r => r.json()).then((filters) => { renderFilterOptions(filters); return filters.categories; }).catch(() => []),
    fetch('/api/config').then(r => r.json()).then(config => { state.config = config; state.summaryEnabled = Boolean(config.summaryEnabled); }).catch(() => {}),
    fetch('/api/profile').then(r => r.json()).then(profile => { state.needsOnboarding = profile.onboarded === false; }).catch(() => {})
  ]);
  renderTabs(categories);
  syncFilterControls();
  route();
  if (!state.needsOnboarding) await refreshNews();
})();
