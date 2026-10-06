/** 利用者画面・管理画面で共通の小さな UI 部品 */
var UI = (function () {
  'use strict';
  var toastTimer = null;
  var busyCount = 0;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function toast(message, kind) {
    var el = document.getElementById('toast');
    el.textContent = message;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3500);
  }

  function busy(on) {
    busyCount = Math.max(0, busyCount + (on ? 1 : -1));
    document.getElementById('loading').classList.toggle('show', busyCount > 0);
  }

  /** M12345678 → M1234 5678 */
  function formatMemberNo(no) {
    return String(no || '').replace(/^(M\d{4})(\d{4})$/, '$1 $2');
  }

  function formatTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }

  /** 投票・アンケートの集計結果 */
  function resultsHtml(res, opts) {
    opts = opts || {};
    var html = '<p class="muted">回答数 <b>' + res.total + '</b></p>';
    res.questions.forEach(function (q) {
      html += '<div class="result-q"><h3>' + esc(q.label) + '</h3>';
      if (q.type === 'text') {
        if (!opts.showTexts) { html += '</div>'; return; }
        html += q.texts.length
          ? '<ul class="text-answers">' + q.texts.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>'
          : '<p class="muted">まだ回答がありません</p>';
      } else {
        q.counts.forEach(function (c) {
          var pct = res.total ? Math.round(c.count * 100 / res.total) : 0;
          html += '<div class="bar-row"><div class="bar-label"><span>' + esc(c.option) + '</span>' +
            '<span>' + c.count + '票（' + pct + '%）</span></div>' +
            '<div class="bar"><i style="width:' + pct + '%"></i></div></div>';
        });
      }
      html += '</div>';
    });
    return html;
  }

  function qr(el, text, size) {
    el.innerHTML = '';
    if (typeof QRCode === 'undefined') { el.textContent = text; return; }
    new QRCode(el, { text: text, width: size, height: size, colorDark: '#111111', colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M });
  }

  return { esc: esc, toast: toast, busy: busy, formatMemberNo: formatMemberNo, formatTime: formatTime,
    resultsHtml: resultsHtml, qr: qr };
})();
