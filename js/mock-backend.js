/**
 * デモモード用バックエンド
 * shared/core.js をブラウザの localStorage 上で動かします（同じブラウザなら利用者画面と管理画面でデータを共有）。
 */
function createMockBackend() {
  var STORAGE_KEY = 'line_miniapp_demo_db_v1';
  var ADMIN_KEY = 'admin';
  var memory = null; // localStorage が使えない環境用

  function seed() {
    return { tables: { ext_master: [
      { extId: '100001', key: '19900101', name: '山田 太郎' },
      { extId: '100002', key: '20000505', name: '佐藤 花子' }
    ] }, cache: {} };
  }
  function load() {
    try {
      var d = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (d && d.tables) return d;
    } catch (e) { /* fall through */ }
    return memory || seed();
  }
  function save(d) {
    memory = d;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(d)); } catch (e) { /* memory only */ }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function createEnv(data) {
    data.cache = data.cache || {};
    return {
      db: {
        rows: function (name) { return data.tables[name] || (data.tables[name] = []); },
        insert: function (name, obj) {
          var row = {};
          CORE_TABLES[name].forEach(function (c) { row[c] = obj[c] == null ? '' : String(obj[c]); });
          this.rows(name).push(row);
        },
        update: function (name, row, patch) {
          Object.keys(patch).forEach(function (k) { row[k] = patch[k] == null ? '' : String(patch[k]); });
        }
      },
      settings: APP_SETTINGS,
      now: function () { return new Date(); },
      today: function () {
        var d = new Date();
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      },
      randomDigits: function (n) {
        var s = '';
        while (s.length < n) s += Math.floor(Math.random() * 10);
        return s;
      },
      cache: {
        get: function (k) {
          var e = data.cache[k];
          return e && e.exp > Date.now() ? e.v : null;
        },
        put: function (k, v, sec) { data.cache[k] = { v: String(v), exp: Date.now() + sec * 1000 }; }
      },
      notify: function (userId, text) { console.info('[デモ] プッシュ通知 → ' + userId + ': ' + text); },
      log: function (e) { console.error(e); }
    };
  }

  return {
    call: function (action, payload, ctx) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var c = {};
          if (action.indexOf('admin') === 0) {
            if (ctx.adminKey !== ADMIN_KEY) {
              resolve({ ok: false, error: '管理キーが違います（デモモードの管理キーは admin）' });
              return;
            }
            c.isAdmin = true;
          } else {
            c.userId = ctx.userId;
            c.displayName = ctx.displayName;
          }
          var data = load();
          var res = createCore(createEnv(data)).handle(action, payload, c);
          save(data);
          resolve(JSON.parse(JSON.stringify(res)));
        }, 200);
      });
    },
    reset: function () {
      memory = null;
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    }
  };
}
