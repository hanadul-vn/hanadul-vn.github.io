(function () {
  'use strict';

  var app = document.getElementById('app');
  var STORE_KEY = 'hth:progress:v1';
  var cache = {};
  var indexData = null;

  // ---------- helpers ----------
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Wrap runs of Hangul in a span so they get the Korean font.
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
  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function writeStore(data) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) { /* private mode */ }
  }
  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2600);
  }

  // ---------- speech ----------
  var koVoice = null;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    var vs = speechSynthesis.getVoices();
    koVoice = vs.filter(function (v) { return /^ko/i.test(v.lang); })[0] || null;
  }
  if ('speechSynthesis' in window) {
    pickVoice();
    speechSynthesis.onvoiceschanged = pickVoice;
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) { toast('Trình duyệt này không hỗ trợ đọc to.'); return; }
    if (!koVoice) pickVoice();
    speechSynthesis.cancel();
    var u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.rate = 0.85;
    if (koVoice) u.voice = koVoice;
    else toast('Máy chưa có giọng đọc tiếng Hàn, âm có thể không chuẩn.');
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
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/');
    window.scrollTo(0, 0);
    if (parts[0] === 'bai' && parts[1]) return renderLesson(parts[1], parts[2] || 'hoc');
    return renderHome();
  }
  window.addEventListener('hashchange', route);

  function getIndex() {
    if (indexData) return Promise.resolve(indexData);
    return loadJSON('data/index.json').then(function (d) { indexData = d; return d; });
  }
  function findLesson(idx, id) {
    for (var i = 0; i < idx.levels.length; i++) {
      var ls = idx.levels[i].lessons;
      for (var j = 0; j < ls.length; j++) if (ls[j].id === id) return { level: idx.levels[i], lesson: ls[j], pos: j };
    }
    return null;
  }
  function fail(err) {
    app.innerHTML = '<h1>Không tải được nội dung</h1><p class="muted">' + esc(err.message || err) + '</p><p><a href="#/">Về trang chủ</a></p>';
  }

  // ---------- home ----------
  function renderHome() {
    document.title = 'Hana Dul – Học tiếng Hàn miễn phí';
    getIndex().then(function (idx) {
      var prog = readStore();
      var html = '<section class="hero"><h1>Học tiếng Hàn miễn phí</h1>' +
        '<p><strong>Hana Dul</strong> <span class="ko">(하나 둘)</span> nghĩa là “một, hai”: học tiếng Hàn từng bước, bắt đầu từ bảng chữ cái.</p>' +
        '<p class="muted">Mỗi bài gồm bảng từ vựng, phần ngữ pháp và bài trắc nghiệm có giải thích. Không cần đăng ký.</p></section>';
      idx.levels.forEach(function (lv) {
        html += '<section class="level"><h2>' + esc(lv.name) + '</h2><ul class="lesson-list">';
        lv.lessons.forEach(function (l) {
          var p = prog[l.id];
          var badge = p ? '<span class="badge' + (p.best === p.total ? ' done' : '') + '">' + p.best + '/' + p.total + '</span>' : '';
          html += '<li><a class="lesson-card" href="#/bai/' + esc(l.id) + '">' +
            '<span class="lesson-no">' + esc(l.no) + '</span>' +
            '<span class="lesson-body"><span class="lesson-title">' + esc(l.title) + '</span>' +
            '<span class="lesson-meta"> · ' + ko(l.ko) + '</span>' +
            (l.summary ? '<div class="lesson-meta">' + ko(l.summary) + '</div>' : '') +
            '</span>' + badge + '</a></li>';
        });
        html += '</ul></section>';
      });
      app.innerHTML = html;
    }).catch(fail);
  }

  // ---------- lesson ----------
  function renderLesson(id, tab) {
    Promise.all([getIndex(), loadJSON('data/lessons/' + id + '.json')]).then(function (res) {
      var idx = res[0], data = res[1];
      var found = findLesson(idx, id);
      var name = found ? (found.lesson.no === '0' ? found.lesson.title : 'Bài ' + found.lesson.no + ': ' + found.lesson.title) : data.title;
      document.title = name + ' – Hana Dul';
      var next = found && found.level.lessons[found.pos + 1];
      var head = '<nav class="crumbs"><a href="#/">Trang chủ</a>' + (found ? ' / ' + esc(found.level.name) : '') + '</nav>' +
        '<h1>' + esc(name) + ' <span class="ko muted">' + esc(data.ko) + '</span></h1>' +
        (data.goal ? '<p class="muted">' + ko(data.goal) + '</p>' : '') +
        '<div class="tabs" role="tablist">' +
        tabBtn(id, 'hoc', 'Học', tab) + tabBtn(id, 'lam-bai', 'Làm bài', tab) +
        '</div><div id="tabpanel"></div>';
      app.innerHTML = head;
      var panel = document.getElementById('tabpanel');
      if (tab === 'lam-bai') renderQuiz(panel, data, next);
      else renderStudy(panel, data);
    }).catch(fail);
  }
  function tabBtn(id, key, label, cur) {
    return '<button class="tab" role="tab" aria-selected="' + (key === cur) + '" onclick="location.hash=\'#/bai/' + id + '/' + key + '\'">' + label + '</button>';
  }

  function renderStudy(panel, data) {
    var html = '<h2>Từ vựng</h2>';
    data.vocab.forEach(function (g) {
      html += '<div class="vocab-group"><h3>' + ko(g.group) + '</h3><table class="vocab-table"><tbody>';
      g.words.forEach(function (w) {
        html += '<tr><td class="ko">' + esc(w[0]) + '</td><td>' + ko(w[1]) + '</td><td class="act">' + speakBtn(w[2] || w[0]) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    });
    if (data.grammar && data.grammar.length) {
      html += '<h2>Ngữ pháp</h2>';
      data.grammar.forEach(function (g) { html += grammarNote(g); });
    }
    html += '<div class="actions"><a class="btn" href="#/bai/' + esc(data.id) + '/lam-bai">Làm bài trắc nghiệm</a></div>';
    panel.innerHTML = html;
  }
  function grammarNote(g) {
    var h = '<div class="card note"><h3>' + ko(g.pattern) + (g.title ? ' · ' + ko(g.title) : '') + '</h3>';
    (g.note || []).forEach(function (p) { h += '<p>' + ko(p) + '</p>'; });
    if (g.examples && g.examples.length) {
      h += '<ul class="ex">';
      g.examples.forEach(function (e) { h += '<li>' + ko(e[0]) + ' ' + speakBtn(e[0]) + ' <span class="muted">' + ko(e[1]) + '</span></li>'; });
      h += '</ul>';
    }
    return h + '</div>';
  }

  // ---------- quiz ----------
  function buildQuiz(data) {
    var sections = [];
    var words = [];
    var seen = {};
    data.vocab.forEach(function (g) {
      g.words.forEach(function (w) { if (!seen[w[0]]) { seen[w[0]] = 1; words.push(w); } });
    });
    var p = data.vocabPrompt || {};
    var vq = shuffle(words).map(function (w, i) {
      var pool = shuffle(words.filter(function (o) { return o[0] !== w[0] && o[1] !== w[1]; })).slice(0, 3);
      var koToVi = data.vocabDirection === 'ko' ? true : (i % 2 === 0);
      if (koToVi) {
        return {
          q: (p.koToVi || 'Nghĩa của {ko} là gì?').replace('{ko}', w[0]),
          say: w[2] || w[0],
          options: shuffle([w[1]].concat(pool.map(function (o) { return o[1]; }))),
          answer: w[1],
          explain: w[0] + ' = ' + w[1]
        };
      }
      return {
        q: (p.viToKo || '“{vi}” trong tiếng Hàn là gì?').replace('{vi}', w[1]),
        options: shuffle([w[0]].concat(pool.map(function (o) { return o[0]; }))),
        answer: w[0],
        explain: w[0] + ' = ' + w[1],
        sayAnswer: w[2] || w[0]
      };
    });
    sections.push({ title: 'Từ vựng', questions: vq });
    (data.grammar || []).forEach(function (g) {
      sections.push({
        title: g.pattern, grammar: g,
        questions: shuffle(g.questions).map(function (q) {
          return { q: q.q, say: q.say, options: shuffle(q.options), answer: q.options[0], explain: q.explain };
        })
      });
    });
    return sections;
  }

  function renderQuiz(panel, data, next) {
    var sections = buildQuiz(data);
    var total = 0, answered = 0, correct = 0;
    sections.forEach(function (s) { total += s.questions.length; });

    var html = '<div class="progress"><div class="bar"><span id="bar"></span></div><div class="progress-text" id="ptext"></div></div>';
    var n = 0;
    sections.forEach(function (s, si) {
      html += '<h2>' + ko(s.grammar ? 'Ngữ pháp: ' + s.title : s.title) + '</h2>';
      if (s.grammar) html += grammarNote(s.grammar);
      s.questions.forEach(function (q, qi) {
        n++;
        html += '<div class="q" data-s="' + si + '" data-q="' + qi + '"><div class="q-head"><span class="q-no">' + n + '.</span>' +
          '<div class="q-text">' + ko(q.q) + '</div>' + (q.say ? speakBtn(q.say) : '') + '</div><div class="opts">';
        q.options.forEach(function (o, oi) {
          html += '<button type="button" class="opt" data-o="' + oi + '">' + ko(o) + '</button>';
        });
        html += '</div></div>';
      });
    });
    html += '<div id="result"></div>';
    panel.innerHTML = html;
    update();

    panel.onclick = function (e) {
      var btn = e.target.closest('.opt');
      if (!btn || btn.disabled) return;
      var box = btn.closest('.q');
      var q = sections[+box.dataset.s].questions[+box.dataset.q];
      var chosen = q.options[+btn.dataset.o];
      var ok = chosen === q.answer;
      box.querySelectorAll('.opt').forEach(function (b) {
        b.disabled = true;
        if (q.options[+b.dataset.o] === q.answer) b.classList.add('correct');
      });
      if (!ok) btn.classList.add('wrong');
      var ex = document.createElement('div');
      ex.className = 'explain ' + (ok ? 'ok' : 'bad');
      ex.innerHTML = (ok ? '<strong>Đúng.</strong> ' : '<strong>Chưa đúng.</strong> Đáp án: ' + ko(q.answer) + '. ') + (q.explain ? ko(q.explain) : '') +
        (q.sayAnswer ? ' ' + speakBtn(q.sayAnswer) : '');
      box.appendChild(ex);
      answered++; if (ok) correct++;
      update();
      if (answered === total) finish();
    };

    function update() {
      document.getElementById('bar').style.width = (answered / total * 100) + '%';
      document.getElementById('ptext').textContent = 'Đã làm ' + answered + '/' + total + ' câu · Đúng ' + correct;
    }
    function finish() {
      var store = readStore();
      var prev = store[data.id];
      var best = Math.max(correct, prev ? prev.best : 0);
      store[data.id] = { best: best, total: total, last: correct, at: new Date().toISOString().slice(0, 10) };
      writeStore(store);
      var pct = Math.round(correct / total * 100);
      var msg = pct >= 90 ? 'Rất tốt!' : pct >= 70 ? 'Khá ổn, làm lại các câu sai nhé.' : 'Xem lại phần Học rồi làm lại nhé.';
      var r = document.getElementById('result');
      r.innerHTML = '<div class="card result"><div class="muted">Kết quả</div><div class="score">' + correct + '/' + total + '</div><p>' + msg + '</p>' +
        '<div class="actions" style="justify-content:center">' +
        '<button type="button" class="btn ghost" id="retry">Làm lại (đề mới)</button>' +
        (next ? '<a class="btn" href="#/bai/' + esc(next.id) + '">Bài tiếp theo</a>' : '<a class="btn" href="#/">Về trang chủ</a>') +
        '</div></div>';
      document.getElementById('retry').onclick = function () { window.scrollTo(0, 0); renderQuiz(panel, data, next); };
      r.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  route();
})();
