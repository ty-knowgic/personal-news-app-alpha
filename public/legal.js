// 法務ページの言語切り替え。日本語と英語を用意し、保存した表示言語（なければブラウザの言語）で選ぶ。
// それ以外の言語では英語を表示する。スクリプトが動かないときは両方を表示する。
(function () {
  var saved = '';
  try {
    saved = localStorage.getItem('sivry:lang') || '';
  } catch (e) {
    // 保存データが読めなくても、ブラウザの言語設定で選ぶ
  }
  var preferred = saved || (navigator.languages && navigator.languages[0]) || navigator.language || 'en';
  var current = String(preferred).toLowerCase().indexOf('ja') === 0 ? 'ja' : 'en';

  function show(lang) {
    document.querySelectorAll('[data-legal]').forEach(function (el) { el.hidden = el.dataset.legal !== lang; });
    document.querySelectorAll('.legal-lang button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.lang === lang)); });
    document.documentElement.lang = lang;
  }

  document.querySelectorAll('.legal-lang button').forEach(function (b) {
    b.addEventListener('click', function () { show(b.dataset.lang); });
  });
  show(current);
})();
