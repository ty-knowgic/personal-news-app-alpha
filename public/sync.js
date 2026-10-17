// 端末間の設定の同期。設定は Sivry のサーバーには送らず、利用者自身の Google ドライブにある
// このアプリ専用の非表示フォルダ（appDataFolder）に 1 つのファイルとして置く。
// Google へのログインは「そのフォルダにアクセスする許可」を得るためだけに使う（スコープは drive.appdata のみ）。
// 利用者が「Google でログインして同期」を押すまで、Google とは一切通信しない。
// CLIENT_ID が空のあいだは、同期の項目自体を表示しない。
(function () {
  // Google Cloud の OAuth クライアント ID（ウェブ）。公開してよい値で、秘密ではない
  const CLIENT_ID = '';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const FILE_NAME = 'sivry-settings.json';
  const STATE_KEY = 'sivry:sync';
  const UPDATED_KEY = 'sivry.profile.updatedAt';
  const DRIVE = 'https://www.googleapis.com';
  const PUSH_DELAY = 3000;

  let token = null;
  let tokenExpiry = 0;
  let queue = Promise.resolve();
  let applying = false;
  let pushTimer = 0;
  const listeners = [];

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
    } catch {
      return {};
    }
  }
  function writeState(state) {
    try {
      if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state));
      else localStorage.removeItem(STATE_KEY);
    } catch {
      // 保存できない場合、同期の状態は今回の表示だけになる
    }
  }
  function localUpdatedAt() {
    try {
      return Number(localStorage.getItem(UPDATED_KEY)) || 0;
    } catch {
      return 0;
    }
  }
  function notify(event) {
    listeners.forEach((fn) => { try { fn(event); } catch { /* 表示側の失敗で同期を止めない */ } });
  }

  function loadGis() {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts?.oauth2) return resolve();
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('gis-load'));
      document.head.appendChild(script);
    });
  }

  /** アクセストークン（約 1 時間有効、メモリのみ）。interactive=false のときは画面を出さずに取れる場合だけ取る */
  async function getToken(interactive) {
    if (token && Date.now() < tokenExpiry) return token;
    await loadGis();
    return new Promise((resolve, reject) => {
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        callback: (response) => {
          if (!response.access_token) return reject(new Error(response.error || 'auth'));
          token = response.access_token;
          tokenExpiry = Date.now() + (Number(response.expires_in) - 60) * 1000;
          resolve(token);
        },
        error_callback: (error) => reject(new Error(error?.type || 'auth'))
      });
      client.requestAccessToken({ prompt: interactive ? '' : 'none' });
    });
  }

  async function drive(path, options = {}) {
    const response = await fetch(DRIVE + path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
    if (response.status === 401) token = null;
    if (!response.ok) throw new Error(`drive-${response.status}`);
    return response;
  }

  async function findFile() {
    const q = encodeURIComponent(`name='${FILE_NAME}'`);
    const list = await drive(`/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`).then((r) => r.json());
    return list.files?.[0]?.id ?? null;
  }

  async function readRemote() {
    const id = await findFile();
    if (!id) return { id: null, data: null };
    const data = await drive(`/drive/v3/files/${id}?alt=media`).then((r) => r.json());
    return { id, data: data && typeof data === 'object' && data.profile ? data : null };
  }

  async function writeRemote(id, content) {
    const body = JSON.stringify(content);
    if (id) {
      await drive(`/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      return;
    }
    const boundary = `sivry${Date.now()}`;
    const metadata = JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] });
    const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
    await drive('/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
  }

  /**
   * ドライブと突き合わせる。版番号（rev）で「ドライブ側が更新されたか」、
   * この端末の更新時刻で「この端末が更新されたか」を判断し、片方だけなら新しい側に揃える。
   * 両方が更新されていたら resolveConflict() で利用者に選んでもらう。
   */
  function run(task) {
    const next = queue.then(task, task);
    queue = next.catch(() => {});
    return next;
  }

  function sync({ interactive, resolveConflict }) {
    return run(async () => {
      await getToken(interactive);
      const state = readState();
      const remote = await readRemote();
      const dirty = localUpdatedAt() > (state.syncedAt || 0);
      const remoteRev = remote.data?.rev || 0;
      const baseRev = state.baseRev || 0;
      let action;
      if (!remote.data) action = 'push';
      else if (remoteRev > baseRev) action = dirty ? 'conflict' : 'pull';
      else action = dirty ? 'push' : 'none';
      if (action === 'conflict') action = resolveConflict && !resolveConflict() ? 'push' : 'pull';

      if (action === 'pull') {
        applying = true;
        try {
          const response = await fetch('/api/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(remote.data.profile) });
          if (!response.ok) throw new Error('invalid-remote');
        } finally {
          applying = false;
        }
        writeState({ enabled: true, baseRev: remoteRev, syncedAt: localUpdatedAt(), lastAt: Date.now() });
        notify({ type: 'pulled' });
      } else if (action === 'push') {
        const profile = await fetch('/api/profile').then((r) => r.json());
        const rev = Math.max(remoteRev, baseRev) + 1;
        await writeRemote(remote.id, { rev, savedAt: new Date().toISOString(), profile });
        writeState({ enabled: true, baseRev: rev, syncedAt: localUpdatedAt(), lastAt: Date.now() });
      } else {
        writeState({ ...state, enabled: true, lastAt: Date.now() });
      }
      notify({ type: action });
      return action;
    });
  }

  async function disconnect() {
    if (token && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(token, () => {});
    token = null;
    tokenExpiry = 0;
    clearTimeout(pushTimer);
    writeState(null);
    notify({ type: 'disconnected' });
  }

  /** ドライブにある設定ファイルを消す（この端末の設定は残る） */
  function deleteRemote() {
    return run(async () => {
      await getToken(true);
      const id = await findFile();
      if (id) await drive(`/drive/v3/files/${id}`, { method: 'DELETE' });
      writeState({ ...readState(), baseRev: 0, syncedAt: 0 });
      notify({ type: 'deleted' });
    });
  }

  // 設定を保存したら、同期が有効でトークンがあるときだけ少し待ってから反映する
  window.addEventListener('sivry:profile-saved', () => {
    if (applying || !readState().enabled || !token || Date.now() >= tokenExpiry) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { sync({ interactive: false }).catch(() => notify({ type: 'error' })); }, PUSH_DELAY);
  });

  window.SivrySync = {
    available: Boolean(CLIENT_ID),
    state: readState,
    connect: (resolveConflict) => sync({ interactive: true, resolveConflict }),
    syncNow: (resolveConflict) => sync({ interactive: true, resolveConflict }),
    /** ページを開いたとき。許可済みなら画面を出さずに同期する（できなければ何もしない） */
    auto: (resolveConflict) => (readState().enabled ? sync({ interactive: false, resolveConflict }).catch(() => null) : Promise.resolve(null)),
    disconnect,
    deleteRemote,
    on: (fn) => listeners.push(fn)
  };
})();
