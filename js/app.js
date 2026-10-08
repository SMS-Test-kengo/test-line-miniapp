/** 利用者画面 */
(function () {
  'use strict';
  var cfg = window.APP_CONFIG || {};
  var esc = UI.esc;
  var TABS = ['card', 'rally', 'vote', 'reception', 'link'];
  var POLL_MS = 20000;

  var app = {
    config: null,
    state: null,
    tab: 'card',
    openSurveyId: null,
    results: {}
  };

  function $(sel) { return document.querySelector(sel); }

  // ログインと最新データの取得が終わったら解決する（それまでの操作は待たせる）
  var isReady = false;
  var markReady;
  var ready = new Promise(function (resolve) { markReady = resolve; });

  // ---------------- 前回データのキャッシュ（2回目以降の即時表示用） ----------------

  var CACHE_KEY = 'miniapp_cache_v1:' + (Auth.mock ? 'demo' : cfg.LIFF_ID);

  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY));
      return c && c.config && c.state ? c : null;
    } catch (e) { return null; }
  }

  function saveCache() {
    if (!Auth.profile || !app.state) return;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ userId: Auth.profile.userId, config: app.config, state: app.state }));
    } catch (e) { /* 保存できなくても動作に影響なし */ }
  }

  function setState(state) {
    app.state = state;
    saveCache();
  }

  // ---------------- 共通 ----------------

  /** API を呼び、成功したら状態を更新して再描画する。失敗時はトーストを出して null を返す */
  async function run(action, payload) {
    UI.busy(true);
    try {
      await ready;
      var data = await Api.call(action, payload);
      if (data.state) { setState(data.state); renderAll(); }
      if (data.message) UI.toast(data.message, 'ok');
      return data;
    } catch (e) {
      if (e.code === 'AUTH') showFatal(e.message, true);
      else UI.toast(e.message, 'error');
      return null;
    } finally {
      UI.busy(false);
    }
  }

  function showFatal(message, canReload) {
    $('#main').innerHTML = '<div class="panel fatal"><h2>表示できませんでした</h2><p>' + esc(message) + '</p>' +
      (canReload ? '<button class="btn primary block" data-act="reload">再読み込み</button>' : '') + '</div>';
    $('.tabbar').hidden = true;
  }

  function switchTab(tab) {
    if (TABS.indexOf(tab) < 0) tab = 'card';
    app.tab = tab;
    document.querySelectorAll('.tab').forEach(function (s) { s.hidden = s.dataset.tab !== tab; });
    document.querySelectorAll('.tabbar button').forEach(function (b) {
      var on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    try { sessionStorage.setItem('tab', tab); } catch (e) { /* ignore */ }
    window.scrollTo(0, 0);
  }

  function renderAll() {
    renderCard();
    renderRally();
    renderVote();
    renderTicket();
    renderReserve();
    renderLink();
  }

  // ---------------- 会員証 / スタンプカード ----------------

  function renderCard() {
    var m = app.state.member, sc = app.config.stampCard;
    var cells = '';
    for (var i = 0; i < m.goal; i++) {
      cells += i < m.current
        ? '<div class="stamp on" aria-label="スタンプ済み"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>'
        : '<div class="stamp">' + (i + 1) + '</div>';
    }
    var share = Auth.can('shareTargetPicker')
      ? '<button class="btn ghost block" data-act="share">友だちにこのアプリを紹介する</button>' : '';

    $('#tab-card').innerHTML =
      '<div class="member-card">' +
        '<div class="mc-head"><span class="mc-brand">' + esc(app.config.appName) + '</span><span class="mc-kind">MEMBER\'S CARD</span></div>' +
        '<div class="mc-body">' +
          '<div class="mc-info">' +
            '<div class="mc-name">' + esc(m.displayName || 'ゲスト') + ' 様</div>' +
            '<div class="mc-no-label">会員番号</div>' +
            '<div class="mc-no">' + esc(UI.formatMemberNo(m.memberNo)) + '</div>' +
            (m.ext ? '<div class="mc-ext">連携済み：' + esc(app.config.extLink.idLabel) + ' ' + esc(m.ext.id) + '</div>' : '') +
          '</div>' +
          '<div class="mc-qr" id="member-qr" role="img" aria-label="会員証QRコード"></div>' +
        '</div>' +
      '</div>' +
      '<p class="note center">スタンプ・特典はこの画面をスタッフに提示</p>' +
      '<div class="panel">' +
        '<div class="panel-head"><h2>スタンプカード</h2><span class="pill">' + m.current + ' / ' + m.goal + '</span></div>' +
        '<div class="stamp-grid">' + cells + '</div>' +
        '<p class="muted">あと <b>' + (m.goal - m.current) + '</b> 個で「' + esc(sc.rewardName) + '」</p>' +
        (m.rewardsAvailable > 0
          ? '<div class="reward-box"><b>特典が ' + m.rewardsAvailable + ' 回分あります</b><small>' + esc(sc.rewardNote) + '</small></div>'
          : '') +
      '</div>' + share;

    UI.qr($('#member-qr'), m.memberNo, 112);
  }

  async function share() {
    try {
      var res = await liff.shareTargetPicker([{
        type: 'text',
        text: app.config.appName + '\nLINEですぐ使えるミニアプリです\nhttps://miniapp.line.me/' + cfg.LIFF_ID
      }], { isMultiple: true });
      if (res) UI.toast('送信しました', 'ok');
    } catch (e) {
      UI.toast('シェアできませんでした', 'error');
    }
  }

  // ---------------- スタンプラリー ----------------

  function renderRally() {
    var rc = app.config.rally, st = app.state.rally;
    var total = rc.checkpoints.length;
    var count = rc.checkpoints.filter(function (c) { return st.done.indexOf(c.id) >= 0; }).length;
    var pct = total ? Math.round(count * 100 / total) : 0;

    var list = rc.checkpoints.map(function (c) {
      var done = st.done.indexOf(c.id) >= 0;
      return '<li class="cp ' + (done ? 'done' : '') + '">' +
        '<span class="cp-mark">' + (done ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '') + '</span>' +
        '<span class="cp-text"><b>' + esc(c.name) + '</b><small>' + esc(c.hint || '') + '</small></span></li>';
    }).join('');

    var demo = '';
    if (Auth.mock && window.APP_SETTINGS) {
      demo = '<div class="demo-box"><p>デモ：QRコードを読み取ったことにする</p>' +
        APP_SETTINGS.rally.checkpoints.map(function (c) {
          return '<button class="btn small" data-act="demo-rally" data-code="' + esc(c.code) + '">' + esc(c.name) + '</button>';
        }).join('') + '</div>';
    }

    $('#tab-rally').innerHTML =
      (st.completed
        ? '<div class="panel complete"><h2>コンプリート！</h2><p>「' + esc(rc.rewardName) + '」と交換できます。<br>受付でこの画面を提示してください。</p></div>'
        : '') +
      '<div class="panel">' +
        '<div class="panel-head"><h2>' + esc(rc.title) + '</h2><span class="pill">' + count + ' / ' + total + '</span></div>' +
        '<div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="' + total + '" aria-valuenow="' + count + '"><i style="width:' + pct + '%"></i></div>' +
        '<p class="muted">各スポットのQRコードを読み取ってスタンプを集めよう。全部集めると「' + esc(rc.rewardName) + '」がもらえます。</p>' +
        '<ul class="cp-list">' + list + '</ul>' +
        '<button class="btn primary block" data-act="scan-rally">QRコードを読み取る</button>' +
      '</div>' + demo;
  }

  /** QR の中身が「?rally=コード」付き URL でもコード単体でも受け付ける */
  function extractRallyCode(text) {
    text = String(text || '').trim();
    try {
      var u = new URL(text);
      if (u.searchParams.get('rally')) return u.searchParams.get('rally');
      var state = u.searchParams.get('liff.state');
      if (state) {
        var p = new URLSearchParams(state.replace(/^[^?]*\?/, ''));
        if (p.get('rally')) return p.get('rally');
      }
    } catch (e) { /* URL ではない */ }
    return text;
  }

  async function scanRally() {
    var text;
    if (Auth.can('scanCodeV2')) {
      try {
        var r = await liff.scanCodeV2();
        text = r && r.value;
      } catch (e) {
        UI.toast('QRコードを読み取れませんでした', 'error');
        return;
      }
    } else {
      text = window.prompt('この環境ではカメラで読み取れません。\nQRコードの文字列を入力してください');
    }
    if (text) await run('rallyCheckin', { code: extractRallyCode(text) });
  }

  // ---------------- アンケート / 投票 ----------------

  function renderVote() {
    var answered = app.state.surveys.answered;
    $('#tab-vote').innerHTML = app.config.surveys.map(function (s) {
      var done = answered.indexOf(s.id) >= 0;
      var open = app.openSurveyId === s.id;
      var body = '';
      if (open) {
        if (!done) body = surveyForm(s);
        else if (s.showResults) body = app.results[s.id] ? UI.resultsHtml(app.results[s.id]) : '<p class="muted">集計を読み込み中…</p>';
        else body = '<p class="muted">ご回答ありがとうございました。</p>';
      }
      return '<div class="panel survey' + (open ? ' open' : '') + '">' +
        '<button class="survey-head" data-act="toggle-survey" data-id="' + esc(s.id) + '" aria-expanded="' + open + '">' +
          '<span><span class="survey-kind">' + (s.showResults ? '投票' : 'アンケート') + '</span>' +
          '<span class="survey-title">' + esc(s.title) + '</span></span>' +
          '<span class="pill' + (done ? ' pill-done' : '') + '">' + (done ? '回答済み' : '未回答') + '</span>' +
        '</button>' +
        (open ? '<div class="survey-body">' + (s.description ? '<p class="muted">' + esc(s.description) + '</p>' : '') + body + '</div>' : '') +
      '</div>';
    }).join('') || '<div class="panel"><p class="muted">現在実施中のアンケートはありません</p></div>';
  }

  function surveyForm(s) {
    return '<form data-form="survey" data-id="' + esc(s.id) + '">' + s.questions.map(function (q) {
      var name = 'q_' + esc(q.id);
      var input = q.type === 'text'
        ? '<textarea name="' + name + '" maxlength="500" rows="3" placeholder="自由にご記入ください"></textarea>'
        : q.options.map(function (o) {
          return '<label class="choice"><input type="' + (q.type === 'multi' ? 'checkbox' : 'radio') + '" name="' + name +
            '" value="' + esc(o) + '"><span>' + esc(o) + '</span></label>';
        }).join('');
      return '<fieldset class="q"><legend>' + esc(q.label) +
        (q.required ? '<span class="req">必須</span>' : '') +
        (q.type === 'multi' ? '<span class="hint">複数選択可</span>' : '') +
        '</legend>' + input + '</fieldset>';
    }).join('') +
    '<button class="btn primary block" type="submit">' + (s.showResults ? '投票する' : '送信する') + '</button></form>';
  }

  async function toggleSurvey(id) {
    app.openSurveyId = app.openSurveyId === id ? null : id;
    renderVote();
    var s = app.config.surveys.filter(function (x) { return x.id === id; })[0];
    if (app.openSurveyId && s.showResults && app.state.surveys.answered.indexOf(id) >= 0) {
      var data = await run('surveyResults', { surveyId: id });
      if (data) { app.results[id] = data.results; renderVote(); }
    }
  }

  async function submitSurvey(form) {
    var id = form.dataset.id;
    var s = app.config.surveys.filter(function (x) { return x.id === id; })[0];
    var fd = new FormData(form);
    var answers = {};
    s.questions.forEach(function (q) {
      answers[q.id] = q.type === 'multi' ? fd.getAll('q_' + q.id) : (fd.get('q_' + q.id) || '');
    });
    var data = await run('submitSurvey', { surveyId: id, answers: answers });
    if (data && data.results) { app.results[id] = data.results; renderVote(); }
  }

  // ---------------- 整理券 ----------------

  function renderTicket() {
    var t = app.state.ticket, title = app.config.ticket.title;
    var serving = t.nowServing == null ? '－' : t.nowServing;
    var html;
    if (t.mine) {
      var called = t.mine.status === 'called';
      html = '<div class="panel ticket' + (called ? ' called' : '') + '">' +
        '<div class="panel-head"><h2>' + esc(title) + '</h2></div>' +
        '<div class="ticket-no"><small>あなたの番号</small><b>' + t.mine.no + '</b></div>' +
        '<div class="ticket-status">' + (called
          ? 'お呼び出し中です！<br>受付までお越しください'
          : 'あなたの前に <b>' + t.ahead + '</b> 組お待ちです') + '</div>' +
        '<div class="ticket-meta">現在の呼び出し番号 <b>' + serving + '</b></div>' +
        '<button class="btn ghost block" data-act="cancel-ticket">整理券をキャンセル</button>' +
        '<p class="note center">この画面は自動で更新されます</p>' +
      '</div>';
    } else {
      html = '<div class="panel">' +
        '<div class="panel-head"><h2>' + esc(title) + '</h2></div>' +
        '<div class="stats"><div><small>現在の呼び出し番号</small><b>' + serving + '</b></div>' +
        '<div><small>お待ちの組数</small><b>' + t.waitingCount + '</b></div></div>' +
        (t.open
          ? '<button class="btn primary block" data-act="take-ticket">整理券を発行する</button>'
          : '<p class="muted center">現在、整理券の発行を停止しています</p>') +
      '</div>';
    }
    $('#ticket-panel').innerHTML = html;
  }

  // ---------------- 予約 ----------------

  function renderReserve() {
    var r = app.state.reservation, rc = app.config.reservation;
    var html = '<div class="panel"><div class="panel-head"><h2>' + esc(rc.title) + '</h2></div>';
    if (r.mine) {
      html += '<div class="reserved"><small>ご予約内容</small><b>' + esc(r.mine.slotLabel) + '</b>' +
        '<span>' + r.mine.people + ' 名 ／ 予約番号 ' + esc(r.mine.id) + '</span></div>' +
        '<button class="btn ghost block" data-act="cancel-reservation" data-id="' + esc(r.mine.id) + '">予約をキャンセル</button>';
    } else {
      var opts = '';
      for (var i = 1; i <= rc.maxPeople; i++) opts += '<option value="' + i + '">' + i + ' 名</option>';
      html += '<form data-form="reserve"><div class="slots">' + r.slots.map(function (s) {
        var full = s.remaining <= 0;
        return '<label class="slot' + (full ? ' full' : '') + '"><input type="radio" name="slotId" value="' + esc(s.id) + '"' +
          (full ? ' disabled' : '') + '><span class="slot-label">' + esc(s.label) + '</span>' +
          '<span class="slot-rest">' + (full ? '満席' : '残り ' + s.remaining) + '</span></label>';
      }).join('') + '</div>' +
      '<label class="field"><span>人数</span><select name="people">' + opts + '</select></label>' +
      '<button class="btn primary block" type="submit">予約する</button></form>';
    }
    $('#reserve-panel').innerHTML = html + '</div>';
  }

  // ---------------- 外部ID連携 ----------------

  function renderLink() {
    var m = app.state.member, lc = app.config.extLink;
    var html = '<div class="panel"><div class="panel-head"><h2>' + esc(lc.title) + '</h2>' +
      (m.ext ? '<span class="pill pill-done">連携済み</span>' : '') + '</div>';
    if (m.ext) {
      html += '<div class="reserved"><small>' + esc(lc.idLabel) + '</small><b>' + esc(m.ext.id) + '</b>' +
        (m.ext.name ? '<span>' + esc(m.ext.name) + ' 様</span>' : '') + '</div>' +
        '<button class="btn ghost block" data-act="unlink">連携を解除する</button>';
    } else {
      html += '<p class="muted">' + esc(lc.description) + '</p>' +
        '<form data-form="link" autocomplete="off">' +
          '<label class="field"><span>' + esc(lc.idLabel) + '</span><input name="extId" required maxlength="40"></label>' +
          '<label class="field"><span>' + esc(lc.keyLabel) + '</span><input name="key" required maxlength="40" inputmode="numeric" type="password"></label>' +
          '<button class="btn primary block" type="submit">連携する</button>' +
        '</form>' +
        (Auth.mock ? '<p class="demo-box">デモ用の会員：100001 ／ 19900101</p>' : '');
    }
    $('#tab-link').innerHTML = html + '</div>';
  }

  // ---------------- 自動更新（呼び出し・スタンプ反映） ----------------

  var polling = false;
  async function poll() {
    if (document.hidden || polling || !isReady) return;
    // サーバーの無料枠を節約するため、受付タブ表示中か整理券を持っているときだけ更新する
    if (!(app.tab === 'reception' || app.state.ticket.mine)) return;
    polling = true;
    try {
      var prev = app.state.ticket.mine;
      var data = await Api.call('state', {});
      setState(data.state);
      // 入力フォームを含む画面は書き換えない
      renderCard();
      renderTicket();
      renderRally();
      var now = app.state.ticket.mine;
      if (prev && now && prev.status === 'waiting' && now.status === 'called') {
        UI.toast(now.no + ' 番が呼ばれました！受付へお越しください', 'ok');
        if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
      }
    } catch (e) {
      /* 自動更新の失敗は次回に任せる */
    } finally {
      polling = false;
    }
  }

  // ---------------- イベント ----------------

  document.addEventListener('click', function (ev) {
    var tabBtn = ev.target.closest('.tabbar button');
    if (tabBtn) { switchTab(tabBtn.dataset.tab); poll(); return; }
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    switch (el.dataset.act) {
      case 'reload': location.reload(); break;
      case 'share': share(); break;
      case 'scan-rally': scanRally(); break;
      case 'demo-rally': run('rallyCheckin', { code: el.dataset.code }); break;
      case 'toggle-survey': toggleSurvey(el.dataset.id); break;
      case 'take-ticket': run('takeTicket'); break;
      case 'cancel-ticket':
        if (confirm('整理券をキャンセルしますか？')) run('cancelTicket');
        break;
      case 'cancel-reservation':
        if (confirm('予約をキャンセルしますか？')) run('cancelReservation', { id: el.dataset.id });
        break;
      case 'unlink':
        if (confirm('連携を解除しますか？')) run('unlinkExternal');
        break;
      case 'perm-continue': location.reload(); break;
      case 'perm-retry':
        sessionRemove(PERM_REQUESTED_KEY); // もう一度 LINE の許可画面を出す
        location.reload();
        break;
    }
  });

  document.addEventListener('submit', function (ev) {
    var form = ev.target.closest('[data-form]');
    if (!form) return;
    ev.preventDefault();
    var fd = new FormData(form);
    switch (form.dataset.form) {
      case 'survey': submitSurvey(form); break;
      case 'reserve':
        if (!fd.get('slotId')) { UI.toast('予約枠を選んでください', 'error'); return; }
        run('reserve', { slotId: fd.get('slotId'), people: Number(fd.get('people')) });
        break;
      case 'link': run('linkExternal', { extId: fd.get('extId'), key: fd.get('key') }); break;
    }
  });

  // ---------------- 起動 ----------------

  function showApp() {
    document.title = app.config.appName;
    $('#app-title').textContent = app.config.appName;
    $('.tabbar').hidden = false;
    renderAll();
  }

  /** ?tab=reception などで開くタブを指定（リッチメニューからのリンク用） */
  function initialTab() {
    var params = new URLSearchParams(location.search);
    var saved = null;
    try { saved = sessionStorage.getItem('tab'); } catch (e) { /* ignore */ }
    switchTab(params.get('tab') || saved || 'card');
  }

  /** ?debug=1 のとき、ページ表示開始からの経過時間（ミリ秒）を画面右上に出す */
  function showPerf() {
    if (new URLSearchParams(location.search).get('debug') !== '1') return;
    var lines = Object.keys(Perf.marks).map(function (k) { return k + '  ' + Perf.marks[k] + ' ms'; });
    var box = document.createElement('div');
    box.className = 'perf-box';
    box.textContent = '起動時間（ページ表示開始から）\n' + lines.join('\n');
    box.addEventListener('click', function () { box.remove(); });
    document.body.appendChild(box);
  }

  // ---------------- LINE の権限（アクセス許可要求画面） ----------------
  // チャネル同意の簡略化により、最初はユーザーIDの権限だけで起動する。
  // プロフィール情報（必須）とトークルームへのメッセージ送信の許可を、起動時に LINE の画面で確認する。
  // 許可すると以前の IDトークンは無効になるので、許可後はアプリを読み込み直す。

  var PERMS = ['profile', 'chat_message.write'];
  var PERM_REQUESTED_KEY = 'miniapp_perm_requested';
  var permWaiting = false;

  function sessionGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function sessionSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  function sessionRemove(k) { try { sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }

  /** 必要な権限がそろっていれば true。足りなければ許可画面を出して false */
  async function ensurePermissions() {
    if (!Auth.inClient()) return true; // デモモード・外部ブラウザは LINE ログイン時に同意済み
    var st = await Auth.permissionStates(PERMS);
    var pending = PERMS.filter(function (p) { return st[p] === 'prompt'; });
    if (!pending.length) { sessionRemove(PERM_REQUESTED_KEY); return true; }

    if (!sessionGet(PERM_REQUESTED_KEY)) {
      // この起動ではまだ許可画面を出していない → LINE のアクセス許可要求画面を表示
      sessionSet(PERM_REQUESTED_KEY, '1');
      try {
        await liff.permission.requestAll();
      } catch (e) {
        // すでに許可済み・機能が無効などで表示できない場合は、プロフィールさえ許可されていれば続ける
        if (st.profile !== 'prompt') return true;
      }
      showPermissionGate(true);
      return false;
    }
    // 一度許可画面を出したあと：プロフィールが許可されていれば、メッセージ送信は任意として続ける
    if (st.profile !== 'prompt') return true;
    showPermissionGate(false);
    return false;
  }

  function showPermissionGate(waiting) {
    permWaiting = waiting;
    var list = '<ul class="perm-list">' +
      '<li><b>メインプロフィール情報（必須）</b><span>会員証にLINEの表示名とアイコンを表示します</span></li>' +
      '<li><b>トークルームへのメッセージ送信（任意）</b><span>オフにしてもミニアプリは使えます</span></li></ul>';
    $('#main').innerHTML = '<div class="panel perm">' + (waiting
      ? '<h2>LINEの許可画面を確認してください</h2>' +
        '<p class="muted">LINEのアクセス許可画面で内容を確認し、「許可する」を押してください。許可が終わったら「続ける」を押してください。</p>' +
        list + '<button class="btn primary block" data-act="perm-continue">続ける</button>'
      : '<h2>プロフィール情報の許可が必要です</h2>' +
        '<p class="muted">このミニアプリを使うには、LINEのプロフィール情報の許可が必要です。</p>' +
        list + '<button class="btn primary block" data-act="perm-retry">許可する</button>') +
      '</div>';
    $('.tabbar').hidden = true;
  }

  /** LINE の許可画面から戻ってきたら、許可状況を確かめて読み込み直す */
  async function checkPermissionsAfterReturn() {
    if (!permWaiting || document.hidden) return;
    var st = await Auth.permissionStates(PERMS);
    if (st.profile !== 'prompt') location.reload();
  }

  async function start() {
    // 認証が終わるまでは index.html の骨組みを表示し、ヘッダーのバーで読み込み中を示す
    $('.app-header').classList.add('syncing');

    try {
      var profile = await Auth.init();
      if (!profile) return; // LINE ログイン画面へ移動中
      if (!(await ensurePermissions())) {
        document.addEventListener('visibilitychange', checkPermissionsAfterReturn);
        return; // LINE の許可画面の結果を待つ
      }
      if (Auth.mock) $('#mock-banner').hidden = false;
      if (profile.pictureUrl) { $('#avatar').src = profile.pictureUrl; $('#avatar').hidden = false; }

      // LINE ログインと権限の確認が済んでから、同じ人の前回データだけを即表示する
      var cached = loadCache();
      if (cached && cached.userId === profile.userId) {
        app.config = cached.config;
        app.state = cached.state;
        showApp();
        initialTab();
        Perf.mark('前回データで表示');
      } else {
        cached = null;
      }

      var data = await Api.call('init', {});
      Perf.mark('サーバー応答');
      var changed = !cached ||
        JSON.stringify(cached.config) !== JSON.stringify(data.config) ||
        JSON.stringify(cached.state) !== JSON.stringify(data.state);
      app.config = data.config;
      setState(data.state);
      if (changed) showApp(); // 変化がなければ書き換えない（入力中のフォームを消さない）

      // LIFF のリダイレクト後に ?tab= が付くことがあるので、ここで改めてタブを決める
      var params = new URLSearchParams(location.search);
      if (!cached || params.get('tab')) initialTab();

      isReady = true;
      markReady();
      showPerf();

      // ?rally=コード で開かれたら自動でスタンプ獲得（LINEのカメラでQRを読んだ場合）
      var rally = params.get('rally');
      if (rally) {
        params.delete('rally');
        history.replaceState(null, '', location.pathname + (params.toString() ? '?' + params : ''));
        switchTab('rally');
        UI.busy(false);
        await run('rallyCheckin', { code: rally });
        UI.busy(true);
      }

      setInterval(poll, POLL_MS);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
    } catch (e) {
      showFatal(e.message || String(e), true);
    } finally {
      UI.busy(false);
      $('.app-header').classList.remove('syncing');
    }
  }

  start();
})();
