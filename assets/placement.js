/* Bài kiểm tra xếp lớp (#/xep-lop): khoảng 5–8 phút, gợi ý cấp độ và bài nên bắt đầu.
   Dữ liệu: data/placement.json — các phần theo cấp (sc1 → sc2 → tc3 → topik), mỗi câu gắn mã bài (l) dạy kiến thức đó,
   đáp án đúng đứng đầu options (web tự xáo). Làm lần lượt từng phần; phần nào đúng dưới `pass` câu thì dừng:
   gợi ý cấp đó, bắt đầu từ bài sớm nhất có câu sai. Qua hết thì gợi ý Trung cấp + đề thi thử.
   Không ghi Sổ câu sai, không cộng XP. Kết quả lưu vào tiến độ (hanadul:v2 → placement { level, lesson, at, score })
   để nút "Bắt đầu học" ở trang chủ đi thẳng tới bài được gợi ý. Cần assets/app.js (HD.lib). */
(function () {
  'use strict';

  var HD = window.HD = window.HD || {};
  var SKIP = '__skip__';
  function L() { return HD.lib; }
  function esc(s) { return L().esc(s); }

  function hero(sub) {
    return '<div class="lesson-hero" data-ko="반 배정"><div class="crumbs"><a href="#/">Trang chủ</a></div>' +
      '<h1><span class="emoji">🧭</span>Kiểm tra xếp lớp</h1><p>' + sub + '</p></div>';
  }

  // Từ kết quả từng phần → cấp, bài gợi ý và các bài nên ôn.
  function decide(data, idx, answers) {
    var order = L().allLessons(idx).map(function (x) { return x.lesson.id; });
    var pos = function (id) { var i = order.indexOf(id); return i < 0 ? 1e9 : i; };
    var score = {}, stop = null, weak = [];
    data.blocks.forEach(function (b, bi) {
      if (stop) return;
      var a = answers[bi];
      if (!a) return;
      var ok = 0, wrongL = [];
      b.questions.forEach(function (q, qi) { if (a[qi] === q.options[0]) ok++; else if (q.l !== 'topik') wrongL.push(q.l); });
      score[b.level] = ok;
      if (ok < data.pass) stop = { block: b, wrong: wrongL };
      else weak = weak.concat(wrongL);
    });
    var level, lesson;
    if (stop && stop.block.level !== 'topik') {
      level = stop.block.level;
      var ws = stop.wrong.slice().sort(function (x, y) { return pos(x) - pos(y); });
      lesson = ws[0] || stop.block.questions[0].l;
    } else {
      // Qua hết Trung cấp: bài Trung cấp sớm nhất còn sai, không có thì bài Trung cấp mới nhất.
      level = stop ? 'tc3' : 'topik';
      var tcWrong = weak.filter(function (l) { return /^tc/.test(l); }).sort(function (x, y) { return pos(x) - pos(y); });
      var tcAll = order.filter(function (id) { return /^tc/.test(id); });
      lesson = tcWrong[0] || tcAll[tcAll.length - 1];
    }
    weak = weak.filter(function (l, i, arr) { return arr.indexOf(l) === i && l !== lesson && pos(l) < pos(lesson); })
      .sort(function (x, y) { return pos(x) - pos(y); });
    if (order.indexOf(lesson) < 0) lesson = order[0];
    return { level: level, lesson: lesson, score: score, weak: weak.slice(0, 4) };
  }

  function renderIntro(app, data) {
    document.title = 'Kiểm tra xếp lớp – Hana Dul';
    var s = L().readStore();
    var total = data.blocks.reduce(function (a, b) { return a + b.questions.length; }, 0);
    var h = '<div class="container narrow">' + hero('Trả lời vài câu từ dễ tới khó để biết nên bắt đầu ở cấp nào, bài nào. Miễn phí, không cần đăng nhập.') +
      '<div class="panel pl-intro"><h2>Cách làm</h2><ul class="exam-rules">' +
      '<li>🪜 Có ' + data.blocks.length + ' phần từ dễ tới khó: ' + data.blocks.map(function (b) { return '<b>' + esc(b.name) + '</b>'; }).join(' → ') + ', mỗi phần ' + data.blocks[0].questions.length + ' câu.</li>' +
      '<li>⏩ Đúng từ ' + data.pass + ' câu trở lên thì lên phần khó hơn; chưa đạt thì dừng ở đó. Nhiều nhất ' + total + ' câu, khoảng 5–8 phút.</li>' +
      '<li>🤔 Không biết thì bấm <b>Tôi chưa học</b>, đừng đoán để kết quả sát với bạn.</li>' +
      '<li>🔒 Không tính điểm, không ghi vào Sổ câu sai.</li></ul>';
    if (s.placement && s.placement.lesson) {
      h += '<p class="muted" id="plLast">Lần trước gợi ý bắt đầu từ: <b>' + esc(nameOf(s.placement.lesson)) + '</b> · <a href="#/xep-lop/ket-qua">Xem lại kết quả</a></p>';
    }
    h += '<div class="actions"><button type="button" class="btn" id="plStart">Bắt đầu →</button>' +
      '<a class="btn ghost" id="plZero" href="#/bai/sc1-00">Tôi chưa biết chữ Hàn</a></div></div></div>';
    app.innerHTML = h;
    document.getElementById('plStart').addEventListener('click', function () {
      HD.track('placement_start', {});
      run(app, data);
    });
    document.getElementById('plZero').addEventListener('click', function () {
      save({ level: 'sc1', lesson: 'sc1-00', score: {}, weak: [] });
    });
  }

  var names = {};
  function nameOf(id) { return names[id] || id; }
  function save(res) {
    var s = L().readStore();
    s.placement = { level: res.level, lesson: res.lesson, at: Date.now(), score: res.score, weak: res.weak };
    L().writeStore(s);
  }

  function run(app, data) {
    var bi = 0, qi = 0, answers = [], order = [];
    document.body.classList.add('quiz-mode');
    var total = data.blocks.reduce(function (a, b) { return a + b.questions.length; }, 0);
    var done = 0;
    function show() {
      var b = data.blocks[bi], q = b.questions[qi];
      if (!order[bi]) order[bi] = b.questions.map(function (x) { return L().shuffle(x.options); });
      var opts = order[bi][qi];
      var pct = Math.round(done / total * 100);
      var h = '<div class="quiz pl-quiz"><div class="qbar"><a class="qclose" href="#/xep-lop" aria-label="Thoát">✕</a>' +
        '<div class="qprog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '"><span style="width:' + pct + '%"></span></div>' +
        '<div class="combo pl-step">' + (bi + 1) + '/' + data.blocks.length + '</div></div>' +
        '<span class="qsection">🧭 Phần ' + (bi + 1) + ' · ' + esc(b.name) + ' · câu ' + (qi + 1) + '/' + b.questions.length + '</span><div class="qcard">';
      if (q.passage) h += '<div class="passage ko-block">' + L().ko(q.passage) + '</div>';
      h += '<div class="qtext"><span style="flex:1">' + L().koq(q.q) + '</span></div><div class="opts" role="group" aria-label="Các đáp án">';
      opts.forEach(function (o, i) { h += '<button type="button" class="opt" data-o="' + i + '"><span class="key">' + (i + 1) + '</span><span>' + L().koq(o) + '</span></button>'; });
      h += '<button type="button" class="opt pl-skip" data-o="skip"><span class="key">?</span><span>Tôi chưa học</span></button></div></div></div>';
      app.innerHTML = h;
    }
    function choose(v) {
      var b = data.blocks[bi];
      (answers[bi] = answers[bi] || [])[qi] = v === 'skip' ? SKIP : order[bi][qi][+v];
      done++; qi++;
      if (qi >= b.questions.length) {
        var ok = b.questions.filter(function (q, i) { return answers[bi][i] === q.options[0]; }).length;
        if (ok < data.pass || bi === data.blocks.length - 1) return finish();
        bi++; qi = 0;
      }
      show();
      window.scrollTo(0, 0);
    }
    function onClick(e) {
      var o = e.target.closest('.opt');
      if (o) choose(o.getAttribute('data-o'));
    }
    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (/^[1-4]$/.test(e.key)) { e.preventDefault(); choose(String(+e.key - 1)); }
    }
    app.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    function stop() { app.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); }
    HD.setCleanup(stop);
    function finish() {
      stop();
      app.innerHTML = '<div class="container narrow"><div class="panel pl-wait" style="margin-top:14px"><div class="big-emoji">🧭</div><p class="muted">Đang xem kết quả…</p></div></div>';
      L().getIndex().then(function (idx) {
        var res = decide(data, idx, answers);
        save(res);
        last = { answers: answers };
        HD.track('placement_complete', { level: res.level, lesson_id: res.lesson });
        if (location.hash === '#/xep-lop/ket-qua') HD.refresh(); else location.hash = '#/xep-lop/ket-qua';
      });
    }
    show();
  }
  var last = null; // đáp án lượt vừa làm (chỉ giữ trong phiên để xem lại câu sai)

  function renderResult(app, data, idx) {
    var s = L().readStore(), p = s.placement;
    if (!p || !p.lesson) { location.replace('#/xep-lop'); return; }
    document.title = 'Kết quả xếp lớp – Hana Dul';
    var found = L().findLesson(idx, p.lesson);
    var lvName = { sc1: 'Sơ cấp 1', sc2: 'Sơ cấp 2', tc3: 'Trung cấp 3', topik: 'Trung cấp, sẵn sàng luyện đề TOPIK II' }[p.level] || p.level;
    var h = '<div class="container narrow">' + hero('Gợi ý dựa trên câu trả lời của bạn. Bạn vẫn có thể mở bất kỳ bài nào.') +
      '<div class="panel pl-result"><div class="big-emoji">' + (p.level === 'topik' ? '🏆' : p.level === 'tc3' ? '🚀' : p.level === 'sc2' ? '🌱' : '👋') + '</div>' +
      '<p class="muted" style="margin:0">Trình độ gợi ý</p><h2 id="plLevel">' + esc(lvName) + '</h2>';
    if (found) {
      h += '<a class="continue pl-start" id="plLesson" href="#/bai/' + esc(p.lesson) + '"><span class="emoji">' + esc(found.lesson.icon || '📘') + '</span>' +
        '<span><span class="label">Nên bắt đầu từ</span><br><span class="title">' + esc(L().fullName(found)) + '</span></span><span class="go">→</span></a>';
    }
    h += '<div class="pl-bars">' + data.blocks.map(function (b) {
      var sc = p.score && p.score[b.level];
      var n = b.questions.length;
      return '<div class="pl-bar' + (sc == null ? ' off' : sc >= data.pass ? ' ok' : ' low') + '"><span class="pl-bar-name">' + esc(b.name) + '</span>' +
        '<span class="pl-bar-track"><span style="width:' + (sc == null ? 0 : Math.round(sc / n * 100)) + '%"></span></span>' +
        '<span class="pl-bar-num">' + (sc == null ? 'chưa làm' : sc + '/' + n) + '</span></div>';
    }).join('') + '</div>';
    if (p.weak && p.weak.length) {
      h += '<p class="muted pl-weak">Nên xem lại: ' + p.weak.map(function (id) { return '<a href="#/bai/' + esc(id) + '">' + esc(nameOf(id)) + '</a>'; }).join(', ') + '</p>';
    }
    if (p.level === 'topik' || p.level === 'tc3') h += '<p class="muted">Muốn thử sức như thi thật? <a href="#/thi-thu">Làm đề thi thử TOPIK II</a>.</p>';
    h += '<div class="actions"><a class="btn ghost" href="#/xep-lop">🔁 Làm lại</a>' + (found ? '<a class="btn" href="#/bai/' + esc(p.lesson) + '">Bắt đầu học →</a>' : '<a class="btn" href="#/">Về trang chủ</a>') + '</div></div>';
    if (last) {
      var rows = '';
      data.blocks.forEach(function (b, bi) {
        (last.answers[bi] || []).forEach(function (a, qi) {
          var q = b.questions[qi];
          if (a === q.options[0]) return;
          rows += '<li><span class="wb-q">' + L().koq(q.q) + (q.passage ? ' · <span class="ko">' + esc(q.passage.slice(0, 40)) + '…</span>' : '') + '</span>' +
            '<span class="wb-a">→ ' + L().koq(q.options[0]) + '</span><span class="wb-n">' + L().ko(q.explain) + '</span></li>';
        });
      });
      if (rows) h += '<details class="wb-group pl-review"><summary class="group-title">Xem các câu chưa đúng</summary><ul class="wb-list">' + rows + '</ul></details>';
    }
    app.innerHTML = h + '</div>';
  }

  HD.renderPlacement = function (app, parts) {
    Promise.all([L().loadJSON('data/placement.json'), L().getIndex()]).then(function (res) {
      L().allLessons(res[1]).forEach(function (x) { names[x.lesson.id] = L().fullName(x); });
      if (parts[0] === 'ket-qua') return renderResult(app, res[0], res[1]);
      renderIntro(app, res[0]);
    }).catch(function (e) { L().fail(e); });
  };

  // Trang chủ: người mới (chưa làm bài nào, chưa xếp lớp) được mời làm bài xếp lớp.
  HD.placementHomeCard = function (s) {
    if (s.placement && s.placement.lesson) return '';
    if (Object.keys(s.lessons || {}).length >= 2) return '';
    return '<a class="continue pl-card" href="#/xep-lop"><span class="emoji">🧭</span>' +
      '<span><span class="label">Đã học tiếng Hàn rồi?</span><br><span class="title">Kiểm tra xếp lớp 5 phút</span></span><span class="go">→</span></a>';
  };
})();
