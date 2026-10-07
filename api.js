/**
 * LIFF 認証と API 呼び出し
 *   本番   : LIFF でログイン → IDトークンを付けて GAS を呼ぶ
 *   デモ   : LIFF を使わず、ブラウザ内の擬似バックエンド（shared/core.js）を呼ぶ
 */
(function (global) {
  'use strict';
  var cfg = global.APP_CONFIG || {};
  var params = new URLSearchParams(location.search);

  // 起動時間の計測（?debug=1 で画面に表示）
  var Perf = {
    marks: {},
    mark: function (name) { this.marks[name] = Math.round(performance.now()); }
  };

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = function () { reject(new Error(src + ' を読み込めませんでした')); };
      document.head.appendChild(s);
    });
  }

  // デモ用ファイルは必要なときだけ読み込む（本番では読み込まない）
  var mockReady = null;
  function ensureMock() {
    if (!mockReady) {
      mockReady = loadScript('shared/settings.js')
        .then(function () { return loadScript('shared/core.js'); })
        .then(function () { return loadScript('js/mock-backend.js'); })
        .then(function () { return global.createMockBackend(); });
    }
    return mockReady;
  }

  // LIFF SDK は async で読み込むので、使う直前に読み込み完了を待つ
  function waitForLiffSdk() {
    if (typeof liff !== 'undefined') return Promise.resolve();
    var el = document.getElementById('liff-sdk');
    return new Promise(function (resolve, reject) {
      var fail = function () { reject(new Error('LIFF SDK を読み込めませんでした。通信環境を確認してください')); };
      if (!el) { fail(); return; }
      el.addEventListener('load', resolve);
      el.addEventListener('error', fail);
      setTimeout(function () { if (typeof liff === 'undefined') fail(); }, 20000);
    });
  }

  var Auth = {
    mock: !cfg.LIFF_ID || params.get('mock') === '1',
    profile: null,
    idToken: null,

    /** ログイン済みプロフィールを返す。ログイン画面へ移動する場合は null */
    init: async function () {
      if (this.mock) {
        var n = (params.get('user') || '1').replace(/[^0-9A-Za-z]/g, '').slice(0, 8) || '1';
        this.profile = { userId: 'Udemo' + n, displayName: 'デモユーザー' + n, pictureUrl: '' };
        await ensureMock();
        return this.profile;
      }
      await waitForLiffSdk();
      Perf.mark('SDK読み込み完了');
      await liff.init({ liffId: cfg.LIFF_ID, withLoginOnExternalBrowser: true });
      Perf.mark('LINEログイン完了');
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return null;
      }
      this.idToken = liff.getIDToken();
      if (!this.idToken) throw new Error('ログイン情報を取得できませんでした（チャネルの Scope で openid を有効にしてください）');
      // getProfile() の通信を省き、IDトークンの中身（ユーザーID・名前・アイコン）を使う
      var t = liff.getDecodedIDToken() || {};
      this.profile = { userId: t.sub, displayName: t.name || '', pictureUrl: t.picture || '' };
      return this.profile;
    },

    /** LIFF の API がこの環境で使えるか（デモモードでは常に false） */
    can: function (api) {
      return !this.mock && typeof liff !== 'undefined' && liff.isApiAvailable && liff.isApiAvailable(api);
    }
  };

  var Api = {
    adminKey: null,

    isMock: function () { return Auth.mock || !cfg.API_URL; },

    call: async function (action, payload) {
      var isAdmin = action.indexOf('admin') === 0;
      var res;
      if (this.isMock()) {
        var backend = await ensureMock();
        res = await backend.call(action, payload || {}, isAdmin
          ? { adminKey: this.adminKey }
          : { userId: Auth.profile.userId, displayName: Auth.profile.displayName });
      } else {
        var body = { action: action, payload: payload || {} };
        if (isAdmin) body.adminKey = this.adminKey; else body.idToken = Auth.idToken;
        var r;
        try {
          // text/plain にすると CORS のプリフライトが発生せず GAS で受け取れる
          r = await fetch(cfg.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(body)
          });
        } catch (e) {
          throw new Error('通信できませんでした。電波の良い場所で再度お試しください');
        }
        if (!r.ok) throw new Error('サーバーエラーが発生しました（' + r.status + '）');
        res = await r.json();
      }
      if (!res.ok) {
        var err = new Error(res.error || 'エラーが発生しました');
        err.code = res.code;
        throw err;
      }
      return res.data;
    },

    resetDemo: async function () {
      var backend = await ensureMock();
      backend.reset();
    }
  };

  // GAS は休止状態からの起動に時間がかかるため、ログイン処理と並行して軽いリクエストで起こしておく
  if (!Auth.mock && cfg.API_URL) {
    try { fetch(cfg.API_URL, { mode: 'no-cors', cache: 'no-store' }).catch(function () {}); } catch (e) { /* ignore */ }
  }

  global.Auth = Auth;
  global.Api = Api;
  global.Perf = Perf;
})(window);
