/** 管理画面（スタッフ用） */
(function () {
  'use strict';
  var cfg = window.APP_CONFIG || {};
  var esc = UI.esc;
  var params = new URLSearchParams(location.search);
  var REFRESH_MS = 10000;
  var STATUS_LABEL = { waiting: '待機中', called: '呼出中', done: '完了', skipped: '不在' };

  // 管理画面は LIFF を使わない。API_URL 未設定か ?mock=1 ならデモモード
  Auth.mock = !cfg.API_URL || params.get('mock') === '1';

  var current = 'tickets';
  var memberNo = null;
  var scanner = null;

  function $(sel) { return document.querySelector(sel); }
  function panel(name) { return document.querySelector('.admin-panel[data-panel="' + name + '"]'); }

  async function run(action, payload) {
    UI.busy(true);
    try {
      var data = await Api.call(action, payload);
      if (data.message) UI.toast(data.message, 'ok');
      return data;
    } catch (e) {
      UI.toast(e.message, 'error');
      if (/管理キー|管理者/.test(e.message)) logout();
      return null;
    } finally {
      UI.busy(false);
    }
  }

  // ---------------- ログイン ----------------

  async function login(key, silent) {
    Api.adminKey = key;
    var data = silent ? await Api.call('adminPing').catch(function () { return null; }) : await run('adminPing');
    if (!data) { Api.adminKey = null; return; }
    try { sessionStorage.setItem('adminKey', key); } catch (e) { /* ignore */ }
    $('#app-title').textContent = data.appName + ' 管理画面';
    $('#login').hidden = true;
    $('#admin').hidden = false;
    $('#logout').hidden = false;
    show(current);
  }

  function logout() {
    Api.adminKey = null;
    try { sessionStorage.removeItem('adminKey'); } catch (e) { /* ignore */ }
    stopScanner();
    $('#login').hidden = false;
    $('#admin').hidden = true;
    $('#logout').hidden = true;
  }

  function show(name) {
    current = name;
    document.querySelectorAll('.admin-tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.panel === name); });
    document.querySelectorAll('.admin-panel').forEach(function (p) { p.hidden = p.dataset.panel !== name; });
    if (name !== 'stamps') stopScanner();
    load(name);
  }

  function load(name) {
    if (name === 'tickets') return loadTickets();
    if (name === 'surveys') return loadSurveys();
    if (name === 'reservations') return loadReservations();
    if (name === 'rally') return loadRally();
    if (name === 'guide') return renderGuide();
    if (name === 'master') return loadMaster();
  }

  // ---------------- 会員マスタ（外部ID連携） ----------------

  async function loadMaster() {
    var data = await run('adminExtMasterInfo');
    if (data) $('#master-count').textContent = data.count + ' 件';
  }

  /** 「会員番号,確認キー,氏名」の行を読み取る（タブ区切り・ダブルクォートにも対応） */
  function parseMasterCsv(textValue) {
    var rows = [];
    String(textValue || '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var cells = line.split(line.indexOf('\t') >= 0 ? '\t' : ',').map(function (c) {
        return c.trim().replace(/^"(.*)"$/, '$1').replace(/""/g, '"');
      });
      rows.push({ extId: cells[0] || '', key: cells[1] || '', name: cells.slice(2).join(',') });
    });
    // 1行目が見出し（数字や英数字のIDでない）なら読み飛ばす
    if (rows.length && /会員|extId|番号|ID/i.test(rows[0].extId) && /キー|key|生年月日/i.test(rows[0].key)) rows.shift();
    return rows;
  }

  async function importMaster(form) {
    var rows = parseMasterCsv(form.csv.value);
    if (!rows.length) { UI.toast('登録するデータを貼り付けてください', 'error'); return; }
    if (!confirm(rows.length + ' 件を登録します。よろしいですか？')) return;
    var data = await run('adminExtMasterImport', { rows: rows });
    if (data) {
      form.csv.value = '';
      $('#master-count').textContent = data.count + ' 件';
    }
  }

  // ---------------- 呼び出し ----------------

  async function loadTickets(quiet) {
    var data = quiet ? await Api.call('adminTickets').catch(function () { return null; }) : await run('adminTickets');
    if (data) renderTickets(data);
  }

  function renderTickets(d) {
    var rows = d.tickets.map(function (t) {
      var acts = '';
      if (t.status === 'waiting') acts = btn('call', t.no, '呼ぶ', 'primary') + btn('skipped', t.no, '不在');
      else if (t.status === 'called') acts = btn('done', t.no, '完了', 'primary') + btn('call', t.no, '再呼出') + btn('skipped', t.no, '不在');
      else if (t.status === 'skipped') acts = btn('call', t.no, '呼ぶ') + btn('waiting', t.no, '待機に戻す');
      return '<tr class="st-' + t.status + '"><td class="no">' + t.no + '</td>' +
        '<td>' + esc(t.displayName || '－') + '<small>' + esc(t.memberNo) + ' ／ ' + UI.formatTime(t.createdAt) + '発行</small></td>' +
        '<td><span class="status">' + (STATUS_LABEL[t.status] || t.status) + '</span></td>' +
        '<td class="acts">' + acts + '</td></tr>';
    }).join('');
    panel('tickets').innerHTML =
      '<div class="panel">' +
        '<div class="stats"><div><small>現在の呼び出し番号</small><b>' + (d.nowServing == null ? '－' : d.nowServing) + '</b></div>' +
        '<div><small>お待ちの組数</small><b>' + d.waitingCount + '</b></div></div>' +
        '<button class="btn primary block big" data-act="call-next"' + (d.waitingCount ? '' : ' disabled') + '>次の番号を呼ぶ</button>' +
        (d.open ? '' : '<p class="muted center">整理券の新規発行は停止中です（設定 ticket.open）</p>') +
      '</div>' +
      '<div class="panel"><div class="panel-head"><h2>本日の整理券（' + esc(d.date) + '）</h2>' +
        '<button class="btn small ghost" data-act="refresh">更新</button></div>' +
        (rows ? '<div class="table-wrap"><table class="table"><thead><tr><th>番号</th><th>お名前</th><th>状態</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
          : '<p class="muted">まだ整理券は発行されていません</p>') +
      '</div>';
  }

  function btn(act, no, label, kind) {
    return '<button class="btn small ' + (kind || 'ghost') + '" data-act="ticket" data-op="' + act + '" data-no="' + no + '">' + label + '</button>';
  }

  async function ticketOp(op, no) {
    var data = op === 'call' ? await run('adminCall', { no: no }) : await run('adminSetTicketStatus', { no: no, status: op });
    if (data) renderTickets(data);
  }

  // ---------------- スタンプ ----------------

  async function findMember(no) {
    var data = await run('adminMember', { memberNo: no });
    if (data) { memberNo = data.member.memberNo; renderMember(data.member); }
  }

  function renderMember(m) {
    $('#member-result').innerHTML =
      '<div class="panel member-admin">' +
        '<div class="panel-head"><h2>' + esc(m.displayName || '（名前なし）') + ' 様</h2><span class="pill">' + esc(UI.formatMemberNo(m.memberNo)) + '</span></div>' +
        '<div class="stats"><div><small>今のカード</small><b>' + m.current + ' / ' + m.goal + '</b></div>' +
        '<div><small>累計スタンプ</small><b>' + m.stamps + '</b></div>' +
        '<div><small>使える特典</small><b>' + m.rewardsAvailable + '</b></div></div>' +
        (m.ext ? '<p class="muted">外部ID連携：' + esc(m.ext.id) + (m.ext.name ? '（' + esc(m.ext.name) + '）' : '') + '</p>' : '') +
        '<div class="btn-row">' +
          [1, 2, 3].map(function (n) { return '<button class="btn primary" data-act="stamp" data-count="' + n + '">＋' + n + '</button>'; }).join('') +
        '</div>' +
        '<button class="btn block warn" data-act="use-reward"' + (m.rewardsAvailable ? '' : ' disabled') + '>特典を1回使用する</button>' +
      '</div>';
  }

  async function memberOp(action, payload, button) {
    button.disabled = true; // 二重押し防止
    var data = await run(action, Object.assign({ memberNo: memberNo }, payload));
    if (data) renderMember(data.member); else button.disabled = false;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function startScanner() {
    try {
      if (typeof Html5Qrcode === 'undefined') await loadScript('https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js');
      $('#reader').hidden = false;
      scanner = new Html5Qrcode('reader');
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: 220 }, function (text) {
        stopScanner();
        $('#member-form').memberNo.value = text;
        findMember(text);
      });
    } catch (e) {
      stopScanner();
      UI.toast('カメラを起動できませんでした。会員番号を手入力してください', 'error');
    }
  }

  function stopScanner() {
    if (scanner) {
      var s = scanner;
      scanner = null;
      s.stop().catch(function () {}).then(function () { s.clear(); });
    }
    var r = $('#reader');
    if (r) r.hidden = true;
  }

  // ---------------- 集計 ----------------

  async function loadSurveys() {
    var data = await run('adminSurveyResults');
    if (!data) return;
    panel('surveys').innerHTML = data.surveys.map(function (s) {
      return '<div class="panel"><div class="panel-head"><h2>' + esc(s.title) + '</h2>' +
        '<button class="btn small ghost" data-act="refresh">更新</button></div>' + UI.resultsHtml(s, { showTexts: true }) + '</div>';
    }).join('') || '<div class="panel"><p class="muted">アンケートが設定されていません</p></div>';
  }

  // ---------------- 予約 ----------------

  async function loadReservations() {
    var data = await run('adminReservations');
    if (!data) return;
    panel('reservations').innerHTML = data.slots.map(function (s) {
      var used = s.capacity - s.remaining;
      var list = s.reservations.map(function (r) {
        return '<tr><td>' + esc(r.displayName || '－') + '<small>' + esc(r.memberNo) + '</small></td><td>' + r.people + ' 名</td><td><small>' + esc(r.id) + '</small></td></tr>';
      }).join('');
      return '<div class="panel"><div class="panel-head"><h2>' + esc(s.label) + '</h2><span class="pill">' + used + ' / ' + s.capacity + ' 名</span></div>' +
        (list ? '<div class="table-wrap"><table class="table"><thead><tr><th>お名前</th><th>人数</th><th>予約番号</th></tr></thead><tbody>' + list + '</tbody></table></div>'
          : '<p class="muted">予約はまだありません</p>') + '</div>';
    }).join('');
  }

  // ---------------- ラリーQR ----------------

  function rallyUrl(code) {
    // LINE の通常カメラで読んでもミニアプリが開き、自動でスタンプが付く URL
    return cfg.LIFF_ID ? 'https://miniapp.line.me/' + cfg.LIFF_ID + '?rally=' + encodeURIComponent(code) : code;
  }

  async function loadRally() {
    var data = await run('adminRallyCodes');
    if (!data) return;
    var p = panel('rally');
    p.innerHTML =
      '<div class="panel no-print"><div class="panel-head"><h2>スタンプラリー</h2><span class="pill">コンプリート ' + data.completedCount + ' 人</span></div>' +
        '<p class="muted">各スポットに掲示するQRコードです。印刷して設置してください。' +
        (cfg.LIFF_ID ? '' : '<br>※ LIFF ID 未設定のためコード文字列のみのQRです（本番では LIFF ID 設定後に印刷してください）') + '</p>' +
        '<button class="btn primary block" data-act="print">印刷する</button></div>' +
      '<div class="qr-sheet">' + data.checkpoints.map(function (c) {
        return '<div class="qr-card"><h3>' + esc(c.name) + '</h3><div class="qr-box" data-code="' + esc(c.code) + '"></div>' +
          '<p>LINEのカメラで読み取ってスタンプをゲット！</p><small>' + esc(c.code) + '</small></div>';
      }).join('') + '</div>';
    p.querySelectorAll('.qr-box').forEach(function (el) { UI.qr(el, rallyUrl(el.dataset.code), 180); });
  }

  // ---------------- 案内QR（公式アカウントを使わない集客用） ----------------

  var GUIDE_TARGETS = [
    { tab: '', title: 'ミニアプリを開く', text: 'LINEのカメラで読み取ってください' },
    { tab: 'card', title: '会員証・スタンプカード', text: '会員証を表示してスタンプを集めよう' },
    { tab: 'reception', title: '受付・整理券', text: '整理券の発行・予約はこちら' },
    { tab: 'vote', title: '投票・アンケート', text: 'あなたの声を聞かせてください' },
    { tab: 'rally', title: 'スタンプラリー', text: '会場のQRを集めて特典をゲット' }
  ];

  function appUrl(tab) {
    if (!cfg.LIFF_ID) return '';
    return 'https://miniapp.line.me/' + cfg.LIFF_ID + (tab ? '?tab=' + tab : '');
  }

  function renderGuide() {
    var p = panel('guide');
    if (!cfg.LIFF_ID) {
      p.innerHTML = '<div class="panel"><p class="muted">js/config.js に LIFF_ID を設定すると、案内用のQRコードを作成できます。</p></div>';
      return;
    }
    p.innerHTML =
      '<div class="panel no-print"><h2>案内用QRコード</h2>' +
        '<p class="muted">ポスター・チラシ・受付などに掲示してください。URLはLINEグループ、メール、Webサイト、SNSにも貼れます。<br>' +
        '※ 開発中のチャネルでは、権限のあるLINEアカウントしか開けません。一般公開後、本番用のLIFF IDに切り替えてから印刷してください。</p>' +
        '<button class="btn primary block" data-act="print">印刷する</button></div>' +
      '<div class="qr-sheet">' + GUIDE_TARGETS.map(function (g) {
        var url = appUrl(g.tab);
        return '<div class="qr-card"><h3>' + esc(g.title) + '</h3><div class="qr-box" data-url="' + esc(url) + '"></div>' +
          '<p>' + esc(g.text) + '</p><small>' + esc(url) + '</small>' +
          '<button class="btn small ghost block no-print" data-act="copy-url" data-url="' + esc(url) + '">URLをコピー</button></div>';
      }).join('') + '</div>';
    p.querySelectorAll('.qr-box').forEach(function (el) { UI.qr(el, el.dataset.url, 180); });
  }

  async function copyUrl(url) {
    try {
      await navigator.clipboard.writeText(url);
      UI.toast('URLをコピーしました', 'ok');
    } catch (e) {
      window.prompt('このURLをコピーしてください', url);
    }
  }

  // ---------------- イベント ----------------

  document.addEventListener('click', function (ev) {
    var tab = ev.target.closest('.admin-tabs button');
    if (tab) { show(tab.dataset.panel); return; }
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    switch (el.dataset.act) {
      case 'refresh': load(current); break;
      case 'call-next':
        run('adminCallNext').then(function (d) { if (d) renderTickets(d); });
        break;
      case 'ticket': ticketOp(el.dataset.op, Number(el.dataset.no)); break;
      case 'scan-member': scanner ? stopScanner() : startScanner(); break;
      case 'stamp': memberOp('adminAddStamp', { count: Number(el.dataset.count) }, el); break;
      case 'use-reward':
        if (confirm('特典を1回使用済みにしますか？')) memberOp('adminUseReward', {}, el);
        break;
      case 'print': window.print(); break;
      case 'copy-url': copyUrl(el.dataset.url); break;
    }
  });

  $('#login-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    login(ev.target.key.value);
  });
  $('#master-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    importMaster(ev.target);
  });
  $('#member-form').addEventListener('submit', function (ev) {
    ev.preventDefault();
    findMember(ev.target.memberNo.value);
  });
  $('#logout').addEventListener('click', logout);

  // 呼び出しタブを開いている間は自動更新
  setInterval(function () {
    if (Api.adminKey && current === 'tickets' && !document.hidden) loadTickets(true);
  }, REFRESH_MS);

  if (Auth.mock) { $('#mock-banner').hidden = false; $('#login-hint').hidden = false; }
  var saved = null;
  try { saved = sessionStorage.getItem('adminKey'); } catch (e) { /* ignore */ }
  if (saved) login(saved, true);
})();
