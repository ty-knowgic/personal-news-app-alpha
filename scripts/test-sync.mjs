// Google ドライブ同期（public/sync.js）の判断ロジックを、偽の Drive と偽の Google ログインで確かめる。
// 実際の Google とは通信しない。2 台の端末は、別々の localStorage と別々の window で表す。
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source = (await readFile(new URL('../public/sync.js', import.meta.url), 'utf8')).replace("const CLIENT_ID = '';", "const CLIENT_ID = 'test-client';");
const drive = { file: null, calls: [] }; // 共有のドライブ（appDataFolder の 1 ファイル）
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : ` ${detail}`}`); if (!ok) failures++; };

function device() {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.test/', runScripts: 'outside-only' });
  const w = dom.window;
  let profile = { regions: ['JP'], marker: 'initial' };
  w.google = { accounts: { oauth2: {
    initTokenClient: (cfg) => ({ requestAccessToken: () => cfg.callback({ access_token: 'tok', expires_in: 3600 }) }),
    revoke: () => {}
  } } };
  w.fetch = async (url, options = {}) => {
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (url === '/api/profile') {
      if (options.method === 'PUT') {
        profile = JSON.parse(options.body);
        w.localStorage.setItem('sivry.profile.updatedAt', String(Math.max(Date.now(), Number(w.localStorage.getItem('sivry.profile.updatedAt')) + 1)));
        w.dispatchEvent(new w.Event('sivry:profile-saved'));
      }
      return json(profile);
    }
    drive.calls.push(`${options.method || 'GET'} ${url.replace('https://www.googleapis.com', '').split('?')[0]}`);
    if (options.headers?.Authorization !== 'Bearer tok') return json({}, 401);
    if (url.includes('alt=media')) return json(drive.file);
    if (url.includes('/drive/v3/files?') && !url.includes('/upload/')) return json({ files: drive.file ? [{ id: 'f1' }] : [] });
    if (options.method === 'DELETE') { drive.file = null; return json({}); }
    if (url.includes('/upload/')) {
      const raw = options.body;
      drive.file = JSON.parse(raw.includes('--sivry') ? raw.split('\r\n\r\n')[2].split('\r\n--')[0] : raw);
      return json({ id: 'f1' });
    }
    return json({}, 404);
  };
  w.eval(source);
  return {
    sync: w.SivrySync,
    get profile() { return profile; },
    edit(change) { profile = { ...profile, ...change }; w.localStorage.setItem('sivry.profile.updatedAt', String(Math.max(Date.now(), Number(w.localStorage.getItem('sivry.profile.updatedAt')) + 1))); },
    window: w
  };
}

const a = device();
const b = device();
check('クライアント ID があれば利用可能になる', a.sync.available === true);

a.edit({ marker: 'from-A' });
check('A: 初回はドライブが空なので送信する', (await a.sync.connect()) === 'push' && drive.file?.profile.marker === 'from-A' && drive.file.rev === 1);

check('B: 未変更の端末は、ドライブの設定を取り込む', (await b.sync.connect()) === 'pull' && b.profile.marker === 'from-A');
check('B: 取り込んだ直後は変更なしと判断する', (await b.sync.syncNow()) === 'none');

b.edit({ marker: 'from-B' });
check('B: 自分だけが変更したら送信する（版が 2 になる）', (await b.sync.syncNow()) === 'push' && drive.file.rev === 2);
check('A: 相手だけが変更したら取り込む', (await a.sync.syncNow()) === 'pull' && a.profile.marker === 'from-B');

a.edit({ marker: 'A-again' });
b.edit({ marker: 'B-again' });
await b.sync.syncNow();
let asked = 0;
check('A: 両方が変更していたら利用者に確認する（キャンセルで自分の設定を送信）', (await a.sync.syncNow(() => { asked++; return false; })) === 'push' && asked === 1 && drive.file.profile.marker === 'A-again');
a.edit({ marker: 'A-third' });
b.edit({ marker: 'B-third' });
await a.sync.syncNow();
check('B: 競合で OK を選ぶとドライブの設定を使う', (await b.sync.syncNow(() => true)) === 'pull' && b.profile.marker === 'A-third');

// 保存すると、数秒後に自動で送信される（トークンがあるとき）
b.edit({ marker: 'auto' });
b.window.dispatchEvent(new b.window.Event('sivry:profile-saved'));
await new Promise((r) => setTimeout(r, 3300));
check('B: 設定の保存後に自動で送信する', drive.file.profile.marker === 'auto');

await b.sync.deleteRemote();
check('ドライブの保存データを削除できる', drive.file === null);
await b.sync.disconnect();
check('同期をやめると状態を消す', b.window.localStorage.getItem('sivry:sync') === null);
check('同期をやめた端末は自動同期しない', (await b.sync.auto()) === null);
check('サーバー（Sivry）への通信はない: 通信先は /api/profile と Google のみ', drive.calls.every((c) => /\/(drive|upload)\//.test(c)));

console.log(failures ? `失敗: ${failures}` : 'すべて成功');
process.exit(failures ? 1 : 0);
