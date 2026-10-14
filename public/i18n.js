// 画面の言語切り替え。日本語の文言をそのままキーにし、他の言語の訳を LANGUAGES に追加する。
// 訳がないキーは日本語のまま表示する。{name} は t() の第2引数で置き換える。
// 記事の本文・要約・ブリーフィングの文章は発信元と要約エンジンが作るため、この仕組みでは翻訳しない。
const LANGUAGES = {
  ja: { label: '日本語', locale: 'ja-JP', messages: {} },
  en: {
    label: 'English',
    locale: 'en-CA',
    messages: {
      // ヘッダー・一覧
      '戻る': 'Back',
      '共有': 'Share',
      '設定': 'Settings',
      '検索': 'Search',
      'キーワード・#タグで検索': 'Search keywords or #tags',
      'カテゴリ': 'Categories',
      '地域': 'Region',
      'すべての地域': 'All regions',
      '発信元': 'Publisher',
      'すべての発信元': 'All publishers',
      '読み込み中…': 'Loading…',
      '更新中…': 'Updating…',
      'さらに読み込む': 'Load more',
      'マイニュース': 'My News',
      'すべて': 'All',
      'すべてのカテゴリ': 'All categories',
      'すべてのマイニュース': 'All My News',
      // 日時
      'たった今': 'Just now',
      '{n}分前': '{n}m ago',
      '{n}時間前': '{n}h ago',
      '今日': 'Today',
      '昨日': 'Yesterday',
      // 発信元の種別
      '政府・自治体': 'Government',
      '企業': 'Companies',
      '研究機関': 'Research institutes',
      '団体・NPO': 'Organizations & NPOs',
      '研究': 'Research',
      '団体': 'Org',
      // 分野
      '政治': 'Politics',
      '経済': 'Economy',
      '投資': 'Investment',
      '安全保障': 'Security',
      '国際': 'International',
      '社会': 'Society',
      'テクノロジー': 'Technology',
      '生成AI': 'Generative AI',
      'サイエンス': 'Science',
      '文化・芸術': 'Culture & Arts',
      'イベント': 'Events',
      // 地域
      '日本': 'Japan',
      'カナダ': 'Canada',
      '米国': 'United States',
      '欧州': 'Europe',
      'グローバル': 'Global',
      // 地域・分野の説明
      '連邦政府・オンタリオ州・ウォータールー地域の自治体': 'Federal government, Ontario, and Waterloo-area municipalities',
      '官邸・各省庁・日本銀行・企業の発表': 'Prime Minister’s Office, ministries, the Bank of Japan and companies',
      '連邦政府・規制当局・企業': 'Federal government, regulators and companies',
      'EU・英国': 'EU and UK',
      '国際機関・多国籍企業': 'International organizations and multinational companies',
      '政府の方針・法案・選挙': 'Government policy, legislation and elections',
      '金融政策・統計・企業の決算や M&A': 'Monetary policy, statistics, corporate earnings and M&A',
      '政府の投資策・スタートアップの資金調達': 'Government investment policy and startup funding',
      '防衛・サイバーセキュリティ': 'Defence and cybersecurity',
      '外交・国際機関': 'Diplomacy and international organizations',
      '保健・福祉・教育・地域の暮らし': 'Health, welfare, education and community life',
      'ロボット・半導体・デジタル政策': 'Robotics, semiconductors and digital policy',
      'LLM・AI エージェント・AI 企業の発表': 'LLMs, AI agents and AI company announcements',
      '数学・科学・工学（STEM）の研究成果': 'Research in mathematics, science and engineering (STEM)',
      '芸術・文化財・文化政策': 'Arts, cultural heritage and cultural policy',
      '催し・展示会・カンファレンス': 'Events, exhibitions and conferences',
      '情報源 {n}': '{n} sources',
      '30日で{n}件': '{n} items in 30 days',
      // 既定の関心トピック名
      'ウォータールー周辺': 'Waterloo area',
      'オンタリオ州': 'Ontario',
      'Physical AI・ロボット': 'Physical AI & robotics',
      '日本×カナダ': 'Japan × Canada',
      '米国・EU のテック政策': 'US & EU tech policy',
      '数学・新発見': 'Mathematics & discoveries',
      '提携・資金調達・M&A': 'Partnerships, funding & M&A',
      // 記事カード
      'AI要約': 'AI summary',
      '要約': 'Summary',
      '関心: {topics}': 'Interests: {topics}',
      'キーワードではなく内容の近さで一致': 'Matched by meaning, not keywords',
      ' など': ' and others',
      '同じ発信元の続報': 'Follow-up from the same publisher',
      '関連 {n}件': '{n} related',
      ' ほか{n}件': ' +{n} more',
      'サンプル': 'Sample',
      '公式フィードを取得できなかったため、サンプルを表示しています': 'Official feeds could not be fetched, so sample items are shown',
      '{n}件': '{n} items',
      '・「{keyword}」': ' · “{keyword}”',
      '「{keyword}」に一致する記事はありません': 'No articles match “{keyword}”',
      '別のキーワードをお試しください。': 'Try a different keyword.',
      '関心に一致する記事がまだありません': 'No articles match your interests yet',
      '{link}で関心トピックやキーワードを追加できます。': 'Add interest topics or keywords in {link}.',
      'まだ記事がありません': 'No articles yet',
      '{scope}の新しい発表が出ると、ここに表示されます。': 'New announcements for {scope} will appear here.',
      'ニュースを読み込めませんでした': 'Could not load the news',
      '通信状況を確認して、ページを再読み込みしてください。': 'Check your connection and reload the page.',
      // ブリーフィング
      '過去24時間': 'Last 24 hours',
      '過去{n}時間': 'Last {n} hours',
      '過去{n}日間': 'Last {n} days',
      '今日のブリーフィング': 'Today’s briefing',
      '最近のブリーフィング': 'Recent briefing',
      '{period}に、あなたの関心に一致した {n}件の話題から': '{period}: {n} stories matching your interests',
      '関心トピックごとの話題数': 'Stories per interest topic',
      // 詳細
      '発信元ページの本文': 'the publisher’s page',
      '発信元が公開した PDF 資料': 'the PDF published by the publisher',
      '発信元の配信文（本文を取得できなかったため）': 'the publisher’s feed text (the full page could not be fetched)',
      '発信元の本文': 'the publisher’s text',
      '{source}のみをもとに、AI（{model}）が作成した要約です。誤りを含む可能性があるため、重要な内容は元記事でご確認ください。': 'Summary written by AI ({model}) based only on {source}. It may contain errors, so check the original for anything important.',
      '{source}から重要な文をそのまま抜き出しています（AI による書き換えはしていません）。': 'Key sentences are extracted verbatim from {source} (not rewritten by AI).',
      '発信元ページから、この記事の内容を読み取れませんでした。元記事でご確認ください。': 'Could not read this article from the publisher’s page. Please check the original.',
      '記事を読み込んで要約しています…': 'Reading the article and summarizing…',
      '要約を作成できませんでした。': 'Could not create a summary.',
      'もう一度試す': 'Try again',
      '続きは元記事でご覧ください。': 'Read the rest at the original.',
      '発表資料は PDF で公開されています。': 'The announcement is published as a PDF.',
      '発信元ページから本文を取得できませんでした。': 'Could not fetch the text from the publisher’s page.',
      '本文の冒頭（発信元より）': 'Opening text (from the publisher)',
      '関連する発表・報道': 'Related announcements',
      'サンプル（取得失敗時の表示）': 'Sample (shown when fetching fails)',
      '原題: {title}': 'Original title: {title}',
      '元記事を読む（{source}）': 'Read the original ({source})',
      '通信エラーのため要約を取得できませんでした。': 'Could not fetch the summary because of a network error.',
      '記事が見つかりません': 'Article not found',
      '掲載期間が終了した可能性があります。': 'It may have passed its retention period.',
      '記事を読み込めませんでした': 'Could not load the article',
      '通信状況を確認してください。': 'Please check your connection.',
      'リンクをコピーしました': 'Link copied',
      // 初回の質問
      '質問 {step} / 2': 'Question {step} / 2',
      'どの国・地域の情報を受け取りますか？': 'Which countries and regions do you want news from?',
      'どの分野を柱にしますか？': 'Which topics should be your main focus?',
      '政府・自治体、企業、研究機関、団体が自ら発表した一次情報を集めます。報道機関の記事は含みません。': 'We collect primary information published directly by governments, companies, research institutes and organizations. News media articles are not included.',
      '選んだ分野がタブになります。マイニュースには、分野に関係なく関心トピックに一致する発表を表示します。': 'The topics you choose become tabs. My News shows announcements that match your interest topics, whatever their category.',
      '複数選べます。': 'You can choose several.',
      'すべて解除': 'Clear all',
      'すべて選択': 'Select all',
      '次へ': 'Next',
      'はじめる': 'Get started',
      'あとから設定でいつでも変更できます。': 'You can change this any time in Settings.',
      'ようこそ': 'Welcome',
      '読み込めませんでした': 'Could not load',
      '保存できませんでした': 'Could not save',
      // 設定
      '低': 'Low',
      '中': 'Medium',
      '高': 'High',
      '最優先': 'Top',
      '地域・分野': 'Regions & topics',
      '情報源': 'Sources',
      '関心トピック': 'Interests',
      '設定の区分': 'Settings section',
      '言語': 'Language',
      '画面の表示言語です。記事の本文や要約は発信元・要約エンジンの言語のまま表示されます。': 'The language of the app interface. Article text and summaries stay in the language produced by the publisher and the summary engine.',
      '初期設定に戻す': 'Reset to defaults',
      '保存': 'Save',
      '保存しました': 'Saved',
      '設定を読み込めませんでした': 'Could not load settings',
      '有効': 'Enabled',
      'トピック名': 'Topic name',
      'このトピックを削除': 'Delete this topic',
      '優先度': 'Priority',
      '説明（内容の近さで探します。キーワードを含まない記事も対象になります。空欄ならキーワードだけで判定）': 'Description (matched by meaning, so articles without the keywords can match too. Leave blank to match on keywords only)',
      '読みたい記事の内容を文章で（例: 人型ロボットやロボット学習の研究と事業化）。地名は文章よりキーワード向きです': 'Describe the articles you want to read (e.g. research and commercialization of humanoid robots and robot learning). Place names work better as keywords',
      'キーワード（改行またはカンマ区切り。日本語・英語のどちらでも）': 'Keywords (separated by line breaks or commas; Japanese or English)',
      'さらに「{words}{more}」のいずれかを含む': 'Must also contain one of “{words}{more}”',
      '地域: {value}': 'Regions: {value}',
      '発信元: {value}': 'Publishers: {value}',
      '常に対象: {value}': 'Always included: {value}',
      '単独では表示せず、他の関心と重なる記事を上位にする': 'Not shown on its own; boosts articles that overlap with other interests',
      '内容の近さによる判定は無効です（キーワードだけで判定しています）。': 'Matching by meaning is turned off (keywords only).',
      '{chip} のように「≈」が付いた関心は、キーワードではなく内容の近さで一致した記事です。判定はこのサーバー上の埋め込みモデル（{model}）で行い、外部の AI サービスは使いません。': 'Interests marked with “≈”, like {chip}, matched by meaning rather than keywords. Matching runs on the embedding model ({model}) on this server; no external AI service is used.',
      '埋め込みモデル（{model}）に接続できないため、いまはキーワードだけで判定しています。': 'Cannot reach the embedding model ({model}), so matching is keywords only for now.',
      '選んだ地域の対象外': 'Outside the selected regions',
      '{name}を使う': 'Use {name}',
      '{name}のサイトを開く': 'Open the {name} site',
      '取得できていません（発信元のサイトの変更またはアクセス制限）': 'Not being fetched (the publisher changed its site or restricts access)',
      'すべてオフ': 'Turn all off',
      'すべてオン': 'Turn all on',
      '選んだ地域の{available}件中 <strong>{enabled}件</strong>を使用中': 'Using <strong>{enabled}</strong> of {available} sources in the selected regions',
      '政府・自治体、企業、研究機関、団体・NPO が自ら公開した発表だけを集めています。報道機関の記事や論評は含みません。オフにした情報源は、すべてのタブとブリーフィングに表示されず、取り込みもしません。': 'We only collect announcements published directly by governments, companies, research institutes and organizations/NPOs. News media articles and commentary are not included. Sources you turn off are not fetched and do not appear in any tab or the briefing.',
      '受け取る国・地域と、柱にする分野を選びます。選んだ分野がタブになります。選んだ地域の外の情報源は取り込みません。マイニュースとブリーフィングは関心トピックで選ぶため、分野に関係なく一致する発表を表示します。': 'Choose the countries and regions you want and the topics to focus on. The topics become tabs, and sources outside the chosen regions are not fetched. My News and the briefing are selected by interest topics, so they show matching announcements in any category.',
      '国・地域': 'Countries & regions',
      '分野': 'Topics',
      '関心のあるトピックを登録すると、キーワードを含む記事と、説明に内容が近い記事を、関連度と新しさで並べて「マイニュース」に表示します。優先度が高いトピックほど上位に表示されます。': 'Register topics you care about and My News shows articles containing the keywords or close in meaning to the description, ordered by relevance and recency. Higher-priority topics rank higher.',
      '＋ トピックを追加': '+ Add topic',
      '新しいトピック': 'New topic',
      '地域・分野、情報源、関心トピックを初期設定に戻し、最初の質問からやり直しますか？': 'Reset regions, topics, sources and interests to the defaults and start again from the first question?',
      '地域と分野をそれぞれ1つ以上選んでください': 'Choose at least one region and one topic',
      '情報源を1つ以上オンにしてください': 'Turn on at least one source'
    }
  }
};

const LANG_STORAGE_KEY = 'sivry:lang';
const DEFAULT_LANG = 'ja';

function readLang() {
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved && LANGUAGES[saved]) return saved;
  } catch {
    // 保存データが読めなくても既定の言語で動作する
  }
  return DEFAULT_LANG;
}

let currentLang = readLang();

function getLang() {
  return currentLang;
}

function setLang(lang) {
  if (!LANGUAGES[lang]) return;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // 保存できない場合、今回の表示だけ切り替わる
  }
  currentLang = lang;
}

function locale() {
  return LANGUAGES[currentLang].locale;
}

/** 日本語の文言（キー）を現在の言語に直す。訳がなければ日本語のまま使う */
function t(key, params) {
  const text = LANGUAGES[currentLang].messages[key] ?? key;
  return params ? text.replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match)) : text;
}

/** index.html の data-i18n（本文）・data-i18n-aria（aria-label）・data-i18n-placeholder を現在の言語にする */
function applyStaticTranslations() {
  document.documentElement.lang = currentLang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder)); });
}

applyStaticTranslations();
