(function () {
  'use strict';

  var app = document.getElementById('app');
  var STORE_KEY = 'hanadul:v2';
  var QUICK_VOCAB = 10;
  var QUICK_USAGE = 3;
  var QUICK_PER_PATTERN = 2;
  var QUICK_LISTEN = 3;
  var REVIEW_MAX = 20;
  var SECTIONS = {
    vocab: { tag: '📚 Từ vựng', cls: '' },
    usage: { tag: '📝 Từ trong câu', cls: '' },
    grammar: { tag: '🧩', cls: ' g' },
    listen: { tag: '🎧 Nghe', cls: ' l' },
    read: { tag: '📖 Đọc hiểu', cls: ' r' }
  };
  var cache = {};
  var indexData = null;
  // Đo lượt truy cập và form đăng ký (assets/site.js). Thiếu file thì mọi thứ vẫn chạy.
  var HD = window.HD = window.HD || {};
  ['track', 'pageview'].forEach(function (k) { if (!HD[k]) HD[k] = function () {}; });
  if (!HD.signupHtml) HD.signupHtml = function () { return ''; };

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Bọc các đoạn chữ Hàn bằng span để dùng font tiếng Hàn.
  function ko(s) {
    return esc(s).replace(/([ᄀ-ᇿ㄰-㆏가-힯][ᄀ-ᇿ㄰-㆏가-힯\s.,?!~()\-/]*)/g, '<span class="ko">$1</span>');
  }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function loadJSON(url) {
    if (cache[url]) return Promise.resolve(cache[url]);
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.json();
    }).then(function (j) { cache[url] = j; return j; });
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------- progress store ----------
  function readStore() {
    var s;
    try { s = JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { s = null; }
    s = s || {};
    s.lessons = s.lessons || {};
    s.xp = s.xp || 0;
    s.days = s.days || [];
    s.last = s.last || null;
    s.wrong = s.wrong || {};
    s.writing = s.writing || {};
    s.wrongDel = s.wrongDel || {};
    s.writingAt = s.writingAt || {};
    return s;
  }
  function writeStore(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* chế độ ẩn danh */ }
    // Đã đăng nhập thì đẩy thay đổi lên tài khoản (assets/account.js).
    if (HD.onLocalChange) HD.onLocalChange();
  }
  function streakOf(days) {
    if (!days.length) return 0;
    var set = {};
    days.forEach(function (d) { set[d] = 1; });
    var d = new Date();
    var key = function (x) { return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
    if (!set[key(d)]) { d.setDate(d.getDate() - 1); if (!set[key(d)]) return 0; }
    var n = 0;
    while (set[key(d)]) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  // Mã ổn định cho mỗi câu hỏi, dùng cho Sổ câu sai.
  function qid(q) {
    var str = q.lid + '|' + q.kind + '|' + (q.listen || '') + '|' + q.q + '|' + q.answer;
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  function snapshot(q) {
    var o = {};
    ['lid', 'kind', 'pattern', 'q', 'options', 'answer', 'explain', 'say', 'sayAnswer', 'listen', 'passage', 'passageVi'].forEach(function (k) {
      if (q[k] != null) o[k] = q[k];
    });
    return o;
  }
  function wrongCount(s) { return Object.keys(s.wrong).length; }
  function starsFor(pct) { return pct >= 90 ? 3 : pct >= 70 ? 2 : pct >= 50 ? 1 : 0; }
  function starsHtml(n) {
    var h = '';
    for (var i = 0; i < 3; i++) h += '<span class="' + (i < n ? '' : 'off') + '">⭐</span>';
    return h;
  }
  function renderStats() {
    var s = readStore();
    var streak = streakOf(s.days);
    document.getElementById('stats').innerHTML =
      '<span class="stat fire" title="Chuỗi ngày học liên tiếp">🔥 ' + streak + '</span>' +
      '<span class="stat xp" title="Điểm kinh nghiệm">⭐ ' + s.xp + '</span>' +
      (wrongCount(s) ? '<a class="stat book" href="#/so-cau-sai" title="Sổ câu sai">📒 ' + wrongCount(s) + '</a>' : '');
    if (HD.renderAccountBadge) HD.renderAccountBadge();
  }
  // Tiến độ vừa được gộp từ tài khoản: vẽ lại màn hiện tại (trừ lúc đang làm bài hoặc đang ở trang học có ô viết).
  HD.refresh = function () {
    if (document.body.classList.contains('quiz-mode')) return renderStats();
    var h = location.hash;
    if (/^#\/bai\/[^/]+\/?$/.test(h) && document.activeElement && document.activeElement.id === 'wtext') return renderStats();
    route(true);
  };

  // ---------- speech ----------
  var koVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    koVoice = speechSynthesis.getVoices().filter(function (v) { return /^ko/i.test(v.lang); })[0] || null;
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  var warnedVoice = false;
  function speak(text, rate) {
    if (!('speechSynthesis' in window)) { toast('Trình duyệt này không hỗ trợ đọc to.'); return; }
    if (!koVoice) pickVoice();
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR'; u.rate = rate || 0.85;
    if (koVoice) u.voice = koVoice;
    else if (!warnedVoice) { warnedVoice = true; toast('Máy chưa có giọng đọc tiếng Hàn, âm có thể không chuẩn.'); }
    speechSynthesis.speak(u);
  }
  function speakBtn(text) {
    return '<button type="button" class="speak" data-say="' + esc(text) + '" aria-label="Nghe ' + esc(text) + '" title="Nghe">🔊</button>';
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-say]');
    if (b) { e.preventDefault(); e.stopPropagation(); speak(b.getAttribute('data-say')); }
  });

  // ---------- routing ----------
  var cleanup = null;
  function route(silent) {
    if (cleanup) { cleanup(); cleanup = null; }
    document.body.classList.remove('quiz-mode');
    var parts = location.hash.replace(/^#\/?/, '').split('/');
    if (silent !== true && !/^lo-trinh/.test(parts[0])) window.scrollTo(0, 0);
    renderStats();
    // Đợi trang đặt document.title rồi mới ghi lượt xem.
    if (silent !== true) setTimeout(function () { HD.pageview(document.title); }, 400);
    if (parts[0] === 'tai-khoan' && HD.renderAccountPage) return HD.renderAccountPage(app);
    if (parts[0] === 'bai' && parts[1]) return renderLesson(parts[1], parts[2] || 'hoc');
    if (parts[0] === 'so-cau-sai') return renderWrongBook();
    return renderHome(/^lo-trinh/.test(parts[0]) ? parts[0] : null);
  }
  window.addEventListener('hashchange', function () { route(); });
  // Nút "Xem lộ trình" và nút chọn cấp: đang ở trang chủ thì cuộn thẳng tới khối, không vẽ lại trang.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#lo-trinh"]');
    if (!a) return;
    var el = document.getElementById(a.getAttribute('href').slice(1));
    if (!el) return;
    e.preventDefault();
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  function getIndex() {
    if (indexData) return Promise.resolve(indexData);
    return loadJSON('data/index.json').then(function (d) { indexData = d; return d; });
  }
  function allLessons(idx) {
    var out = [];
    idx.levels.forEach(function (lv) { lv.lessons.forEach(function (l) { out.push({ level: lv, lesson: l }); }); });
    return out;
  }
  function findLesson(idx, id) {
    var all = allLessons(idx);
    for (var i = 0; i < all.length; i++) if (all[i].lesson.id === id) return { level: all[i].level, lesson: all[i].lesson, next: all[i + 1] && all[i + 1].lesson };
    return null;
  }
  function lessonName(l) { return l.no === '0' ? l.title : 'Bài ' + l.no + ': ' + l.title; }
  // Tên kèm cấp độ (từ Sơ cấp 2 trở đi) để không nhầm "Bài 1" của hai cấp.
  function fullName(x) { return x.level && x.level.prefix ? x.level.name + ' · ' + lessonName(x.lesson) : lessonName(x.lesson); }
  function fail(err) {
    app.innerHTML = '<div class="container narrow" style="padding:40px 16px"><h1>Không tải được nội dung</h1><p class="muted">' + esc(err.message || err) + '</p><p><a href="#/">Về trang chủ</a></p></div>';
  }

  // ---------- home ----------
  function renderHome(jump) {
    document.title = 'Hana Dul – Học tiếng Hàn miễn phí';
    getIndex().then(function (idx) {
      var s = readStore();
      var all = allLessons(idx);
      var nextUp = all.filter(function (x) { return !(s.lessons[x.lesson.id] && s.lessons[x.lesson.id].best >= 70); })[0] || all[all.length - 1];
      var lastId = s.last && all.filter(function (x) { return x.lesson.id === s.last; })[0];
      var startHref = '#/bai/' + nextUp.lesson.id;

      var h = '<section class="hero"><div class="container hero-grid"><div>' +
        '<span class="pill">✨ Miễn phí · Không cần đăng ký</span>' +
        '<h1>Học tiếng Hàn<br><span class="hl">từng bước một</span></h1>' +
        '<p class="lead"><b>Hana Dul</b> <span class="ko">(하나 둘)</span> nghĩa là “một, hai”. Mỗi ngày một bài ngắn: học từ mới, nắm ngữ pháp, làm trắc nghiệm có giải thích ngay.</p>' +
        '<div class="hero-actions"><a class="btn" href="' + startHref + '">' + (lastId ? 'Học tiếp' : 'Bắt đầu học') + ' →</a>' +
        '<a class="btn ghost" href="#lo-trinh">Xem lộ trình</a></div>' +
        '<p class="hero-more"><a href="gioi-thieu.html">Hana Dul là gì, học thế nào? →</a></p>' +
        '<div class="hero-facts"><div><b>' + all.length + '</b>bài học</div><div><b>40+</b>từ mỗi bài</div><div><b>🔊</b>nghe phát âm</div></div>' +
        '</div><div class="hero-art" aria-hidden="true">' +
        '<div class="art-card art-main"><div><div class="big">하나 둘</div><div class="small">một · hai</div></div></div>' +
        '<span class="chip-float c1 ko">안녕하세요! 👋</span>' +
        '<span class="chip-float c2 ko">감사합니다 🙏</span>' +
        '<span class="chip-float c3 ko">한국어 💬</span>' +
        '</div></div></section>';

      h += '<div class="container narrow">';
      if (lastId) {
        var lp = s.lessons[lastId.lesson.id];
        h += '<a class="continue" href="#/bai/' + esc(lastId.lesson.id) + '/lam-bai"><span class="emoji">' + esc(lastId.lesson.icon || '📘') + '</span>' +
          '<span><span class="label">Bài gần nhất' + (lp ? ' · đúng ' + lp.best + '%' : '') + '</span><br><span class="title">' + esc(fullName(lastId)) + '</span></span><span class="go">→</span></a>';
      }

      var nw = wrongCount(s);
      if (nw) {
        h += '<a class="continue book" href="#/so-cau-sai"><span class="emoji">📒</span>' +
          '<span><span class="label">Sổ câu sai</span><br><span class="title">' + nw + ' câu cần ôn lại</span></span><span class="go">→</span></a>';
      }
      if (HD.accountHomeCard) h += HD.accountHomeCard(!!(s.xp || s.days.length));

      if (idx.levels.length > 1) {
        h += '<div id="lo-trinh" class="level-jump" aria-label="Chọn cấp độ">' + idx.levels.map(function (lv) {
          return '<a href="#lo-trinh-' + esc(lv.id) + '"><span>' + esc(lv.icon || '📘') + '</span>' + esc(lv.name) + '</a>';
        }).join('') + '</div>';
      }
      idx.levels.forEach(function (lv, li) {
        var done = lv.lessons.filter(function (l) { return s.lessons[l.id] && s.lessons[l.id].best >= 70; }).length;
        var last = li === idx.levels.length - 1;
        h += '<section class="level level-' + esc(lv.id) + '" id="lo-trinh-' + esc(lv.id) + '"' + (idx.levels.length > 1 ? '' : ' data-only="1"') + '>' +
          '<div class="section-head level-head"' + (idx.levels.length > 1 ? '' : ' id="lo-trinh"') + '><div>' +
          '<span class="level-badge">' + esc(lv.icon || '📘') + ' Cấp ' + (li + 1) + (lv.status ? ' · ' + esc(lv.status) : '') + '</span>' +
          '<h2>' + esc(lv.name) + '</h2>' + (lv.subtitle ? '<p>' + esc(lv.subtitle) + '</p>' : '') + '</div>' +
          '<span class="level-progress">' + done + '/' + lv.lessons.length + ' bài</span></div><ol class="path">';
        lv.lessons.forEach(function (l) {
          var p = s.lessons[l.id];
          var pct = p ? p.best : 0;
          h += '<li><a class="node' + (pct >= 70 ? ' done' : '') + '" href="#/bai/' + esc(l.id) + '">' +
            '<span class="ring" style="--p:' + pct + '"><span>' + esc(l.icon || '📘') + '</span></span>' +
            '<span class="node-body"><span class="node-top"><span class="node-no">' + (l.no === '0' ? 'Khởi động' : 'Bài ' + esc(l.no)) + '</span>' +
            '<span class="node-title">' + esc(l.title) + '</span><span class="node-ko ko">' + esc(l.ko) + '</span></span>' +
            '<span class="node-sum">' + ko(l.summary || '') + '</span></span>' +
            '<span class="stars" aria-label="' + (p ? p.stars : 0) + ' sao">' + starsHtml(p ? p.stars : 0) + '</span></a></li>';
        });
        if (last) h += '<li class="soon"><div class="node"><span class="ring"><span>🚧</span></span><span class="node-body"><span class="node-title">Bài tiếp theo</span><br><span class="node-sum">Đang soạn, sẽ cập nhật sớm</span></span></div></li>';
        h += '</ol></section>';
      });

      h += '<div class="features">' +
        feature('🎯', 'var(--primary-soft)', 'Làm từng câu một', 'Chọn đáp án là biết đúng sai ngay, kèm giải thích ngắn gọn. Câu sai được hỏi lại cuối bài.') +
        feature('🔥', 'var(--sun-soft)', 'Giữ chuỗi ngày học', 'Học mỗi ngày để giữ lửa. Điểm, sao và chuỗi ngày được lưu ngay trên máy bạn.') +
        feature('🎧', 'var(--accent-soft)', 'Nghe, đọc, viết', 'Mỗi bài có phần nghe, đoạn đọc hiểu và bài tập viết câu kèm câu mẫu để tự so.') +
        feature('📒', 'var(--sky-soft)', 'Sổ câu sai', 'Câu làm sai được lưu lại để ôn. Trả lời đúng 2 lần liên tiếp thì câu rời khỏi sổ.') +
        '</div>' + HD.signupHtml('trang-chu') + '</div>';
      app.innerHTML = h;
      var target = jump && document.getElementById(jump === 'lo-trinh' ? 'lo-trinh' : jump);
      if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
    }).catch(fail);
  }
  function feature(ic, bg, title, text) {
    return '<div class="feature"><div class="ic" style="background:' + bg + '">' + ic + '</div><h3>' + title + '</h3><p>' + text + '</p></div>';
  }

  // ---------- lesson ----------
  function renderLesson(id, tab) {
    Promise.all([getIndex(), loadJSON('data/lessons/' + id + '.json')]).then(function (res) {
      var found = findLesson(res[0], id);
      var data = res[1];
      if (tab === 'lam-bai') return renderQuizStart(data, found);
      renderStudy(data, found);
    }).catch(fail);
  }

  function lessonHero(data, found) {
    var l = found ? found.lesson : { no: '', title: data.title, ko: data.ko };
    var words = countWords(data);
    var gcount = (data.grammar || []).length;
    return '<div class="lesson-hero" data-ko="' + esc(data.ko) + '">' +
      '<div class="crumbs"><a href="#/">Trang chủ</a>' + (found ? ' / ' + esc(found.level.name) : '') + '</div>' +
      '<h1><span class="emoji">' + esc(l.icon || '📘') + '</span>' + esc(lessonName(l)) + ' <span class="ko" style="opacity:.85">' + esc(data.ko) + '</span></h1>' +
      (data.goal ? '<p>' + ko(data.goal) + '</p>' : '') +
      '<div class="meta-chips"><span>📚 ' + words + ' từ</span>' + (gcount ? '<span>🧩 ' + gcount + ' mẫu ngữ pháp</span>' : '') + '<span>⏱️ ~10 phút</span></div>' +
      '</div>';
  }
  function countWords(data) {
    var seen = {};
    data.vocab.forEach(function (g) { g.words.forEach(function (w) { seen[w[0]] = 1; }); });
    return Object.keys(seen).length;
  }
  function seg(id, cur) {
    return '<nav class="seg" aria-label="Chế độ"><a href="#/bai/' + esc(id) + '"' + (cur === 'hoc' ? ' aria-current="page"' : '') + '>📖 Học</a>' +
      '<a href="#/bai/' + esc(id) + '/lam-bai"' + (cur === 'lam-bai' ? ' aria-current="page"' : '') + '>✏️ Làm bài</a></nav>';
  }

  function renderStudy(data, found) {
    document.title = (found ? fullName(found) : data.title) + ' – Hana Dul';
    var h = '<div class="container narrow">' + lessonHero(data, found) + seg(data.id, 'hoc');
    h += '<div class="study-tools"><h2>Từ vựng</h2><label class="toggle"><input type="checkbox" id="hideVi"> Che nghĩa để tự kiểm tra</label></div>' +
      '<p class="muted" style="margin:0">Bấm vào thẻ để nghe phát âm' + ' (khi che nghĩa, bấm để mở nghĩa).</p><div id="vocab">';
    data.vocab.forEach(function (g) {
      h += '<div class="group-title">' + ko(g.group) + '</div><div class="cards">';
      g.words.forEach(function (w) {
        h += '<button type="button" class="wcard" data-word="' + esc(w[2] || w[0]) + '"><span class="w-ko">' + esc(w[0]) + '</span>' +
          '<span class="w-vi">' + ko(w[1]) + '</span><span class="w-say" aria-hidden="true">🔊</span></button>';
      });
      h += '</div>';
    });
    h += '</div>';
    if (data.grammar && data.grammar.length) {
      h += '<div class="study-tools"><h2>Ngữ pháp</h2></div>';
      data.grammar.forEach(function (g) { h += grammarNote(g); });
    }
    if (data.writing) h += '<div class="study-tools"><h2>Luyện viết</h2></div>' + writingBox(data);
    h += '<div class="cta-bar"><div><strong>Sẵn sàng chưa?</strong><br><span class="muted">Làm bài trắc nghiệm để nhận sao và điểm ⭐</span></div>' +
      '<a class="btn" href="#/bai/' + esc(data.id) + '/lam-bai">Làm bài →</a></div></div>';
    app.innerHTML = h;

    bindWriting(data);
    var vocab = document.getElementById('vocab');
    document.getElementById('hideVi').addEventListener('change', function (e) {
      vocab.classList.toggle('hide-vi', e.target.checked);
      vocab.querySelectorAll('.wcard').forEach(function (c) { c.classList.remove('reveal'); });
    });
    vocab.addEventListener('click', function (e) {
      var c = e.target.closest('.wcard');
      if (!c) return;
      if (vocab.classList.contains('hide-vi')) c.classList.add('reveal');
      speak(c.getAttribute('data-word'));
    });
  }
  function grammarNote(g) {
    var h = '<div class="gnote"><div class="gnote-head"><span class="gpat">' + esc(g.pattern) + '</span>' + (g.title ? '<span class="gtitle">' + ko(g.title) + '</span>' : '') + '</div><div class="gnote-body">';
    (g.note || []).forEach(function (p) { h += '<p>' + ko(p) + '</p>'; });
    if (g.examples && g.examples.length) {
      h += '<ul class="ex">';
      g.examples.forEach(function (e) {
        h += '<li><span class="txt"><span class="ex-ko">' + esc(e[0]) + '</span><br><span class="ex-vi">' + ko(e[1]) + '</span></span>' + speakBtn(e[0]) + '</li>';
      });
      h += '</ul>';
    }
    return h + '</div></div>';
  }

  // ---------- quiz ----------
  function mcq(lid, kind, q, extra) {
    var o = { lid: lid, kind: kind, q: q.q, options: shuffle(q.options), answer: q.options[0], explain: q.explain, say: q.say };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  function buildQuestions(data, quick) {
    var words = [], seen = {};
    data.vocab.forEach(function (g) { g.words.forEach(function (w) { if (!seen[w[0]]) { seen[w[0]] = 1; words.push(w); } }); });
    var p = data.vocabPrompt || {};
    var picked = shuffle(words);
    if (quick) picked = picked.slice(0, QUICK_VOCAB);
    var qs = picked.map(function (w, i) {
      var pool = shuffle(words.filter(function (o) { return o[0] !== w[0] && o[1] !== w[1]; })).slice(0, 3);
      var koToVi = data.vocabDirection === 'ko' ? true : (i % 2 === 0);
      if (koToVi) {
        return { lid: data.id, kind: 'vocab', q: (p.koToVi || 'Nghĩa của {ko} là gì?').replace('{ko}', w[0]), say: w[2] || w[0],
          options: shuffle([w[1]].concat(pool.map(function (o) { return o[1]; }))), answer: w[1], explain: w[0] + ' = ' + w[1] };
      }
      return { lid: data.id, kind: 'vocab', q: (p.viToKo || '“{vi}” trong tiếng Hàn là gì?').replace('{vi}', w[1]),
        options: shuffle([w[0]].concat(pool.map(function (o) { return o[0]; }))), answer: w[0], explain: w[0] + ' = ' + w[1], sayAnswer: w[2] || w[0] };
    });
    var usage = shuffle(data.usage || []);
    if (quick) usage = usage.slice(0, QUICK_USAGE);
    usage.forEach(function (q) { qs.push(mcq(data.id, 'usage', q, { sayAnswer: q.sayAnswer })); });
    (data.grammar || []).forEach(function (g) {
      var gq = shuffle(g.questions);
      if (quick) gq = gq.slice(0, QUICK_PER_PATTERN);
      gq.forEach(function (q, i) { qs.push(mcq(data.id, 'grammar', q, { pattern: g.pattern, grammar: i === 0 ? g : null })); });
    });
    var listen = shuffle(data.listening || []);
    if (quick) listen = listen.slice(0, QUICK_LISTEN);
    listen.forEach(function (q) {
      qs.push(mcq(data.id, 'listen', { q: q.q || 'Nghe và chọn nghĩa đúng.', options: q.options, explain: q.explain }, { listen: q.listen }));
    });
    if (data.reading) {
      data.reading.questions.forEach(function (q) {
        qs.push(mcq(data.id, 'read', q, { passage: data.reading.passage, passageVi: data.reading.passageVi }));
      });
    }
    return qs;
  }
  function sectionCounts(data) {
    var parts = [];
    if (data.listening && data.listening.length) parts.push('nghe');
    if (data.reading) parts.push('đọc hiểu');
    return parts.length ? ' + ' + parts.join(', ') : '';
  }

  function renderQuizStart(data, found) {
    document.title = 'Làm bài · ' + (found ? fullName(found) : data.title) + ' – Hana Dul';
    var full = buildQuestions(data, false).length;
    var quick = buildQuestions(data, true).length;
    var s = readStore();
    var p = s.lessons[data.id];
    app.innerHTML = '<div class="container narrow">' + lessonHero(data, found) + seg(data.id, 'lam-bai') +
      '<div class="panel" style="margin-top:14px"><div class="big-emoji">' + esc(found && found.lesson.icon || '✏️') + '</div>' +
      '<h2>Chọn cách làm bài</h2>' +
      (p ? '<p class="muted">Kết quả tốt nhất: <b>' + p.best + '%</b> <span class="stars">' + starsHtml(p.stars) + '</span></p>' : '<p class="muted">Trả lời từng câu, câu sai sẽ được hỏi lại ở cuối.</p>') +
      '<div class="modes">' +
      '<button type="button" class="mode" data-mode="quick"><span class="tag">Gợi ý</span><b>⚡ Luyện nhanh</b><span>' + quick + ' câu · khoảng 5–8 phút · mỗi phần lấy vài câu' + sectionCounts(data) + '</span></button>' +
      '<button type="button" class="mode" data-mode="full"><b>🏆 Ôn đầy đủ</b><span>' + full + ' câu · toàn bộ từ vựng, ngữ pháp' + sectionCounts(data) + '</span></button>' +
      '</div><p class="muted" style="font-size:.88rem;margin:12px 0 0">Mẹo: trên máy tính, bấm phím 1–4 để chọn và Enter để tiếp tục. Phần nghe cần bật loa.</p></div></div>';
    app.querySelectorAll('.mode').forEach(function (b) {
      b.addEventListener('click', function () {
        HD.track('quiz_start', { lesson_id: data.id, mode: b.getAttribute('data-mode') });
        runQuiz({ data: data, found: found, quick: b.getAttribute('data-mode') === 'quick', questions: buildQuestions(data, b.getAttribute('data-mode') === 'quick') });
      });
    });
  }

  // Ghi kết quả một câu vào Sổ câu sai: sai thì thêm vào sổ, đúng 2 lần liên tiếp thì bỏ ra.
  function recordAnswer(q, ok) {
    var s = readStore();
    var id = qid(q);
    var e = s.wrong[id];
    if (!ok) {
      s.wrong[id] = { item: snapshot(q), n: (e ? e.n : 0) + 1, ok: 0, t: today(), ts: Date.now() };
      delete s.wrongDel[id];
    } else if (e) {
      e.ok++;
      e.ts = Date.now();
      // Ghi lại lúc gỡ câu khỏi sổ để máy khác khi đồng bộ cũng gỡ theo.
      if (e.ok >= 2) { delete s.wrong[id]; s.wrongDel[id] = Date.now(); }
    } else return;
    writeStore(s);
  }

  function runQuiz(opt) {
    var data = opt.data, found = opt.found, quick = opt.quick, review = !!opt.review;
    document.body.classList.add('quiz-mode');
    window.scrollTo(0, 0);
    var queue = opt.questions;
    var total = queue.length;
    var firstTry = 0, answeredFirst = 0, combo = 0, bestCombo = 0;
    var wrongList = [];
    var pos = 0;
    var state = null; // null = đang chọn, object = đã trả lời
    var exitHref = review ? '#/so-cau-sai' : '#/bai/' + esc(data.id);

    function progressPct() { return Math.round(answeredFirst / total * 100); }

    function show() {
      var q = queue[pos];
      state = null;
      var sec = SECTIONS[q.kind] || SECTIONS.vocab;
      var h = '<div class="quiz"><div class="qbar"><a class="qclose" href="' + exitHref + '" aria-label="Thoát bài">✕</a>' +
        '<div class="qprog" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + progressPct() + '"><span style="width:' + progressPct() + '%"></span></div>' +
        '<div class="combo" id="combo">' + (combo >= 2 ? '🔥 ' + combo : '') + '</div></div>' +
        '<span class="qsection' + sec.cls + '">' + (q.kind === 'grammar' ? '🧩 ' + ko(q.pattern) : sec.tag) + '</span>' +
        (q.retry ? '<span class="retry-tag">Làm lại câu sai</span>' : '') +
        (review && q.lessonName ? '<span class="retry-tag">' + esc(q.lessonName) + '</span>' : '') +
        '<div class="qcard">';
      if (q.kind === 'listen') {
        h += '<div class="listen-box"><button type="button" class="play" data-say="' + esc(q.listen) + '" aria-label="Nghe lại">🔊</button>' +
          '<div><b>Bấm loa để nghe</b><br><button type="button" class="slow" data-slow="1">🐢 Nghe chậm</button></div></div>';
      }
      if (q.kind === 'read') {
        h += '<div class="passage ko-block">' + ko(q.passage) + '</div>';
      }
      h += '<div class="qtext"><span style="flex:1">' + ko(q.q) + '</span>' + (q.say ? speakBtn(q.say) : '') + '</div>' +
        (q.grammar ? '<details class="hint"><summary>💡 Xem ghi chú ngữ pháp</summary>' + grammarNote(q.grammar) + '</details>' : '') +
        '<div class="opts" role="group" aria-label="Các đáp án">';
      q.options.forEach(function (o, i) {
        h += '<button type="button" class="opt" data-o="' + i + '"><span class="key">' + (i + 1) + '</span><span>' + ko(o) + '</span></button>';
      });
      h += '</div></div><div id="fb"></div></div>';
      app.innerHTML = h;
      if (q.kind === 'listen') speak(q.listen);
      else if (q.say && q.kind === 'vocab') speak(q.say);
    }

    function choose(i) {
      if (state) return;
      var q = queue[pos];
      var ok = q.options[i] === q.answer;
      state = { ok: ok };
      app.querySelectorAll('.opt').forEach(function (b) {
        var idx = +b.getAttribute('data-o');
        b.disabled = true;
        if (q.options[idx] === q.answer) b.classList.add('correct');
        else if (idx === i) b.classList.add('wrong');
        else b.classList.add('dim');
      });
      if (!q.retry) {
        answeredFirst++;
        recordAnswer(q, ok);
        if (ok) firstTry++;
        else { wrongList.push(q); queue.push(Object.assign({}, q, { retry: true, options: shuffle(q.options), grammar: null })); }
      } else if (!ok) {
        queue.push(Object.assign({}, q, { options: shuffle(q.options) }));
      }
      combo = ok ? combo + 1 : 0;
      bestCombo = Math.max(bestCombo, combo);
      var bar = app.querySelector('.qprog > span');
      bar.style.width = progressPct() + '%';
      var c = document.getElementById('combo');
      c.textContent = combo >= 2 ? '🔥 ' + combo : '';
      if (combo >= 2) { c.classList.remove('bump'); void c.offsetWidth; c.classList.add('bump'); }
      renderStats();
      var praise = ['Chính xác!', 'Tuyệt vời!', 'Giỏi lắm!', 'Đúng rồi!', '잘했어요!'];
      var extra = '';
      if (q.kind === 'listen') extra = '<span class="transcript">🗣️ <span class="ko">' + esc(q.listen) + '</span> ' + speakBtn(q.listen) + '</span>';
      if (q.kind === 'read' && q.passageVi) extra = '<details class="trans"><summary>Xem bản dịch đoạn văn</summary>' + ko(q.passageVi) + '</details>';
      var fb = document.getElementById('fb');
      fb.innerHTML = '<div class="feedback ' + (ok ? 'ok' : 'bad') + '" role="alert"><div>' +
        '<div class="fb-title">' + (ok ? '✅ ' + praise[Math.floor(Math.random() * praise.length)] : '❌ Chưa đúng') + '</div>' + extra +
        '<p class="fb-text">' + (ok ? '' : 'Đáp án: <b>' + ko(q.answer) + '</b>. ') + (q.explain ? ko(q.explain) : '') + (q.sayAnswer ? ' ' + speakBtn(q.sayAnswer) : '') + '</p>' +
        '</div><button type="button" class="btn ' + (ok ? 'green' : 'red') + '" id="next">Tiếp tục</button></div>';
      document.getElementById('next').focus({ preventScroll: true });
      fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    function next() {
      if (!state) return;
      pos++;
      if (pos >= queue.length) return finish();
      show();
      window.scrollTo(0, 0);
    }

    function onClick(e) {
      var o = e.target.closest('.opt');
      if (o && !o.disabled) return choose(+o.getAttribute('data-o'));
      if (e.target.closest('#next')) return next();
      if (e.target.closest('[data-slow]')) {
        var q = queue[pos];
        if (q && q.listen) speak(q.listen, 0.6);
      }
    }
    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target && /^(TEXTAREA|INPUT)$/.test(e.target.tagName)) return;
      if (!state && /^[1-4]$/.test(e.key)) { var b = app.querySelector('.opt[data-o="' + (+e.key - 1) + '"]'); if (b) { e.preventDefault(); choose(+e.key - 1); } }
      else if (state && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
    }
    app.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    cleanup = function () {
      app.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };

    function finish() {
      cleanup(); cleanup = null;
      document.body.classList.remove('quiz-mode');
      var pct = Math.round(firstTry / total * 100);
      var stars = starsFor(pct);
      var xp = review ? firstTry * 5 : firstTry * 10 + (quick ? 0 : 20) + (stars === 3 ? 30 : 0);
      var s = readStore();
      if (!review) {
        var prev = s.lessons[data.id] || { best: 0, stars: 0 };
        s.lessons[data.id] = { best: Math.max(prev.best, pct), stars: Math.max(prev.stars, stars), last: today() };
        s.last = data.id;
        s.lastAt = Date.now();
      }
      s.xp += xp;
      if (s.days.indexOf(today()) < 0) s.days.push(today());
      s.days = s.days.slice(-400);
      writeStore(s);
      renderStats();
      HD.track(review ? 'review_complete' : 'quiz_complete', { lesson_id: review ? 'so-cau-sai' : data.id, mode: review ? 'review' : quick ? 'quick' : 'full', score: pct, questions: total });
      var streak = streakOf(s.days);
      var title = stars === 3 ? 'Xuất sắc!' : stars === 2 ? 'Làm tốt lắm!' : stars === 1 ? 'Khá ổn!' : 'Cố lên nhé!';
      var emoji = stars === 3 ? '🏆' : stars === 2 ? '🎉' : stars === 1 ? '👍' : '💪';
      var nextL = !review && found && found.next;
      var left = wrongCount(s);
      var h = '<div class="container narrow" style="padding-top:22px"><div class="panel"><div class="big-emoji">' + (review ? '📒' : emoji) + '</div>' +
        '<h2>' + (review ? 'Ôn xong!' : title) + '</h2>' + (review ? '' : '<div class="result-stars">' + starsHtml(stars) + '</div>') +
        '<p class="muted">Đúng ngay lần đầu ' + firstTry + '/' + total + ' câu' + (bestCombo >= 3 ? ' · chuỗi đúng dài nhất ' + bestCombo : '') + '</p>' +
        '<div class="result-grid"><div class="rbox xp"><b>+' + xp + '</b><span>⭐ XP</span></div>' +
        '<div class="rbox acc"><b>' + pct + '%</b><span>🎯 Chính xác</span></div>' +
        '<div class="rbox fire"><b>' + streak + '</b><span>🔥 Ngày liên tiếp</span></div></div>';
      if (wrongList.length) {
        h += '<details class="review"' + (wrongList.length <= 5 ? ' open' : '') + '><summary>📝 ' + wrongList.length + ' câu đã sai (đã lưu vào Sổ câu sai)</summary><ul>';
        wrongList.forEach(function (q) { h += '<li>' + ko(q.kind === 'listen' ? q.listen : q.q) + ' → <b>' + ko(q.answer) + '</b></li>'; });
        h += '</ul></details>';
      }
      if (left) h += '<p class="muted" style="margin-top:14px">📒 Sổ câu sai còn <b>' + left + '</b> câu.</p>';
      h += '<div class="actions">' + (review
        ? '<a class="btn ghost" href="#/so-cau-sai">📒 Về sổ câu sai</a><a class="btn" href="#/">Về trang chủ</a>'
        : '<a class="btn ghost" href="#/bai/' + esc(data.id) + '">📖 Xem lại bài</a>' +
          '<button type="button" class="btn ghost" id="again">🔁 Làm lại</button>' +
          (nextL ? '<a class="btn" href="#/bai/' + esc(nextL.id) + '">Bài tiếp theo →</a>' : '<a class="btn" href="#/">Về trang chủ</a>')) +
        '</div></div>';
      if (!review && data.writing) h += '<div class="panel write-panel"><h2>✍️ Luyện viết</h2>' + writingBox(data) + '</div>';
      if (!review) h += HD.signupHtml('ket-qua', true);
      h += '</div>';
      app.innerHTML = h;
      window.scrollTo(0, 0);
      if (!review) {
        document.getElementById('again').addEventListener('click', function () { renderQuizStart(data, found); });
        bindWriting(data);
      }
      if (stars >= 2) confetti();
    }

    show();
  }

  // ---------- writing ----------
  function writingBox(data) {
    var w = data.writing;
    var s = readStore();
    var h = '<div class="writing" id="writing"><p class="w-prompt">' + ko(w.prompt) + '</p>' +
      '<textarea id="wtext" rows="4" lang="ko" placeholder="Viết câu của bạn ở đây (bàn phím tiếng Hàn)…">' + esc(s.writing[data.id] || '') + '</textarea>' +
      '<div class="w-actions"><button type="button" class="btn ghost" id="wshow">👀 Xem câu mẫu</button><span class="muted" id="wsaved"></span></div>' +
      '<div class="w-samples" id="wsamples" hidden><p class="muted">So câu của bạn với câu mẫu: đã dùng đúng mẫu ngữ pháp chưa, tiểu từ và đuôi câu có khớp không?</p><ul class="ex">';
    w.samples.forEach(function (e) {
      h += '<li><span class="txt"><span class="ex-ko">' + esc(e[0]) + '</span><br><span class="ex-vi">' + ko(e[1]) + '</span></span>' + speakBtn(e[0]) + '</li>';
    });
    return h + '</ul>' + (w.tips ? '<p class="w-tip">💡 ' + ko(w.tips) + '</p>' : '') + '</div></div>';
  }
  function bindWriting(data) {
    var t = document.getElementById('wtext');
    if (!t) return;
    var timer;
    t.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var s = readStore();
        s.writing[data.id] = t.value.slice(0, 2000);
        s.writingAt[data.id] = Date.now();
        writeStore(s);
        document.getElementById('wsaved').textContent = HD.isSignedIn && HD.isSignedIn() ? 'Đã lưu' : 'Đã lưu trên máy';
      }, 500);
    });
    document.getElementById('wshow').addEventListener('click', function () {
      var box = document.getElementById('wsamples');
      box.hidden = !box.hidden;
      this.textContent = box.hidden ? '👀 Xem câu mẫu' : '🙈 Ẩn câu mẫu';
    });
  }

  // ---------- wrong book ----------
  function renderWrongBook() {
    document.title = 'Sổ câu sai – Hana Dul';
    getIndex().then(function (idx) {
      var s = readStore();
      var names = {};
      allLessons(idx).forEach(function (x) { names[x.lesson.id] = fullName(x); });
      var ids = Object.keys(s.wrong);
      var h = '<div class="container narrow"><div class="lesson-hero"><div class="crumbs"><a href="#/">Trang chủ</a></div>' +
        '<h1><span class="emoji">📒</span>Sổ câu sai</h1>' +
        '<p>Câu bạn trả lời sai ở lần đầu được lưu tại đây. Trả lời đúng 2 lần liên tiếp thì câu rời khỏi sổ. ' + (HD.isSignedIn && HD.isSignedIn() ? 'Sổ được lưu trong tài khoản của bạn.' : 'Dữ liệu chỉ lưu trên máy này.') + '</p></div>';
      if (!ids.length) {
        h += '<div class="panel" style="margin-top:14px"><div class="big-emoji">🎉</div><h2>Sổ đang trống</h2><p class="muted">Làm bài, câu nào sai sẽ hiện ở đây để bạn ôn lại.</p>' +
          '<div class="actions"><a class="btn" href="#/">Về trang chủ</a></div></div></div>';
        app.innerHTML = h;
        return;
      }
      var items = ids.map(function (id) { return s.wrong[id]; })
        .sort(function (a, b) { return (b.n - a.n) || (a.t < b.t ? -1 : 1); });
      var n = Math.min(REVIEW_MAX, items.length);
      h += '<div class="panel" style="margin-top:14px"><h2>' + ids.length + ' câu cần ôn</h2><p class="muted">Mỗi lượt ôn tối đa ' + REVIEW_MAX + ' câu, ưu tiên câu sai nhiều lần. Bấm tên bài bên dưới để xem từng câu.</p>' +
        '<div class="actions"><button type="button" class="btn" id="startReview">Ôn ' + n + ' câu →</button></div></div>';
      var byLesson = {};
      items.forEach(function (e) { (byLesson[e.item.lid] = byLesson[e.item.lid] || []).push(e); });
      Object.keys(byLesson).forEach(function (lid) {
        h += '<details class="wb-group"><summary class="group-title">' + esc(names[lid] || lid) + ' · ' + byLesson[lid].length + ' câu</summary><ul class="wb-list">';
        byLesson[lid].forEach(function (e) {
          var it = e.item;
          h += '<li><span class="wb-q">' + ko(it.kind === 'listen' ? '🎧 ' + it.listen : it.q) + '</span><span class="wb-a">→ ' + ko(it.answer) + '</span>' +
            '<span class="wb-n">sai ' + e.n + ' lần' + (e.ok ? ' · đã đúng ' + e.ok + '/2' : '') + '</span></li>';
        });
        h += '</ul></details>';
      });
      h += '</div>';
      app.innerHTML = h;
      document.getElementById('startReview').addEventListener('click', function () {
        var qs = items.slice(0, n).map(function (e) {
          var q = Object.assign({}, e.item, { options: shuffle(e.item.options), lessonName: names[e.item.lid] || '' });
          return q;
        });
        runQuiz({ review: true, questions: shuffle(qs) });
      });
    }).catch(fail);
  }

  function confetti() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var colors = ['#ff6b5b', '#ffbf3c', '#1fb894', '#4d8dff', '#ff5470'];
    var box = document.createElement('div');
    box.className = 'confetti';
    for (var i = 0; i < 70; i++) {
      var p = document.createElement('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = Math.random() * 0.8 + 's';
      p.style.animationDuration = 2 + Math.random() * 1.5 + 's';
      box.appendChild(p);
    }
    document.body.appendChild(box);
    setTimeout(function () { box.remove(); }, 4200);
  }

  route();
})();
