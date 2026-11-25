/* Đề thi thử TOPIK II (phần Đọc, phần Nghe và phần Viết 51–54): làm như thi thật, có tính giờ, nộp bài xem điểm và giải thích.
   Miễn phí, không cần đăng nhập. Giờ đếm và chấm điểm ngay trên máy; bài đang làm lưu ở localStorage
   (tải lại trang, đóng tab vẫn đếm tiếp). Kết quả lưu vào tiến độ (hanadul:v2 → exams), đăng nhập thì đồng bộ theo.
   Phần Nghe: phát file âm thanh thu sẵn (ex.audio, giọng Google Chirp 3 HD, tạo bằng tools/tts/gen_audio.py); đề chưa có file
   hoặc tải file lỗi thì đọc lời thoại bằng giọng có sẵn của trình duyệt (Web Speech API). Mỗi đoạn nghe tối đa ex.plays lần khi làm bài.
   Phần Viết: 51–52 so khớp với đáp án mẫu, 53–54 người học tự chấm theo tiêu chí và bài mẫu (không chấm bằng AI).
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
  function isViet(ex) { return ex && ex.part === 'viet'; }
  function isNghe(ex) { return ex && ex.part === 'nghe'; }
  // Phần Nghe: mỗi bộ câu có lời thoại (lines) do giọng đọc của trình duyệt phát; khi làm bài mỗi đoạn nghe tối đa ex.plays lần.
  function maxPlays(ex) { return ex.plays || 2; }
  function audioBox(ex, st, si, used, review) {
    var left = maxPlays(ex) - (used || 0);
    var qs = st.questions;
    var label = qs.length > 1 ? qs[0].n + '~' + qs[qs.length - 1].n : String(qs[0].n);
    return '<div class="ex-audio"><button type="button" class="play" data-' + (review ? 'replay' : 'play') + '="' + si + '"' + (!review && left <= 0 ? ' disabled' : '') +
      ' aria-label="Nghe đoạn câu ' + label + '">🔊</button><div><b>Nghe đoạn câu ' + label + '</b><br><span class="muted" data-left="' + si + '">' +
      (review ? 'Nghe lại thoải mái khi xem lại' : left > 0 ? 'Còn ' + left + ' lượt nghe' : 'Đã hết lượt nghe') + '</span></div></div>';
  }
  function scriptHtml(st) {
    return '<details class="ex-vi ex-script"><summary>Lời thoại</summary>' + st.lines.map(function (l) {
      return '<p><b class="ko">' + esc(l[0]) + ':</b> <span class="ko">' + esc(l[1]) + '</span></p>';
    }).join('') + '</details>' + (st.linesVi ? '<details class="ex-vi"><summary>Dịch lời thoại</summary><p>' + L().ko(st.linesVi) + '</p></details>' : '');
  }
  // Âm thanh thu sẵn: tải trước thành blob để bấm là phát ngay (iPhone chặn phát nếu phải chờ tải) và học offline.
  var player = null, blobs = {};
  function audioUrl(ex, name) { return ex.audio && name ? ex.audio.dir + '/' + name : ''; }
  function setUrl(ex, si) { return audioUrl(ex, ex.audio && ex.audio.files && ex.audio.files[si]); }
  function preloadAudio(ex) {
    if (!ex.audio || !window.fetch || !window.URL || !URL.createObjectURL) return;
    (ex.audio.files || []).forEach(function (f) {
      var u = audioUrl(ex, f);
      if (blobs[u]) return;
      blobs[u] = 'loading';
      fetch(u).then(function (r) { if (!r.ok) throw new Error(r.status); return r.blob(); })
        .then(function (b) { blobs[u] = URL.createObjectURL(b); }, function () { delete blobs[u]; });
    });
  }
  // Phát file u; không phát được (thiếu file, mất mạng, trình duyệt chặn) thì gọi fallback (giọng trình duyệt).
  function playUrl(u, fallback) {
    stopAudio();
    if (!u || typeof Audio === 'undefined') return fallback();
    var a = new Audio(blobs[u] && blobs[u] !== 'loading' ? blobs[u] : u), done = false;
    player = a;
    var fb = function () { if (done || player !== a) return; done = true; player = null; fallback(); };
    a.addEventListener('error', fb);
    try { var p = a.play(); if (p && p.catch) p.catch(function (e) { if (!e || e.name !== 'AbortError') fb(); }); } catch (e) { fb(); }
  }
  function playSet(ex, si) { var st = ex.sets[si]; playUrl(setUrl(ex, si), function () { L().speakLines(st.lines, 0.95); }); }
  function stopAudio() {
    if (player) { try { player.pause(); } catch (e) { /* đã dừng */ } player = null; }
    try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* không có giọng đọc */ }
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

  // ---------- phần Viết: tiện ích ----------
  var XP_VIET = 20;
  var BLANK_LV = [{ v: 1, t: 'Đúng' }, { v: 0.6, t: 'Gần đúng' }, { v: 0, t: 'Sai' }];
  var RUB_LV = [{ v: 1, t: 'Tốt' }, { v: 0.6, t: 'Khá' }, { v: 0.25, t: 'Yếu' }, { v: 0, t: 'Chưa đạt' }];
  // Đếm ký tự như TOPIK: tính cả dấu cách, không tính xuống dòng.
  function charCount(t) { return (t || '').replace(/[\r\n]/g, '').length; }
  function norm(t) { return (t || '').normalize('NFC').replace(/[\s.,!?~'"“”‘’·…]/g, ''); }
  function matches(text, answers) { var n = norm(text); return !!n && answers.some(function (a) { return norm(a) === n; }); }
  // Các ô cần viết của 1 câu: 51/52 → "51-㉠", "51-㉡"; 53/54 → "53".
  function keysOf(q) { return q.kind === 'fill' ? q.blanks.map(function (b) { return q.n + '-' + b.mark; }) : [String(q.n)]; }
  function blankPts(q) { return q.points / q.blanks.length; }
  function wrote(texts, q) { return keysOf(q).some(function (k) { return (texts[k] || '').trim(); }); }
  // Các mục chấm của 1 câu: { key, max, auto (điểm tự động hoặc null), self (điểm tự chấm hoặc null), empty }.
  function items(q, texts, self) {
    if (q.kind === 'fill') {
      return q.blanks.map(function (b) {
        var k = q.n + '-' + b.mark, t = texts[k] || '', max = blankPts(q);
        return { key: k, max: max, empty: !t.trim(), auto: matches(t, b.answers) ? max : null, self: self[k] != null ? Math.round(self[k] * max) : null };
      });
    }
    var t = texts[String(q.n)] || '';
    return q.rubric.map(function (rb, i) {
      var k = q.n + '-' + i;
      return { key: k, max: rb.points, empty: !t.trim(), auto: null, self: self[k] != null ? Math.round(self[k] * rb.points) : null };
    });
  }
  function itemPts(it) { return it.empty ? 0 : it.self != null ? it.self : it.auto != null ? it.auto : 0; }
  function itemPending(it) { return !it.empty && it.self == null && it.auto == null; }
  function vietScore(ex, texts, self) {
    var pts = 0, pending = 0;
    flat(ex).forEach(function (x) { items(x.q, texts, self).forEach(function (it) { pts += itemPts(it); if (itemPending(it)) pending++; }); });
    return { pts: Math.round(pts), pending: pending };
  }
  function maxScore(ex) { return flat(ex).reduce(function (a, x) { return a + (x.q.points || 0); }, 0); }

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
          : r ? '<span class="tag ok">Cao nhất ' + (r.best || 0) + '/' + (e.part === 'viet' ? 100 : e.count) + '</span>' : '<span class="tag">Chưa làm</span>';
        h += '<li><a class="exam-item" href="#/thi-thu/' + esc(e.id) + '" data-exam="' + esc(e.id) + '"><span class="emoji" aria-hidden="true">' + esc(e.icon || '📖') + '</span>' +
          '<span class="exam-item-body"><b>' + esc(e.title) + '</b><br><span class="muted">' + e.count + ' câu · ' + e.minutes + ' phút' + (e.level ? ' · ' + esc(e.level) : '') + '</span></span>' + status + '</a></li>';
      });
      h += '</ul><p class="muted small-note">Đề do Hana Dul tự soạn theo cấu trúc đề TOPIK II, không phải đề thi chính thức. Phần Viết: bạn tự chấm theo đáp án, tiêu chí và bài mẫu. Phần Nghe: âm thanh là giọng đọc AI thu sẵn, máy không tải được thì dùng giọng đọc của trình duyệt.</p></div>';
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
      (isNghe(ex)
        ? '<li>🎧 Bật loa hoặc đeo tai nghe. Bấm 🔊 ở mỗi đoạn để nghe; mỗi đoạn nghe tối đa <b>' + maxPlays(ex) + ' lần</b>, nghe xong chọn ① ② ③ ④.</li>' +
          (ex.audio
            ? '<li>🎙️ Âm thanh là giọng đọc AI tự nhiên thu sẵn (giọng nam, giọng nữ riêng), không có tiếng động như đề thật. Mất mạng giữa chừng thì đoạn chưa tải sẽ đọc bằng giọng của trình duyệt.</li>'
            : '<li>🤖 Âm thanh là giọng đọc có sẵn của trình duyệt (miễn phí, không cần tải). Nghe sẽ hơi máy móc và không có tiếng động như đề thật; máy chưa có giọng tiếng Hàn thì hãy cài thêm (Android: Cài đặt › Chuyển văn bản thành giọng nói; iPhone: Cài đặt › Trợ năng › Nội dung được đọc).</li>') +
          '<li>📤 Hết giờ bài tự nộp. Mỗi câu đúng 2 điểm (tối đa ' + total * 2 + '). Nộp xong xem lời thoại, bản dịch, giải thích và nghe lại thoải mái.</li>' +
          '<li id="ttsCheck" class="muted"></li>'
        : isViet(ex)
        ? '<li>✍️ Gõ câu trả lời vào ô (bàn phím tiếng Hàn). Gõ tới đâu tự lưu tới đó, có đếm số chữ.</li>' +
          '<li>📤 Hết giờ bài tự nộp với những gì bạn đã viết.</li>' +
          '<li>🎯 Thang 100 điểm: câu 51, 52 mỗi câu 10 điểm (máy so với đáp án mẫu), câu 53 30 điểm, câu 54 50 điểm: bạn tự chấm theo tiêu chí và bài mẫu sau khi nộp.</li>'
        : '<li>✅ Bấm chọn ① ② ③ ④, bấm lại để bỏ chọn. Chọn xong tự lưu.</li>' +
          '<li>📤 Hết giờ bài tự nộp. Câu bỏ trống tính là sai.</li>' +
          '<li>🎯 Mỗi câu đúng 2 điểm (tối đa ' + total * 2 + '). Nộp xong xem đáp án, giải thích và bản dịch từng đoạn.</li>') + '</ul>';
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
    if (r && isViet(ex)) h += '<p class="muted" style="margin-top:12px">Lần trước: <b>' + r.last + '/100</b> điểm · cao nhất ' + r.best + '/100 · <a href="#/thi-thu/' + esc(ex.id) + '/ket-qua">Xem lại và tự chấm bài đã nộp</a></p>';
    else if (r) h += '<p class="muted" style="margin-top:12px">Lần trước: <b>' + r.last + '/' + total + '</b> câu đúng · cao nhất ' + r.best + '/' + total + ' · <a href="#/thi-thu/' + esc(ex.id) + '/ket-qua">Xem lại bài đã nộp</a></p>';
    app.innerHTML = h + '</div></div>';
    var tc = document.getElementById('ttsCheck');
    if (tc && ex.audio) {
      tc.innerHTML = '✅ Đề có giọng đọc thu sẵn. <button type="button" class="slow" data-sample="1">🔊 Nghe thử</button>';
      tc.querySelector('[data-sample]').addEventListener('click', function () {
        playUrl(audioUrl(ex, ex.audio.sample), function () { L().speak('안녕하세요. 듣기 시험을 시작하겠습니다.'); });
      });
      HD.setCleanup(stopAudio);
    } else if (tc) {
      var hasVoice = function () { return window.speechSynthesis && speechSynthesis.getVoices().some(function (v) { return /^ko/i.test(v.lang); }); };
      var paint = function () {
        tc.innerHTML = !window.speechSynthesis ? '⚠️ Trình duyệt này không đọc to được. Hãy mở bằng Chrome, Safari hoặc Edge bản mới.'
          : hasVoice() ? '✅ Máy đã có giọng đọc tiếng Hàn. <button type="button" class="slow" data-say="안녕하세요. 듣기 시험을 시작하겠습니다.">🔊 Nghe thử</button>'
          : '⚠️ Chưa thấy giọng đọc tiếng Hàn trên máy, âm có thể không chuẩn. <button type="button" class="slow" data-say="안녕하세요. 듣기 시험을 시작하겠습니다.">🔊 Nghe thử</button>';
      };
      paint();
      setTimeout(paint, 800);
    }
    var b = document.getElementById('startBtn');
    if (b) b.addEventListener('click', function () {
      var t = Date.now();
      writeRun({ id: ex.id, startedAt: t, deadline: t + ex.minutes * 60000, answers: {}, texts: {} });
      HD.track('exam_start', { exam_id: ex.id });
      location.hash = '#/thi-thu/' + ex.id + '/lam';
    });
  }

  // ---------- làm bài ----------
  function renderRun(app, ex) {
    var run = readRun();
    if (!run || run.id !== ex.id) { location.replace('#/thi-thu/' + ex.id); return; }
    if (Date.now() >= run.deadline) return submit(ex, run, true);
    if (isViet(ex)) return renderWrite(app, ex, run);
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
      if (st.lines) h += audioBox(ex, st, si, (run.plays || {})[si]);
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
    function stop() { clearInterval(iv); document.body.classList.remove('exam-mode'); stopAudio(); }
    HD.setCleanup(stop);
    if (isNghe(ex)) preloadAudio(ex);
    paintCount(); tick();

    root.addEventListener('click', function (e) {
      var pb = e.target.closest('[data-play]');
      if (pb) {
        var cr = readRun();
        if (!cr || cr.id !== ex.id) { location.replace('#/thi-thu/' + ex.id); return; }
        run = cr;
        var si = pb.getAttribute('data-play');
        run.plays = run.plays || {};
        var used = run.plays[si] || 0;
        if (used >= maxPlays(ex)) { L().toast('Đoạn này đã nghe đủ ' + maxPlays(ex) + ' lần.'); return; }
        run.plays[si] = used + 1;
        writeRun(run);
        playSet(ex, si);
        var left = maxPlays(ex) - run.plays[si];
        root.querySelector('[data-left="' + si + '"]').textContent = left > 0 ? 'Còn ' + left + ' lượt nghe' : 'Đã hết lượt nghe';
        if (left <= 0) pb.disabled = true;
        return;
      }
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
    if (isViet(ex)) return submitWrite(ex, run, timeUp);
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

  // Nút tạo ảnh chia sẻ kết quả (assets/share.js).
  function shareRow() { return HD.share ? '<p class="share-row"><button type="button" class="btn ghost small" id="shareResult">📸 Khoe kết quả</button></p>' : ''; }
  function bindShare(app, opts) {
    var b = app.querySelector('#shareResult');
    if (b) b.addEventListener('click', function () { HD.share.open(opts()); });
  }

  // ---------- kết quả + xem lại ----------
  function renderResult(app, ex) {
    var s = store(), r = s.exams[ex.id];
    if (isViet(ex)) return renderWriteResult(app, ex);
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
      '<div class="actions"><a class="btn ghost" href="#/thi-thu">Danh sách đề</a><a class="btn" href="#/thi-thu/' + esc(ex.id) + '">🔁 Làm lại đề</a></div>' + shareRow() + '</div>';

    h += '<div class="exam-review"><h2>Xem lại từng câu</h2><div class="seg ex-filter" role="tablist">' +
      '<button type="button" data-f="all" aria-pressed="true">Tất cả</button>' +
      '<button type="button" data-f="wrong" aria-pressed="false">Sai và bỏ trống (' + (wrong + blank) + ')</button></div>';
    ex.sets.forEach(function (st, si) {
      var rg = rangeOf(ex, si);
      var bad = st.questions.some(function (q) { return answers[q.n] !== q.answer; });
      h += '<section class="ex-set ex-rev' + (bad ? ' has-wrong' : '') + '">';
      if (rg.start === si) h += '<h3 class="ex-inst ko">[' + rg.text + '] ' + gap(esc(st.instruction)) + '</h3>';
      if (st.lines) h += audioBox(ex, st, si, 0, true) + scriptHtml(st);
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
    bindShare(app, function () {
      return { kind: 'thi-thu', emoji: pct >= 80 ? '🏆' : pct >= 60 ? '🎉' : '💪', kicker: 'Đề thi thử TOPIK II · ' + (isNghe(ex) ? 'Nghe' : 'Đọc'), title: ex.title,
        big: right + '/' + total, bigLabel: 'câu đúng · ' + right * 2 + '/' + total * 2 + ' điểm', stats: [['⏱', mins(r.secs || 0)], ['🎯', pct + '%']] };
    });
    app.querySelector('.exam-review').addEventListener('click', function (e) {
      var rb = e.target.closest('[data-replay]');
      if (rb) playSet(ex, +rb.getAttribute('data-replay'));
    });
    HD.setCleanup(stopAudio);
    if (isNghe(ex)) preloadAudio(ex);
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

  // ---------- phần Viết: làm bài ----------
  function dataBox(q) {
    if (!q.data) return '';
    return '<div class="ex-box"><span class="ex-box-label ko">' + (q.kind === 'chart' ? '자료' : '내용') + '</span><p class="ko">' + passageHtml(q.data) + '</p></div>';
  }
  function countText(q, t) {
    var c = charCount(t), ok = c >= q.minChars && c <= q.maxChars;
    return { ok: ok, html: '<b>' + c + '</b> ký tự · yêu cầu ' + q.minChars + '–' + q.maxChars };
  }
  function renderWrite(app, ex, run) {
    run.texts = run.texts || {};
    document.title = '⏱ ' + ex.title + ' – Hana Dul';
    document.body.classList.add('quiz-mode', 'exam-mode');
    var all = flat(ex), total = all.length;
    var h = '<div id="examRoot" class="wr-exam"><div class="exam-bar" role="region" aria-label="Thời gian và nộp bài"><div class="container narrow exam-bar-in">' +
      '<span class="exam-timer" id="examTimer" role="timer" aria-live="off">⏱ ' + fmt(run.deadline - Date.now()) + '</span>' +
      '<span class="exam-count" id="examCount"></span>' +
      '<button type="button" class="btn" id="submitBtn">Nộp bài</button></div></div>' +
      '<div class="container narrow exam-paper"><h1 class="exam-title">' + esc(ex.title) + '</h1>' +
      '<div class="exam-confirm panel" id="confirmBox" hidden></div>';
    ex.sets.forEach(function (st, si) {
      var rg = rangeOf(ex, si);
      if (rg.start === si) h += '<h2 class="ex-inst"><span class="ko">[' + rg.text + '] ' + gap(esc(st.instruction)) + '</span><br><span class="muted">' + gap(esc(st.instructionVi || '')) + '</span></h2>';
      st.questions.forEach(function (q) {
        h += '<section class="ex-set ex-q wr-q" id="q-' + q.n + '"><p class="ex-qtext"><b>' + q.n + '.</b> ' + (q.q ? kq(q.q) : '') + ' <span class="muted">(' + q.points + ' điểm)</span></p>';
        if (q.kind === 'fill') {
          h += '<div class="ex-passage ko">' + passageHtml(q.passage) + '</div>';
          q.blanks.forEach(function (b) {
            var k = q.n + '-' + b.mark;
            h += '<label class="wr-blank"><span class="wr-mark ko">' + esc(b.mark) + '</span>' +
              '<input type="text" class="wr-in ko" lang="ko" data-key="' + esc(k) + '" maxlength="120" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Câu ' + q.n + ' ô ' + esc(b.mark) + '" value="' + esc(run.texts[k] || '') + '"></label>';
          });
        } else {
          var t = run.texts[String(q.n)] || '', c = countText(q, t);
          h += dataBox(q) +
            '<textarea class="wr-ta ko" lang="ko" data-key="' + q.n + '" rows="' + (q.kind === 'essay' ? 14 : 8) + '" maxlength="' + (q.maxChars * 2) + '" spellcheck="false" aria-label="Bài viết câu ' + q.n + '" placeholder="Viết bài ở đây (bàn phím tiếng Hàn)…">' + esc(t) + '</textarea>' +
            '<p class="wr-count' + (c.ok ? ' ok' : '') + '" id="cnt-' + q.n + '">' + c.html + '</p>';
        }
        h += '</section>';
      });
    });
    h += '<nav class="ex-nav" aria-label="Chuyển nhanh tới câu"><h2>Bảng câu hỏi</h2><div class="ex-nav-grid">' +
      all.map(function (x) { return '<button type="button" data-jump="' + x.q.n + '">' + x.q.n + '</button>'; }).join('') +
      '</div><div class="actions"><button type="button" class="btn" id="submitBtn2">Nộp bài</button></div></nav></div></div>';
    app.innerHTML = h;
    var root = document.getElementById('examRoot');
    var timerEl = document.getElementById('examTimer');
    var countEl = document.getElementById('examCount');
    function done() { return all.filter(function (x) { return wrote(run.texts, x.q); }).length; }
    function paintCount() {
      countEl.textContent = 'Đã viết ' + done() + '/' + total;
      root.querySelectorAll('[data-jump]').forEach(function (b) {
        var x = all.filter(function (y) { return String(y.q.n) === b.getAttribute('data-jump'); })[0];
        b.classList.toggle('on', !!x && wrote(run.texts, x.q));
      });
    }
    // Lấy chữ đang có trong ô (kể cả gõ dở) ghi vào bài đang làm.
    function sync() {
      var cur = readRun();
      if (!cur || cur.id !== ex.id) return null;
      cur.texts = cur.texts || {};
      root.querySelectorAll('[data-key]').forEach(function (el) { cur.texts[el.getAttribute('data-key')] = el.value; });
      writeRun(cur);
      run = cur;
      return cur;
    }
    function tick() {
      var left = run.deadline - Date.now();
      if (left <= 0) { stop(); submit(ex, sync() || run, true); return; }
      timerEl.textContent = '⏱ ' + fmt(left);
      timerEl.classList.toggle('warn', left <= WARN_MS);
    }
    var iv = setInterval(tick, 1000);
    function stop() { clearInterval(iv); document.body.classList.remove('exam-mode'); }
    HD.setCleanup(stop);
    paintCount(); tick();

    root.addEventListener('input', function (e) {
      var el = e.target.closest('[data-key]');
      if (!el) return;
      if (!sync()) { location.replace('#/thi-thu/' + ex.id); return; }
      if (el.tagName === 'TEXTAREA') {
        var q = all.filter(function (x) { return String(x.q.n) === el.getAttribute('data-key'); })[0].q;
        var c = countText(q, el.value), cnt = document.getElementById('cnt-' + q.n);
        cnt.innerHTML = c.html; cnt.classList.toggle('ok', c.ok);
      }
      paintCount();
    });
    root.addEventListener('click', function (e) {
      var j = e.target.closest('[data-jump]');
      if (j) {
        var el = document.getElementById('q-' + j.getAttribute('data-jump'));
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      }
      if (e.target.id === 'submitBtn' || e.target.id === 'submitBtn2') return askSubmit();
      if (e.target.id === 'confirmYes') { stop(); return submit(ex, sync() || run, false); }
      if (e.target.id === 'confirmNo') { document.getElementById('confirmBox').hidden = true; return; }
    });
    function askSubmit() {
      sync();
      var left = total - done();
      var box = document.getElementById('confirmBox');
      box.innerHTML = '<p><b>' + (left ? 'Còn ' + left + ' câu chưa viết (0 điểm).' : 'Bạn đã viết đủ ' + total + ' câu.') + '</b> Nộp bài bây giờ? Nộp xong không sửa được nữa.</p>' +
        '<div class="actions"><button type="button" class="btn ghost" id="confirmNo">Viết tiếp</button><button type="button" class="btn" id="confirmYes">Nộp bài</button></div>';
      box.hidden = false;
      box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function submitWrite(ex, run, timeUp) {
    var texts = {};
    Object.keys(run.texts || {}).forEach(function (k) { var t = String(run.texts[k] || ''); if (t.trim()) texts[k] = t.slice(0, 2000); });
    var sc = vietScore(ex, texts, {});
    var end = Math.min(Date.now(), run.deadline);
    var secs = Math.max(0, Math.round((end - run.startedAt) / 1000));
    var s = store();
    var prev = s.exams[ex.id] || {};
    var pb = prev.best || 0;
    s.exams[ex.id] = { best: Math.max(pb, sc.pts), pb: pb, last: sc.pts, at: Date.now(), n: (prev.n || 0) + 1, secs: secs, texts: texts, self: {} };
    var xp = Object.keys(texts).length ? XP_VIET : 0;
    s.xp += xp;
    var d = L().today();
    if (s.days.indexOf(d) < 0) s.days.push(d);
    s.days = s.days.slice(-400);
    L().writeStore(s);
    writeRun(null);
    fresh({ id: ex.id, xp: xp, timeUp: !!timeUp });
    HD.track('exam_submit', { exam_id: ex.id, score: sc.pts, questions: flat(ex).length, time_up: !!timeUp });
    document.body.classList.remove('exam-mode');
    var target = '#/thi-thu/' + ex.id + '/ket-qua';
    if (location.hash === target) HD.refresh(); else location.replace(target);
  }

  // ---------- phần Viết: kết quả + tự chấm ----------
  function lvButtons(key, levels, max, cur) {
    return '<div class="sg-row" role="group">' + levels.map(function (lv) {
      var on = cur === lv.v;
      return '<button type="button" class="sg" data-k="' + esc(key) + '" data-v="' + lv.v + '" aria-pressed="' + on + '">' + lv.t + ' <b>' + Math.round(lv.v * max) + '</b></button>';
    }).join('') + '</div>';
  }
  function pendingText(n) {
    return n ? '✍️ Còn <b>' + n + '</b> mục chưa tự chấm: so bài của bạn với đáp án, bài mẫu rồi bấm mức phù hợp.' : '✅ Đã chấm xong tất cả các mục.';
  }
  function renderWriteResult(app, ex) {
    var s = store(), r = s.exams[ex.id];
    if (!r || !r.texts || typeof r.texts !== 'object') { location.replace('#/thi-thu/' + ex.id); return; }
    document.title = 'Kết quả ' + ex.title + ' – Hana Dul';
    var f = fresh();
    if (f && f.id !== ex.id) f = null;
    var texts = r.texts, self = r.self || {};
    var sc = vietScore(ex, texts, self), max = maxScore(ex);
    var h = '<div class="container narrow">' + hero('Kết quả: ' + ex.title, '', '결과');
    if (f && f.timeUp) h += '<p class="form-msg bad" id="timeUpMsg" role="status">⏰ Hết giờ, bài đã tự động nộp.</p>';
    h += '<div class="panel exam-score"><div class="big-emoji">✍️</div>' +
      '<h2><span id="scoreTotal">' + sc.pts + '</span>/' + max + ' điểm</h2>' +
      '<p class="muted">Thời gian làm: ' + mins(r.secs || 0) + ' / ' + ex.minutes + ' phút · Cao nhất: <span id="scoreBest">' + r.best + '</span>/' + max + (f && f.xp ? ' · ⭐ +' + f.xp + ' XP' : '') + '</p>' +
      '<p class="wr-pending" id="pendingMsg" role="status">' + pendingText(sc.pending) + '</p>' +
      '<p class="muted small-note">Điểm tự chấm chỉ để bạn theo dõi tiến bộ, không phải điểm TOPIK chính thức. Chấm khắt khe với chính mình sẽ thấy rõ chỗ cần luyện.</p>' +
      '<div class="actions"><a class="btn ghost" href="#/thi-thu">Danh sách đề</a><a class="btn" href="#/thi-thu/' + esc(ex.id) + '">🔁 Làm lại đề</a></div>' + shareRow() + '</div>';
    h += '<div class="exam-review wr-review"><h2>Chấm từng câu</h2>';
    ex.sets.forEach(function (st, si) {
      var rg = rangeOf(ex, si);
      if (rg.start === si) h += '<h3 class="ex-inst ko">[' + rg.text + '] ' + gap(esc(st.instruction)) + '</h3>';
      st.questions.forEach(function (q) {
        var its = items(q, texts, self);
        var qp = its.reduce(function (a, it) { return a + itemPts(it); }, 0);
        h += '<section class="ex-set wr-rev" id="r-' + q.n + '" data-q="' + q.n + '"><p class="ex-qtext"><b>' + q.n + '.</b> ' + (q.q ? kq(q.q) : '') +
          ' <span class="wr-qpts"><b data-qpts="' + q.n + '">' + Math.round(qp) + '</b>/' + q.points + ' điểm</span></p>';
        if (q.kind === 'fill') {
          h += '<div class="ex-passage ko">' + passageHtml(q.passage) + '</div>';
          if (q.passageVi) h += '<details class="ex-vi"><summary>Dịch đoạn văn</summary><p>' + L().ko(q.passageVi) + '</p></details>';
          q.blanks.forEach(function (b, bi) {
            var it = its[bi], t = texts[it.key] || '';
            h += '<div class="wr-item" data-item="' + esc(it.key) + '"><p><span class="wr-mark ko">' + esc(b.mark) + '</span> ' +
              (it.empty ? '<span class="muted">⬜ Bỏ trống · 0 điểm</span>' : '<b class="ko wr-ans">' + esc(t) + '</b>') + '</p>' +
              '<p class="muted small">Đáp án mẫu: <span class="ko">' + b.answers.slice(0, 4).map(esc).join(' / ') + '</span></p>';
            if (it.auto != null) h += '<p class="wr-auto">✅ Khớp đáp án mẫu · ' + it.max + ' điểm</p>';
            else if (!it.empty) h += '<p class="small">Tự chấm ô ' + esc(b.mark) + ':</p>' + lvButtons(it.key, BLANK_LV, it.max, self[it.key]);
            h += '</div>';
          });
        } else {
          var t = texts[String(q.n)] || '', c = countText(q, t);
          h += dataBox(q);
          if (q.dataVi) h += '<details class="ex-vi"><summary>Dịch đề</summary><p>' + L().ko(q.dataVi) + '</p></details>';
          if (!t.trim()) h += '<p class="muted">⬜ Bạn chưa viết câu này · 0 điểm</p>';
          else h += '<p class="small">Bài của bạn · <span class="wr-count' + (c.ok ? ' ok' : '') + '">' + c.html + '</span>' + (c.ok ? '' : ' <span class="bad-text">(chưa đúng độ dài, trừ điểm Ngôn ngữ)</span>') + '</p><div class="wr-mine ko">' + esc(t) + '</div>';
          h += '<details class="wr-sample"><summary>📄 Bài mẫu (' + charCount(q.sample) + ' ký tự)</summary><div class="wr-mine ko">' + esc(q.sample) + '</div></details>';
          if (!its[0].empty) {
            h += '<div class="wr-rubric"><p class="small"><b>Tự chấm theo 3 tiêu chí</b> (giống cách chấm TOPIK):</p>' + q.rubric.map(function (rb, i) {
              var it = its[i];
              return '<div class="wr-item" data-item="' + esc(it.key) + '"><p><b>' + esc(rb.label) + '</b> · ' + rb.points + ' điểm<br><span class="muted small">' + L().ko(rb.desc) + '</span></p>' +
                lvButtons(it.key, RUB_LV, rb.points, self[it.key]) + '</div>';
            }).join('') + '</div>';
          }
          if (q.tips) h += '<p class="ex-explain">💡 ' + L().ko(q.tips) + '</p>';
        }
        if (q.explain) h += '<p class="ex-explain">💡 ' + L().ko(q.explain) + '</p>';
        h += '</section>';
      });
    });
    app.innerHTML = h + '</div></div>';
    // Điểm tự chấm có thể đổi sau khi vẽ: tính lại lúc bấm.
    bindShare(app, function () {
      var cur = store().exams[ex.id] || r;
      var sc3 = vietScore(ex, cur.texts || {}, cur.self || {});
      return { kind: 'thi-thu', emoji: '✍️', kicker: 'Đề thi thử TOPIK II · Viết', title: ex.title,
        big: sc3.pts + '/' + max, bigLabel: 'điểm' + (sc3.pending ? ' (còn ' + sc3.pending + ' mục chưa tự chấm)' : ' tự chấm'), stats: [['⏱', mins(cur.secs || 0)]] };
    });

    app.querySelector('.wr-review').addEventListener('click', function (e) {
      var b = e.target.closest('.sg');
      if (!b) return;
      var k = b.getAttribute('data-k'), v = +b.getAttribute('data-v');
      var st = store(), e2 = st.exams[ex.id];
      if (!e2 || !e2.texts) return;
      e2.self = e2.self || {};
      if (e2.self[k] === v) delete e2.self[k]; else e2.self[k] = v;
      var sc2 = vietScore(ex, e2.texts, e2.self);
      e2.last = sc2.pts;
      e2.best = Math.max(e2.pb || 0, sc2.pts);
      e2.gat = Date.now();
      L().writeStore(st);
      b.parentNode.querySelectorAll('.sg').forEach(function (x) { x.setAttribute('aria-pressed', String(e2.self[k] === +x.getAttribute('data-v'))); });
      var qn = k.split('-')[0];
      var q = flat(ex).filter(function (x) { return String(x.q.n) === qn; })[0].q;
      var qp = items(q, e2.texts, e2.self).reduce(function (a, it) { return a + itemPts(it); }, 0);
      app.querySelector('[data-qpts="' + qn + '"]').textContent = Math.round(qp);
      document.getElementById('scoreTotal').textContent = sc2.pts;
      document.getElementById('scoreBest').textContent = e2.best;
      document.getElementById('pendingMsg').innerHTML = pendingText(sc2.pending);
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
