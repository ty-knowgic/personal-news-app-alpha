// 画面の言語切り替え。日本語の文言をそのままキーにし、各言語の訳は locales/<言語>.json に置く。
// 訳の探し方: 選んだ言語 → 情報源の名前（sources.json）→ 英語（en.json）→ キー（日本語）の順。
// 日本語は訳を持たず、キーをそのまま表示する。{name} は t() の第2引数で置き換える。
// 件数で形が変わる文言は {one, other, …} の形で書き、Intl.PluralRules の区分で選ぶ（件数は count か n）。
// 記事の本文・要約・ブリーフィングの文章は発信元と要約エンジンが作るため、この仕組みでは翻訳しない。
const LANGUAGES = {
  ja: { label: '日本語', locale: 'ja-JP', dir: 'ltr' },
  en: { label: 'English', locale: 'en', dir: 'ltr' },
  id: { label: 'Bahasa Indonesia', locale: 'id', dir: 'ltr' },
  ms: { label: 'Bahasa Melayu', locale: 'ms', dir: 'ltr' },
  th: { label: 'ไทย', locale: 'th', dir: 'ltr' },
  vi: { label: 'Tiếng Việt', locale: 'vi', dir: 'ltr' },
  fil: { label: 'Filipino', locale: 'fil', dir: 'ltr' },
  'zh-Hans': { label: '简体中文', locale: 'zh-CN', dir: 'ltr' },
  'zh-Hant': { label: '繁體中文', locale: 'zh-TW', dir: 'ltr' },
  fr: { label: 'Français', locale: 'fr', dir: 'ltr' },
  es: { label: 'Español', locale: 'es', dir: 'ltr' },
  de: { label: 'Deutsch', locale: 'de', dir: 'ltr' },
  pt: { label: 'Português', locale: 'pt', dir: 'ltr' }
};

const LANG_STORAGE_KEY = 'sivry:lang';
// 日本語は訳を持たない。それ以外の言語で訳が見つからないときは英語を使う
const FALLBACK_LANG = 'en';
const FALLBACK_DICTIONARIES = ['sources', FALLBACK_LANG];

/** ブラウザの言語タグ（zh-TW、fil、tl など）を、対応する言語の記号にする。対応外なら null */
function matchLanguage(tag) {
  const lower = String(tag ?? '').toLowerCase();
  const base = lower.split('-')[0];
  if (base === 'zh') return /hant|-(tw|hk|mo)\b/.test(lower) ? 'zh-Hant' : 'zh-Hans';
  const aliases = { tl: 'fil', in: 'id', nb: null, no: null };
  const code = base in aliases ? aliases[base] : base;
  return code && LANGUAGES[code] ? code : null;
}

/** 保存した選択がなければ、ブラウザの言語設定から決める。どれも対応外なら英語 */
function detectLanguage() {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && LANGUAGES[saved]) return saved;
  } catch {
    // 保存データが読めなくても、ブラウザの言語設定で動作する
  }
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const code = matchLanguage(tag);
    if (code) return code;
  }
  return FALLBACK_LANG;
}

let currentLang = detectLanguage();
const dictionaries = {};
const pluralRules = {};

async function loadDictionary(name) {
  if (dictionaries[name]) return;
  try {
    // 相対パスにしておく（GitHub Pages のようにサイトが下位のパスにあっても読めるように）
    const response = await fetch(`locales/${name}.json`);
    dictionaries[name] = response.ok ? await response.json() : {};
  } catch {
    dictionaries[name] = {};
  }
}

async function loadMessages(lang) {
  await Promise.all([...new Set([...FALLBACK_DICTIONARIES, ...(lang === 'ja' ? [] : [lang])])].map(loadDictionary));
}

function getLang() {
  return currentLang;
}

async function setLang(lang) {
  if (!LANGUAGES[lang]) return;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // 保存できない場合、今回の表示だけ切り替わる
  }
  await loadMessages(lang);
  currentLang = lang;
  applyStaticTranslations();
}

/** 日付・数値の書式に使うロケール。端末の設定が同じ言語なら、地域まで含めてそのまま使う（fr-CA、en-GB など） */
function locale() {
  const preferred = navigator.language;
  if (preferred && preferred.includes('-') && matchLanguage(preferred) === currentLang) {
    try {
      if (Intl.DateTimeFormat.supportedLocalesOf([preferred]).length) return preferred;
    } catch {
      // 不正な言語タグなら既定のロケールを使う
    }
  }
  return LANGUAGES[currentLang].locale;
}

function pluralCategory(params) {
  const count = Number(params?.count ?? params?.n);
  if (!Number.isFinite(count)) return 'other';
  pluralRules[currentLang] ??= new Intl.PluralRules(locale());
  return pluralRules[currentLang].select(count);
}

function lookup(key) {
  if (currentLang !== 'ja') {
    for (const name of [currentLang, ...FALLBACK_DICTIONARIES]) {
      const message = dictionaries[name]?.[key];
      if (message !== undefined) return message;
    }
  }
  return key;
}

/** 日本語の文言（キー）を現在の言語に直す。訳がなければ英語、それもなければ日本語のまま使う */
function t(key, params) {
  let message = lookup(key);
  if (message !== null && typeof message === 'object') message = message[pluralCategory(params)] ?? message.other ?? key;
  return params ? message.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : message;
}

/** 「5分前」のような相対時間。言語ごとの語順・省略形は Intl に任せる */
function formatAgo(unit, amount) {
  const style = currentLang === 'ja' ? 'narrow' : 'short';
  return new Intl.RelativeTimeFormat(locale(), { style }).format(-amount, unit);
}

/** 並べて表示する語の区切り（、 / , など）は言語に合わせる */
function formatList(items) {
  return new Intl.ListFormat(locale(), { style: 'narrow', type: 'conjunction' }).format(items);
}

/** index.html の data-i18n（本文）・data-i18n-aria（aria-label）・data-i18n-placeholder を現在の言語にする */
function applyStaticTranslations() {
  document.documentElement.lang = LANGUAGES[currentLang].locale;
  document.documentElement.dir = LANGUAGES[currentLang].dir;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)); });
}

// 訳の読み込みが終わってから描画を始められるよう、app.js はこれを待つ
const i18nReady = loadMessages(currentLang).then(applyStaticTranslations);
