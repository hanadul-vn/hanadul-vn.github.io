/* Đề thi thử TOPIK II (phần Đọc): làm như thi thật, có tính giờ, nộp bài xem điểm và giải thích.
   Miễn phí, không cần đăng nhập. Giờ đếm và chấm điểm ngay trên máy; bài đang làm lưu ở localStorage
   (tải lại trang, đóng tab vẫn đếm tiếp). Kết quả lưu vào tiến độ (hanadul:v2 → exams), đăng nhập thì đồng bộ theo.
   Cần assets/app.js (HD.lib, HD.setCleanup). */
(function () {
  'use strict';

  var HD = window.HD = window.HD || {};
  var RUN_KEY = 'hanadul:exam-run'; // bài đang làm dở: { id, startedAt, deadline, answers: { n: 0..3 } }
  var FRESH_KEY = 'hanadul:exam-fresh'; // vừa nộp (để màn kết quả hiện XP vừa nhận / báo hết giờ)
  var CIRCLE = ['①', '②', '③', '④'];
  var XP_PER_RIGHT = 2;
  var WARN_MS = 5 * 60 * 1000;

  function L() { return HD.lib; }
  function esc(s) { return L().esc(s); }
  function readRun() {
    try { var r = JSON.parse(localStorage.getItem(RUN_KEY)); return r && r.id ? r : null; } catch (e) { return null; }
  }
  function writeRun(r) {
    try { if (r) localStorage.setItem(RUN_KEY, JSON.stringify(r)); else localStorage.removeItem(RUN_KEY); } catch (e) { /* ẩn danh */ }
  }
  function fresh(v) {
    try {
      if (v === undefined) { var x = JSON.parse(sessionStorage.getItem(FRESH_KEY)); sessionStorage.removeItem(FRESH_KEY); return x; }
      sessionStorage.setItem(FRESH_KEY, JSON.stringify(v));
    } catch (e) { return null; }
  }
  function fmt(ms) {
    var t = Math.max(0, Math.ceil(ms / 1000));
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }
  function mins(secs) {
    var m = Math.floor(secs / 60), s = secs % 60;
    if (!m) return s + ' giây';
    return m + ' phút' + (s ? ' ' + s + ' giây' : '');
  }
  // Ô trống "(    )" giữ đủ độ rộng (HTML gộp dấu cách).
  function gap(html) { return html.replace(/\( {2,}\)/g, '(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;)'); }
  function kq(t) { return gap(L().koq(t)); }
  // Đoạn văn: giữ xuống dòng, gạch chân phần __…__.
  function passageHtml(t) { return kq(t).replace(/\n/g, '<br>'); }

  function loadList() { return L().loadJSON('data/exams/index.json'); }
  function loadExam(id) {
    if (!/^[a-z0-9-]+$/.test(id || '')) return Promise.reject(new Error('Không có đề này.'));
    return L().loadJSON('data/exams/' + id + '.json');
  }
  function flat(ex) {
    var out = [];
    ex.sets.forEach(function (st, si) { st.questions.forEach(function (q) { out.push({ q: q, set: st, si: si }); }); });
    return out;
  }
  function countRight(ex, answers) {
    return flat(ex).filter(function (x) { return answers[x.q.n] === x.q.answer; }).length;
  }
  // Đáp án đã chọn, gọn thành chuỗi: mỗi câu 1 ký tự 0–3, '-' là bỏ trống.
  function packAns(ex, answers) {
    return flat(ex).map(function (x) { var a = answers[x.q.n]; return a === 0 || a === 1 || a === 2 || a === 3 ? String(a) : '-'; }).join('');
  }
  function unpackAns(ex, str) {
    var o = {};
    flat(ex).forEach(function (x, i) { var ch = (str || '').charAt(i); if (/[0-3]/.test(ch)) o[x.q.n] = +ch; });
    return o;
  }
  // Nhóm các bộ 1 câu liền nhau có cùng lời dẫn: [1~2] (    )에 들어갈… Bộ nhiều câu chung 1 đoạn ([19~20]) đứng riêng.
  function rangeOf(ex, si) {
    var st = ex.sets[si];
    var a = si, b = si;
    function same(x) { return x && x.instruction === st.instruction && x.questions.length === 1 && st.questions.length === 1; }
    while (a > 0 && same(ex.sets[a - 1])) a--;
    while (b < ex.sets.length - 1 && same(ex.sets[b + 1])) b++;
    var first = ex.sets[a].questions[0].n, lastQs = ex.sets[b].questions;
    var last = lastQs[lastQs.length - 1].n;
    return { start: a, text: first === last ? String(first) : first + '~' + last };
  }

  function hero(title, sub, ko) {
    return '<div class="lesson-hero exam-hero" data-ko="' + esc(ko || '모의고사') + '"><div class="crumbs"><a href="#/">Trang chủ</a>' +
      (title !== 'Đề thi thử TOPIK II' ? ' / <a href="#/thi-thu">Đề thi thử</a>' : '') + '</div>' +
      '<h1><span class="emoji">📝</span>' + esc(title) + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>';
  }
  function store() { var s = L().readStore(); s.exams = s.exams || {}; return s; }

  // ---------- danh sách đề ----------
  function renderList(app) {
    document.title = 'Đề thi thử TOPIK II – Hana Dul';
    loadList().then(function (idx) {
      var s = store(), run = readRun();
      var h = '<div class="container narrow">' + hero('Đề thi thử TOPIK II', 'Làm như thi thật: tính giờ, nộp bài, xem điểm và giải thích từng câu. Miễn phí, không cần đăng nhập.') +
        '<ul class="exam-list">';
      idx.exams.forEach(function (e) {
        var r = s.exams[e.id];
        var status = run && run.id === e.id ? '<span class="tag doing">⏱ Đang làm dở</span>'
          : r ? '<span class="tag ok">Cao nhất ' + (r.best || 0) + '/' + e.count + '</span>' : '<span class="tag">Chưa làm</span>';
        h += '<li><a class="exam-item" href="#/thi-thu/' + esc(e.id) + '" data-exam="' + esc(e.id) + '"><span class="emoji" aria-hidden="true">' + esc(e.icon || '📖') + '</span>' +
          '<span class="exam-item-body"><b>' + esc(e.title) + '</b><br><span class="muted">' + e.count + ' câu · ' + e.minutes + ' phút' + (e.level ? ' · ' + esc(e.level) : '') + '</span></span>' + status + '</a></li>';
      });
      h += '</ul><p class="muted small-note">Đề do Hana Dul tự soạn theo cấu trúc đề TOPIK II, không phải đề thi chính thức. Phần Viết sẽ có sớm.</p></div>';
      app.innerHTML = h;
    }).catch(function (err) { failMsg(app, err); });
  }

  function failMsg(app, err) {
    app.innerHTML = '<div class="container narrow" style="padding:40px 16px"><h1>Không tải được đề thi</h1><p class="muted">' + esc(err && err.message || err) + '</p><p><a href="#/thi-thu">Về danh sách đề</a></p></div>';
  }

  // ---------- trang giới thiệu đề ----------
  function renderIntro(app, ex) {
    document.title = ex.title + ' – Hana Dul';
    var s = store(), run = readRun(), r = s.exams[ex.id];
    var total = flat(ex).length;
    var h = '<div class="container narrow">' + hero(ex.title, esc(total + ' câu · ' + ex.minutes + ' phút')) +
      '<div class="panel exam-intro"><h2>Trước khi bắt đầu</h2><ul class="exam-rules">' +
      '<li>⏱ Có <b>' + ex.minutes + ' phút</b> cho ' + total + ' câu. Đồng hồ vẫn chạy khi bạn tải lại trang hay đóng tab.</li>' +
      '<li>✅ Bấm chọn ① ② ③ ④, bấm lại để bỏ chọn. Chọn xong tự lưu.</li>' +
      '<li>📤 Hết giờ bài tự nộp. Câu bỏ trống tính là sai.</li>' +
      '<li>🎯 Mỗi câu đúng 2 điểm (tối đa ' + total * 2 + '). Nộp xong xem đáp án, giải thích và bản dịch từng đoạn.</li></ul>';
    if (ex.note) h += '<p class="muted small-note">' + esc(ex.note) + '</p>';
    if (run && run.id === ex.id && Date.now() >= run.deadline) { location.replace('#/thi-thu/' + ex.id + '/lam'); return; }
    var other = run && run.id !== ex.id;
    var mine = run && run.id === ex.id;
    if (other) {
      h += '<p class="form-msg bad" id="otherRun">Bạn đang làm dở một đề khác. Mỗi lần chỉ làm một đề.</p>' +
        '<div class="actions"><a class="btn ghost" href="#/thi-thu/' + esc(run.id) + '/lam">Làm tiếp đề đang dở</a>' +
        '<button type="button" class="btn" id="startBtn" data-discard="1">Bỏ đề kia, làm đề này</button></div>';
    } else if (mine) {
      h += '<div class="actions"><a class="btn" id="resumeBtn" href="#/thi-thu/' + esc(ex.id) + '/lam">⏱ Làm tiếp (còn ' + fmt(run.deadline - Date.now()) + ')</a></div>';
    } else {
      h += '<div class="actions"><button type="button" class="btn" id="startBtn">Bắt đầu làm bài →</button></div>';
    }
    if (r) h += '<p class="muted" style="margin-top:12px">Lần trước: <b>' + r.last + '/' + total + '</b> câu đúng · cao nhất ' + r.best + '/' + total + ' · <a href="#/thi-thu/' + esc(ex.id) + '/ket-qua">Xem lại bài đã nộp</a></p>';
    app.innerHTML = h + '</div></div>';
    var b = document.getElementById('startBtn');
    if (b) b.addEventListener('click', function () {
      var t = Date.now();
      writeRun({ id: ex.id, startedAt: t, deadline: t + ex.minutes * 60000, answers: {} });
      HD.track('exam_start', { exam_id: ex.id });
      location.hash = '#/thi-thu/' + ex.id + '/lam';
    });
  }

  // ---------- làm bài ----------
  function renderRun(app, ex) {
    var run = readRun();
    if (!run || run.id !== ex.id) { location.replace('#/thi-thu/' + ex.id); return; }
    if (Date.now() >= run.deadline) return submit(ex, run, true);
    document.title = '⏱ ' + ex.title + ' – Hana Dul';
    document.body.classList.add('quiz-mode', 'exam-mode');
    var all = flat(ex);
    var total = all.length;
    var h = '<div id="examRoot"><div class="exam-bar" role="region" aria-label="Thời gian và nộp bài"><div class="container narrow exam-bar-in">' +
      '<span class="exam-timer" id="examTimer" role="timer" aria-live="off">⏱ ' + fmt(run.deadline - Date.now()) + '</span>' +
      '<span class="exam-count" id="examCount"></span>' +
      '<button type="button" class="btn" id="submitBtn">Nộp bài</button></div></div>' +
      '<div class="container narrow exam-paper"><h1 class="exam-title">' + esc(ex.title) + '</h1>' +
      '<div class="exam-confirm panel" id="confirmBox" hidden></div>';
    ex.sets.forEach(function (st, si) {
      var rg = rangeOf(ex, si);
      if (rg.start === si) h += '<h2 class="ex-inst"><span class="ko">[' + rg.text + '] ' + gap(esc(st.instruction)) + '</span><br><span class="muted">' + gap(esc(st.instructionVi || '')) + '</span></h2>';
      h += '<section class="ex-set">';
      if (st.sentence) h += '<div class="ex-box"><span class="ex-box-label ko">보기</span><p class="ko">' + passageHtml(st.sentence) + '</p></div>';
      if (st.passage) h += '<div class="ex-passage ko">' + passageHtml(st.passage) + '</div>';
      st.questions.forEach(function (q) {
        h += '<div class="ex-q" id="q-' + q.n + '"><p class="ex-qtext"><b>' + q.n + '.</b> ' + (q.q ? kq(q.q) : '') + '</p>' +
          '<div class="ex-opts" role="radiogroup" aria-label="Câu ' + q.n + '">' +
          q.options.map(function (o, i) {
            var on = run.answers[q.n] === i;
            return '<button type="button" class="ex-opt' + (on ? ' on' : '') + '" role="radio" aria-checked="' + on + '" data-n="' + q.n + '" data-o="' + i + '">' +
              '<span class="circ">' + CIRCLE[i] + '</span><span class="ko">' + L().koq(o) + '</span></button>';
          }).join('') + '</div></div>';
      });
      h += '</section>';
    });
    h += '<nav class="ex-nav" aria-label="Chuyển nhanh tới câu"><h2>Bảng câu hỏi</h2><div class="ex-nav-grid">' +
      all.map(function (x) { return '<button type="button" data-jump="' + x.q.n + '">' + x.q.n + '</button>'; }).join('') +
      '</div><div class="actions"><button type="button" class="btn" id="submitBtn2">Nộp bài</button></div></nav></div></div>';
    app.innerHTML = h;
    var root = document.getElementById('examRoot');

    var timerEl = document.getElementById('examTimer');
    var countEl = document.getElementById('examCount');
    function answered() { return Object.keys(run.answers).length; }
    function paintCount() {
      countEl.textContent = 'Đã làm ' + answered() + '/' + total;
      root.querySelectorAll('[data-jump]').forEach(function (b) { b.classList.toggle('on', run.answers[b.getAttribute('data-jump')] != null); });
    }
    function tick() {
      var left = run.deadline - Date.now();
      if (left <= 0) { stop(); submit(ex, readRun() || run, true); return; }
      timerEl.textContent = '⏱ ' + fmt(left);
      timerEl.classList.toggle('warn', left <= WARN_MS);
    }
    var iv = setInterval(tick, 1000);
    function stop() { clearInterval(iv); document.body.classList.remove('exam-mode'); }
    HD.setCleanup(stop);
    paintCount(); tick();

    root.addEventListener('click', function (e) {
      var opt = e.target.closest('.ex-opt');
      if (opt) {
        var cur = readRun();
        if (!cur || cur.id !== ex.id) { location.replace('#/thi-thu/' + ex.id); return; }
        run = cur;
        var n = opt.getAttribute('data-n'), o = +opt.getAttribute('data-o');
        if (run.answers[n] === o) delete run.answers[n]; else run.answers[n] = o;
        writeRun(run);
        opt.parentNode.querySelectorAll('.ex-opt').forEach(function (b) {
          var on = run.answers[n] === +b.getAttribute('data-o');
          b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on));
        });
        paintCount();
        return;
      }
      var j = e.target.closest('[data-jump]');
      if (j) {
        var el = document.getElementById('q-' + j.getAttribute('data-jump'));
        if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
        return;
      }
      if (e.target.id === 'submitBtn' || e.target.id === 'submitBtn2') return askSubmit();
      if (e.target.id === 'confirmYes') { stop(); return submit(ex, readRun() || run, false); }
      if (e.target.id === 'confirmNo') { document.getElementById('confirmBox').hidden = true; return; }
    });
    function askSubmit() {
      var left = total - answered();
      var box = document.getElementById('confirmBox');
      box.innerHTML = '<p><b>' + (left ? 'Còn ' + left + ' câu chưa làm (tính là sai).' : 'Bạn đã làm hết ' + total + ' câu.') + '</b> Nộp bài bây giờ?</p>' +
        '<div class="actions"><button type="button" class="btn ghost" id="confirmNo">Làm tiếp</button><button type="button" class="btn" id="confirmYes">Nộp bài</button></div>';
      box.hidden = false;
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function submit(ex, run, timeUp) {
    var total = flat(ex).length;
    var right = countRight(ex, run.answers);
    var end = Math.min(Date.now(), run.deadline);
    var secs = Math.max(0, Math.round((end - run.startedAt) / 1000));
    var s = store();
    var prev = s.exams[ex.id] || {};
    s.exams[ex.id] = { best: Math.max(prev.best || 0, right), last: right, at: Date.now(), n: (prev.n || 0) + 1, ans: packAns(ex, run.answers), secs: secs };
    var xp = right * XP_PER_RIGHT;
    s.xp += xp;
    var d = L().today();
    if (s.days.indexOf(d) < 0) s.days.push(d);
    s.days = s.days.slice(-400);
    L().writeStore(s);
    writeRun(null);
    fresh({ id: ex.id, xp: xp, timeUp: !!timeUp });
    HD.track('exam_submit', { exam_id: ex.id, score: right, questions: total, time_up: !!timeUp });
    document.body.classList.remove('exam-mode');
    var target = '#/thi-thu/' + ex.id + '/ket-qua';
    if (location.hash === target) HD.refresh(); else location.replace(target);
  }

  // ---------- kết quả + xem lại ----------
  function renderResult(app, ex) {
    var s = store(), r = s.exams[ex.id];
    if (!r || typeof r.ans !== 'string') { location.replace('#/thi-thu/' + ex.id); return; }
    document.title = 'Kết quả ' + ex.title + ' – Hana Dul';
    var f = fresh();
    if (f && f.id !== ex.id) f = null;
    var all = flat(ex), total = all.length;
    var answers = unpackAns(ex, r.ans);
    var right = r.last;
    var wrong = all.filter(function (x) { return answers[x.q.n] != null && answers[x.q.n] !== x.q.answer; }).length;
    var blank = total - right - wrong;
    var pct = Math.round(right / total * 100);
    var h = '<div class="container narrow">' + hero('Kết quả: ' + ex.title, '', '결과');
    if (f && f.timeUp) h += '<p class="form-msg bad" id="timeUpMsg" role="status">⏰ Hết giờ, bài đã tự động nộp.</p>';
    h += '<div class="panel exam-score"><div class="big-emoji">' + (pct >= 80 ? '🏆' : pct >= 60 ? '🎉' : '💪') + '</div>' +
      '<h2><span id="scoreRight">' + right + '</span>/' + total + ' câu đúng</h2>' +
      '<p class="muted">Điểm: <b>' + right * 2 + '/' + total * 2 + '</b> · Thời gian làm: ' + mins(r.secs || 0) + ' / ' + ex.minutes + ' phút · Cao nhất: ' + r.best + '/' + total + '</p>' +
      '<div class="result-grid"><div class="rbox acc"><b>' + right + '</b><span>✅ Đúng</span></div>' +
      '<div class="rbox fire"><b>' + wrong + '</b><span>❌ Sai</span></div>' +
      '<div class="rbox xp"><b>' + (f ? '+' + f.xp : blank) + '</b><span>' + (f ? '⭐ XP' : '⬜ Bỏ trống') + '</span></div></div>';
    // Đúng theo từng dạng câu.
    var groups = [], byInst = {};
    all.forEach(function (x) {
      var k = x.set.instructionVi || x.set.instruction;
      if (!byInst[k]) { byInst[k] = { label: k, ok: 0, n: 0 }; groups.push(byInst[k]); }
      byInst[k].n++;
      if (answers[x.q.n] === x.q.answer) byInst[k].ok++;
    });
    h += '<details class="review exam-types"><summary>📊 Đúng theo dạng câu</summary><table><tbody>' +
      groups.map(function (g) { return '<tr><td>' + esc(g.label) + '</td><td class="num' + (g.ok < g.n / 2 ? ' low' : '') + '">' + g.ok + '/' + g.n + '</td></tr>'; }).join('') +
      '</tbody></table></details>' +
      '<div class="actions"><a class="btn ghost" href="#/thi-thu">Danh sách đề</a><a class="btn" href="#/thi-thu/' + esc(ex.id) + '">🔁 Làm lại đề</a></div></div>';

    h += '<div class="exam-review"><h2>Xem lại từng câu</h2><div class="seg ex-filter" role="tablist">' +
      '<button type="button" data-f="all" aria-pressed="true">Tất cả</button>' +
      '<button type="button" data-f="wrong" aria-pressed="false">Sai và bỏ trống (' + (wrong + blank) + ')</button></div>';
    ex.sets.forEach(function (st, si) {
      var rg = rangeOf(ex, si);
      var bad = st.questions.some(function (q) { return answers[q.n] !== q.answer; });
      h += '<section class="ex-set ex-rev' + (bad ? ' has-wrong' : '') + '">';
      if (rg.start === si) h += '<h3 class="ex-inst ko">[' + rg.text + '] ' + gap(esc(st.instruction)) + '</h3>';
      if (st.sentence) h += '<div class="ex-box"><span class="ex-box-label ko">보기</span><p class="ko">' + passageHtml(st.sentence) + '</p></div>';
      if (st.passage) h += '<div class="ex-passage ko">' + passageHtml(st.passage) + '</div>';
      if (st.passageVi) h += '<details class="ex-vi"><summary>Dịch đoạn văn</summary><p>' + gap(L().ko(st.passageVi)) + '</p></details>';
      st.questions.forEach(function (q) {
        var a = answers[q.n];
        var state = a == null ? 'blank' : a === q.answer ? 'right' : 'wrong';
        h += '<div class="ex-q ' + state + '" data-state="' + state + '"><p class="ex-qtext"><b>' + q.n + '.</b> ' + (q.q ? kq(q.q) : '') +
          ' <span class="ex-mark">' + (state === 'right' ? '✅' : state === 'wrong' ? '❌' : '⬜ Bỏ trống') + '</span></p><div class="ex-opts">' +
          q.options.map(function (o, i) {
            var cls = i === q.answer ? ' correct' : i === a ? ' chosen' : '';
            return '<div class="ex-opt' + cls + '"><span class="circ">' + CIRCLE[i] + '</span><span class="ko">' + L().koq(o) + '</span></div>';
          }).join('') + '</div><p class="ex-explain">💡 ' + L().ko(q.explain) + '</p></div>';
      });
      h += '</section>';
    });
    app.innerHTML = h + '</div></div>';
    app.querySelector('.ex-filter').addEventListener('click', function (e) {
      var b = e.target.closest('[data-f]');
      if (!b) return;
      var onlyBad = b.getAttribute('data-f') === 'wrong';
      this.querySelectorAll('[data-f]').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
      app.querySelectorAll('.ex-rev').forEach(function (sec) {
        sec.hidden = onlyBad && !sec.classList.contains('has-wrong');
        sec.querySelectorAll('.ex-q').forEach(function (q) { q.hidden = onlyBad && q.getAttribute('data-state') === 'right'; });
      });
    });
  }

  // ---------- điểm vào từ app.js ----------
  HD.renderExam = function (app, parts) {
    var id = parts[0];
    if (!id) return renderList(app);
    loadExam(id).then(function (ex) {
      if (parts[1] === 'lam') return renderRun(app, ex);
      if (parts[1] === 'ket-qua') return renderResult(app, ex);
      renderIntro(app, ex);
    }).catch(function (err) { failMsg(app, err); });
  };

  // Thẻ ở trang chủ: đang làm dở thì mời làm tiếp, chưa thì giới thiệu đề thi thử.
  HD.examHomeCard = function () {
    var run = readRun();
    if (run && run.deadline > Date.now()) {
      return '<a class="continue exam-card doing" href="#/thi-thu/' + esc(run.id) + '/lam"><span class="emoji">⏱</span>' +
        '<span><span class="label">Đề thi thử đang làm dở · còn ' + fmt(run.deadline - Date.now()) + '</span><br><span class="title">Làm tiếp</span></span><span class="go">→</span></a>';
    }
    return '<a class="continue exam-card" href="#/thi-thu"><span class="emoji">📝</span>' +
      '<span><span class="label">Mới · miễn phí</span><br><span class="title">Đề thi thử TOPIK II có tính giờ</span></span><span class="go">→</span></a>';
  };
})();
