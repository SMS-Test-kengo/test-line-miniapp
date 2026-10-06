/**
 * 業務ロジック（Google Apps Script とブラウザのデモモードの両方で動きます）
 *
 * 本番では GAS に「core.gs」としてこのファイルをそのまま貼り付けてください。
 * 保存先（スプレッドシート / localStorage）の違いは env.db が吸収します。
 * 値はすべて文字列で保存されるため、読み出し時に str() / num() で揃えます。
 */
var CORE_TABLES = {
  users: ['userId', 'memberNo', 'displayName', 'stamps', 'rewardsUsed', 'extId', 'createdAt'],
  stamp_log: ['memberNo', 'kind', 'delta', 'at'],
  rally: ['userId', 'checkpointId', 'at'],
  answers: ['userId', 'surveyId', 'answers', 'at'],
  tickets: ['date', 'no', 'userId', 'status', 'createdAt', 'calledAt'],
  reservations: ['id', 'userId', 'slotId', 'people', 'status', 'createdAt'],
  ext_master: ['extId', 'key', 'name']
};

// データを書き換えない操作（GAS ではこれ以外の操作を排他ロック付きで実行します）
var CORE_READONLY_ACTIONS = ['state', 'surveyResults', 'adminPing', 'adminTickets', 'adminMember',
  'adminSurveyResults', 'adminReservations', 'adminRallyCodes'];

var EXT_LINK_MAX_FAILS = 5;
var EXT_LINK_LOCK_SECONDS = 600;

/**
 * @param env {db, settings, now(), today(), randomDigits(n), cache{get,put}, notify(userId,text), log(e)}
 */
function createCore(env) {
  var S = env.settings;
  var db = env.db;

  function fail(message) { var e = new Error(message); e.isUserError = true; return e; }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function find(list, fn) { for (var i = 0; i < list.length; i++) if (fn(list[i])) return list[i]; return null; }
  function nowIso() { return env.now().toISOString(); }
  function normalizeMemberNo(v) { return str(v).toUpperCase().replace(/[\s-]/g, ''); }

  // ---------------- 会員 ----------------
  function findUser(userId) {
    return find(db.rows('users'), function (u) { return str(u.userId) === userId; });
  }
  function findUserByMemberNo(memberNo) {
    var no = normalizeMemberNo(memberNo);
    return no ? find(db.rows('users'), function (u) { return str(u.memberNo) === no; }) : null;
  }
  function requireUser(ctx) {
    var u = findUser(ctx.userId);
    if (!u) throw fail('会員情報が見つかりません。アプリを開き直してください。');
    return u;
  }
  function ensureUser(ctx) {
    var u = findUser(ctx.userId);
    if (!u) {
      var memberNo;
      do { memberNo = 'M' + env.randomDigits(8); } while (findUserByMemberNo(memberNo));
      db.insert('users', {
        userId: ctx.userId, memberNo: memberNo, displayName: ctx.displayName || '',
        stamps: 0, rewardsUsed: 0, extId: '', createdAt: nowIso()
      });
      u = findUser(ctx.userId);
    } else if (ctx.displayName && str(u.displayName) !== ctx.displayName) {
      db.update('users', u, { displayName: ctx.displayName });
    }
    return u;
  }
  function memberView(u) {
    var goal = num(S.stampCard.goal) || 10;
    var stamps = num(u.stamps);
    var earned = Math.floor(stamps / goal);
    var ext = null;
    if (str(u.extId)) {
      var m = find(db.rows('ext_master'), function (r) { return str(r.extId) === str(u.extId); });
      ext = { id: str(u.extId), name: m ? str(m.name) : '' };
    }
    return {
      memberNo: str(u.memberNo), displayName: str(u.displayName),
      stamps: stamps, goal: goal, current: stamps % goal,
      rewardsEarned: earned, rewardsAvailable: Math.max(0, earned - num(u.rewardsUsed)),
      ext: ext
    };
  }

  // ---------------- スタンプラリー ----------------
  function rallyView(userId) {
    var done = db.rows('rally')
      .filter(function (r) { return str(r.userId) === userId; })
      .map(function (r) { return str(r.checkpointId); });
    var total = S.rally.checkpoints.length;
    var count = S.rally.checkpoints.filter(function (c) { return done.indexOf(c.id) >= 0; }).length;
    return { done: done, completed: total > 0 && count === total };
  }

  // ---------------- 整理券 ----------------
  function todayTickets() {
    var d = env.today();
    return db.rows('tickets').filter(function (t) { return str(t.date) === d; });
  }
  function isActiveTicket(t) { var s = str(t.status); return s === 'waiting' || s === 'called'; }
  function nowServing(list) {
    var latest = null;
    list.forEach(function (t) { if (str(t.calledAt) && (!latest || str(t.calledAt) > str(latest.calledAt))) latest = t; });
    return latest ? num(latest.no) : null;
  }
  function ticketView(userId) {
    var list = todayTickets();
    var mine = find(list, function (t) { return str(t.userId) === userId && isActiveTicket(t); });
    var waiting = list.filter(function (t) { return str(t.status) === 'waiting'; });
    var ahead = 0;
    if (mine && str(mine.status) === 'waiting') {
      ahead = waiting.filter(function (t) { return num(t.no) < num(mine.no); }).length;
    }
    return {
      open: !!S.ticket.open,
      mine: mine ? { no: num(mine.no), status: str(mine.status) } : null,
      nowServing: nowServing(list),
      waitingCount: waiting.length,
      ahead: ahead
    };
  }
  function findSlot(slotId) { return find(S.reservation.slots, function (s) { return s.id === slotId; }); }

  // ---------------- 予約 ----------------
  function activeReservations() {
    return db.rows('reservations').filter(function (r) { return str(r.status) === 'reserved'; });
  }
  function slotsView() {
    var res = activeReservations();
    return S.reservation.slots.map(function (s) {
      var used = res.filter(function (r) { return str(r.slotId) === s.id; })
        .reduce(function (a, r) { return a + num(r.people); }, 0);
      return { id: s.id, label: s.label, capacity: s.capacity, remaining: Math.max(0, s.capacity - used) };
    });
  }
  function myReservationRow(userId) {
    return find(activeReservations(), function (r) { return str(r.userId) === userId; });
  }
  function reservationView(userId) {
    var r = myReservationRow(userId);
    var mine = null;
    if (r) {
      var slot = findSlot(str(r.slotId));
      mine = { id: str(r.id), slotId: str(r.slotId), slotLabel: slot ? slot.label : str(r.slotId), people: num(r.people) };
    }
    return { mine: mine, slots: slotsView() };
  }

  // ---------------- アンケート / 投票 ----------------
  function findSurvey(id) {
    var s = find(S.surveys, function (x) { return x.id === id; });
    if (!s) throw fail('アンケートが見つかりません');
    return s;
  }
  function hasAnswered(userId, surveyId) {
    return !!find(db.rows('answers'), function (a) { return str(a.userId) === userId && str(a.surveyId) === surveyId; });
  }
  function validateAnswers(survey, answers) {
    if (!answers || typeof answers !== 'object') throw fail('回答の形式が正しくありません');
    var out = {};
    survey.questions.forEach(function (q) {
      var v = answers[q.id];
      if (q.type === 'single') {
        v = str(v);
        if (v && q.options.indexOf(v) < 0) throw fail('「' + q.label + '」の選択肢が正しくありません');
      } else if (q.type === 'multi') {
        v = (Array.isArray(v) ? v : []).map(str).filter(function (x, i, arr) {
          return q.options.indexOf(x) >= 0 && arr.indexOf(x) === i;
        });
      } else {
        v = str(v).slice(0, 500);
      }
      if (q.required && (!v || v.length === 0)) throw fail('「' + q.label + '」は必須です');
      out[q.id] = v;
    });
    return out;
  }
  function surveyResults(survey, includeTexts) {
    var parsed = db.rows('answers')
      .filter(function (a) { return str(a.surveyId) === survey.id; })
      .map(function (a) { try { return JSON.parse(str(a.answers)) || {}; } catch (e) { return {}; } });
    return {
      id: survey.id, title: survey.title, total: parsed.length,
      questions: survey.questions.map(function (q) {
        if (q.type === 'text') {
          return { id: q.id, label: q.label, type: q.type,
            texts: includeTexts ? parsed.map(function (p) { return str(p[q.id]); }).filter(Boolean).slice(-200) : [] };
        }
        return { id: q.id, label: q.label, type: q.type,
          counts: q.options.map(function (o) {
            return { option: o, count: parsed.filter(function (p) {
              return q.type === 'multi' ? (p[q.id] || []).indexOf(o) >= 0 : p[q.id] === o;
            }).length };
          }) };
      })
    };
  }

  // ---------------- 公開設定・状態 ----------------
  function publicConfig() {
    return {
      appName: S.appName,
      stampCard: { goal: S.stampCard.goal, rewardName: S.stampCard.rewardName, rewardNote: S.stampCard.rewardNote },
      rally: { title: S.rally.title, rewardName: S.rally.rewardName,
        checkpoints: S.rally.checkpoints.map(function (c) { return { id: c.id, name: c.name, hint: c.hint }; }) },
      surveys: S.surveys,
      ticket: { title: S.ticket.title },
      reservation: { title: S.reservation.title, maxPeople: S.reservation.maxPeople },
      extLink: S.extLink
    };
  }
  function stateFor(u) {
    var uid = str(u.userId);
    return {
      member: memberView(u),
      rally: rallyView(uid),
      surveys: { answered: db.rows('answers').filter(function (a) { return str(a.userId) === uid; })
        .map(function (a) { return str(a.surveyId); }) },
      ticket: ticketView(uid),
      reservation: reservationView(uid)
    };
  }

  // ================= 利用者向け操作 =================
  var userActions = {
    init: function (p, ctx) {
      var u = ensureUser(ctx);
      return { config: publicConfig(), state: stateFor(u) };
    },

    state: function (p, ctx) {
      return { state: stateFor(requireUser(ctx)) };
    },

    rallyCheckin: function (p, ctx) {
      var u = requireUser(ctx);
      var code = str(p.code);
      var cp = code ? find(S.rally.checkpoints, function (c) { return c.code === code; }) : null;
      if (!cp) throw fail('このQRコードはスタンプラリーのものではありません');
      var already = find(db.rows('rally'), function (r) {
        return str(r.userId) === ctx.userId && str(r.checkpointId) === cp.id;
      });
      if (!already) db.insert('rally', { userId: ctx.userId, checkpointId: cp.id, at: nowIso() });
      var state = stateFor(u);
      var message = already ? '「' + cp.name + '」のスタンプは獲得済みです'
        : state.rally.completed ? 'コンプリート！「' + S.rally.rewardName + '」と交換できます'
          : '「' + cp.name + '」のスタンプを獲得しました！';
      return { state: state, message: message };
    },

    submitSurvey: function (p, ctx) {
      var u = requireUser(ctx);
      var survey = findSurvey(str(p.surveyId));
      if (hasAnswered(ctx.userId, survey.id)) throw fail('このアンケートには回答済みです');
      var clean = validateAnswers(survey, p.answers);
      db.insert('answers', { userId: ctx.userId, surveyId: survey.id, answers: JSON.stringify(clean), at: nowIso() });
      return {
        state: stateFor(u),
        message: survey.showResults ? '投票しました！' : 'ご回答ありがとうございました',
        results: survey.showResults ? surveyResults(survey, false) : null
      };
    },

    surveyResults: function (p, ctx) {
      requireUser(ctx);
      var survey = findSurvey(str(p.surveyId));
      if (!survey.showResults) throw fail('このアンケートの結果は公開されていません');
      if (!hasAnswered(ctx.userId, survey.id)) throw fail('回答すると結果を見られます');
      return { results: surveyResults(survey, false) };
    },

    takeTicket: function (p, ctx) {
      var u = requireUser(ctx);
      if (!S.ticket.open) throw fail('現在、整理券の発行を停止しています');
      if (ticketView(ctx.userId).mine) throw fail('すでに整理券を発行済みです');
      var no = todayTickets().reduce(function (m, t) { return Math.max(m, num(t.no)); }, 0) + 1;
      db.insert('tickets', { date: env.today(), no: no, userId: ctx.userId, status: 'waiting', createdAt: nowIso(), calledAt: '' });
      return { state: stateFor(u), message: '整理券 ' + no + ' 番を発行しました' };
    },

    cancelTicket: function (p, ctx) {
      var u = requireUser(ctx);
      var t = find(todayTickets(), function (x) { return str(x.userId) === ctx.userId && isActiveTicket(x); });
      if (!t) throw fail('キャンセルできる整理券がありません');
      db.update('tickets', t, { status: 'cancelled' });
      return { state: stateFor(u), message: '整理券をキャンセルしました' };
    },

    reserve: function (p, ctx) {
      var u = requireUser(ctx);
      var slot = findSlot(str(p.slotId));
      if (!slot) throw fail('予約枠を選んでください');
      var people = Math.floor(num(p.people));
      if (people < 1 || people > S.reservation.maxPeople) throw fail('人数は1〜' + S.reservation.maxPeople + '名で選んでください');
      if (myReservationRow(ctx.userId)) throw fail('予約は1件までです。変更する場合はキャンセルしてから予約し直してください');
      var remaining = find(slotsView(), function (s) { return s.id === slot.id; }).remaining;
      if (remaining < people) throw fail('申し訳ありません。この枠の残りは' + remaining + '名分です');
      db.insert('reservations', { id: 'R' + env.randomDigits(10), userId: ctx.userId, slotId: slot.id,
        people: people, status: 'reserved', createdAt: nowIso() });
      return { state: stateFor(u), message: slot.label + ' で予約しました' };
    },

    cancelReservation: function (p, ctx) {
      var u = requireUser(ctx);
      var r = find(activeReservations(), function (x) { return str(x.id) === str(p.id) && str(x.userId) === ctx.userId; });
      if (!r) throw fail('予約が見つかりません');
      db.update('reservations', r, { status: 'cancelled' });
      return { state: stateFor(u), message: '予約をキャンセルしました' };
    },

    linkExternal: function (p, ctx) {
      var u = requireUser(ctx);
      if (str(u.extId)) throw fail('すでに連携済みです');
      var failKey = 'extfail_' + ctx.userId;
      var fails = num(env.cache.get(failKey));
      if (fails >= EXT_LINK_MAX_FAILS) throw fail('入力の誤りが続いたため、10分ほど時間をおいてからお試しください');
      var extId = str(p.extId), key = str(p.key);
      if (!extId || !key) throw fail(S.extLink.idLabel + 'と' + S.extLink.keyLabel.replace(/（.*$/, '') + 'を入力してください');
      var master = find(db.rows('ext_master'), function (r) { return str(r.extId) === extId && str(r.key) === key; });
      if (!master) {
        env.cache.put(failKey, fails + 1, EXT_LINK_LOCK_SECONDS);
        throw fail('入力内容が会員情報と一致しません');
      }
      var other = find(db.rows('users'), function (x) { return str(x.extId) === extId && str(x.userId) !== ctx.userId; });
      if (other) throw fail('この' + S.extLink.idLabel + 'はすでに別のLINEアカウントと連携されています');
      db.update('users', u, { extId: extId });
      return { state: stateFor(u), message: '連携が完了しました' };
    },

    unlinkExternal: function (p, ctx) {
      var u = requireUser(ctx);
      if (!str(u.extId)) throw fail('連携されていません');
      db.update('users', u, { extId: '' });
      return { state: stateFor(u), message: '連携を解除しました' };
    }
  };

  // ================= 管理者向け操作 =================
  function userMap() {
    var map = {};
    db.rows('users').forEach(function (u) { map[str(u.userId)] = u; });
    return map;
  }
  function adminTicketList() {
    var users = userMap();
    var list = todayTickets().filter(function (t) { return str(t.status) !== 'cancelled'; })
      .sort(function (a, b) { return num(a.no) - num(b.no); });
    return {
      date: env.today(), open: !!S.ticket.open, nowServing: nowServing(list),
      waitingCount: list.filter(function (t) { return str(t.status) === 'waiting'; }).length,
      tickets: list.map(function (t) {
        var u = users[str(t.userId)];
        return { no: num(t.no), status: str(t.status), displayName: u ? str(u.displayName) : '',
          memberNo: u ? str(u.memberNo) : '', createdAt: str(t.createdAt), calledAt: str(t.calledAt) };
      })
    };
  }
  function findTodayTicket(no) {
    var t = find(todayTickets(), function (x) { return num(x.no) === Math.floor(num(no)) && str(x.status) !== 'cancelled'; });
    if (!t) throw fail(no + ' 番の整理券が見つかりません');
    return t;
  }
  function callTicket(t) {
    db.update('tickets', t, { status: 'called', calledAt: nowIso() });
    env.notify(str(t.userId), String(S.ticket.callMessage).replace('{no}', num(t.no)));
    var res = adminTicketList();
    res.message = num(t.no) + ' 番を呼び出しました';
    return res;
  }
  function requireMember(memberNo) {
    var u = findUserByMemberNo(memberNo);
    if (!u) throw fail('会員番号 ' + str(memberNo) + ' が見つかりません');
    return u;
  }

  var adminActions = {
    adminPing: function () { return { appName: S.appName }; },

    adminTickets: function () { return adminTicketList(); },

    adminCallNext: function () {
      var next = todayTickets().filter(function (t) { return str(t.status) === 'waiting'; })
        .sort(function (a, b) { return num(a.no) - num(b.no); })[0];
      if (!next) throw fail('お待ちの方はいません');
      return callTicket(next);
    },

    adminCall: function (p) { return callTicket(findTodayTicket(p.no)); },

    adminSetTicketStatus: function (p) {
      var status = str(p.status);
      if (['done', 'skipped', 'waiting'].indexOf(status) < 0) throw fail('状態が正しくありません');
      db.update('tickets', findTodayTicket(p.no), { status: status });
      return adminTicketList();
    },

    adminMember: function (p) { return { member: memberView(requireMember(p.memberNo)) }; },

    adminAddStamp: function (p) {
      var u = requireMember(p.memberNo);
      var count = Math.floor(num(p.count));
      if (count < 1 || count > 20) throw fail('スタンプ数は1〜20で指定してください');
      db.update('users', u, { stamps: num(u.stamps) + count });
      db.insert('stamp_log', { memberNo: str(u.memberNo), kind: 'stamp', delta: count, at: nowIso() });
      return { member: memberView(u), message: 'スタンプを ' + count + ' 個押しました' };
    },

    adminUseReward: function (p) {
      var u = requireMember(p.memberNo);
      if (memberView(u).rewardsAvailable < 1) throw fail('使える特典がありません');
      db.update('users', u, { rewardsUsed: num(u.rewardsUsed) + 1 });
      db.insert('stamp_log', { memberNo: str(u.memberNo), kind: 'reward', delta: 1, at: nowIso() });
      return { member: memberView(u), message: '特典を1回使用しました' };
    },

    adminSurveyResults: function () {
      return { surveys: S.surveys.map(function (s) { return surveyResults(s, true); }) };
    },

    adminReservations: function () {
      var users = userMap();
      var res = activeReservations();
      return { slots: slotsView().map(function (s) {
        return Object.assign({}, s, { reservations: res.filter(function (r) { return str(r.slotId) === s.id; })
          .map(function (r) {
            var u = users[str(r.userId)];
            return { id: str(r.id), people: num(r.people), displayName: u ? str(u.displayName) : '',
              memberNo: u ? str(u.memberNo) : '', createdAt: str(r.createdAt) };
          }) });
      }) };
    },

    adminRallyCodes: function () {
      var completed = db.rows('users').filter(function (u) { return rallyView(str(u.userId)).completed; }).length;
      return { rewardName: S.rally.rewardName, completedCount: completed,
        checkpoints: S.rally.checkpoints.map(function (c) { return { id: c.id, name: c.name, hint: c.hint, code: c.code }; }) };
    }
  };

  function handle(action, payload, ctx) {
    try {
      action = str(action); payload = payload || {}; ctx = ctx || {};
      var table = action.indexOf('admin') === 0 ? adminActions : userActions;
      if (table === adminActions && !ctx.isAdmin) throw fail('管理者としてログインしてください');
      if (table === userActions && !ctx.userId) throw fail('ログインが必要です');
      if (!Object.prototype.hasOwnProperty.call(table, action)) throw fail('不明な操作です: ' + action);
      return { ok: true, data: table[action](payload, ctx) };
    } catch (e) {
      if (e && e.isUserError) return { ok: false, error: e.message };
      if (env.log) env.log(e);
      return { ok: false, error: 'サーバーでエラーが発生しました。時間をおいてお試しください' };
    }
  }

  return { handle: handle };
}
