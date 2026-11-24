/* Thẻ từ (#/bai/<id>/the-tu) và Chép chính tả (#/bai/<id>/chinh-ta) cho từng bài.
   Thẻ từ: lật thẻ xem nghĩa, nghe phát âm, tự đánh giá Đã nhớ / Chưa nhớ (thẻ chưa nhớ quay lại cuối chồng).
   Chép chính tả: máy đọc từ (giọng đọc có sẵn của trình duyệt), người học gõ lại bằng bàn phím tiếng Hàn, máy so khớp.
   Không cần mạng ngoài, không dùng AI. Học xong cộng XP, giữ chuỗi ngày và đưa từ của bài vào Ôn hôm nay (assets/review.js).
   Cần assets/app.js (HD.lib). */
(function () {
  'use strict';

  var HD = window.HD = window.HD || {};
  var DICT_ROUND = 10;
  var XP_CARD_ROUND = 5;
  var XP_DICT = 2;
  var PREF_KEY = 'hanadul:cards-front';

  function L() { return HD.lib; }
  function esc(s) { return L().esc(s); }
  function words(data) {
    var out = [], seen = {};
    (data.vocab || []).forEach(function (g) { g.words.forEach(function (w) { if (!seen[w[0]]) { seen[w[0]] = 1; out.push(w); } }); });
    return out;
  }
  function sayOf(w) { return w[2] || w[0]; }
  // So khớp chính tả: bỏ dấu câu, dấu cách, phần trong ngoặc; chữ Latinh không phân biệt hoa thường.
  function norm(t) {
    return String(t || '').normalize('NFC').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[\s.,!?~'"“”‘’·…\-]/g, '');
  }
  function accepts(w) {
    var a = [norm(w[0])];
    if (w[2]) a.push(norm(w[2]));
    return a.filter(Boolean);
  }
  function credit(xp) {
    var s = L().readStore();
    s.xp += xp;
    var d = L().today();
    if (s.days.indexOf(d) < 0) s.days.push(d);
    s.days = s.days.slice(-400);
    L().writeStore(s);
  }
  function enroll(data) { if (HD.srs && HD.srs.finishLesson) HD.srs.finishLesson(data); }
  function pref(v) {
    try { if (v) localStorage.setItem(PREF_KEY, v); return localStorage.getItem(PREF_KEY) || 'ko'; } catch (e) { return v || 'ko'; }
  }

  function page(data, found, tab, body) {
    return '<div class="container narrow">' + L().lessonHero(data, found) + L().seg(data.id, tab) + body + '</div>';
  }

  // ---------- thẻ từ ----------
  function renderCards(app, data, found) {
    document.title = 'Thẻ từ · ' + (found ? L().fullName(found) : data.title) + ' – Hana Dul';
    var all = words(data);
    var front = pref();
    var h = '<div class="panel fc-panel" id="fcRoot"><div class="fc-tools"><span class="muted" id="fcCount"></span>' +
      '<div class="seg fc-face" role="group" aria-label="Mặt trước của thẻ">' +
      '<button type="button" data-front="ko" aria-pressed="' + (front === 'ko') + '">Hàn → Việt</button>' +
      '<button type="button" data-front="vi" aria-pressed="' + (front === 'vi') + '">Việt → Hàn</button></div></div>' +
      '<div class="fc-stage"></div>' +
      '<p class="muted fc-help">Bấm thẻ (hoặc phím cách) để lật. Phím ← chưa nhớ, → đã nhớ.</p></div>';
    app.innerHTML = page(data, found, 'the-tu', h);
    var root = document.getElementById('fcRoot');
    var stage = root.querySelector('.fc-stage');
    var deck, known, flipped, first, again;
    function start() {
      deck = L().shuffle(all); known = 0; flipped = false; first = {}; again = {};
      show();
    }
    function count() {
      document.getElementById('fcCount').textContent = 'Đã nhớ ' + known + '/' + all.length + ' · còn ' + deck.length + ' thẻ';
    }
    function show() {
      count();
      if (!deck.length) return done();
      var w = deck[0];
      flipped = false;
      var ko = '<span class="fc-ko ko">' + esc(w[0]) + '</span>';
      var vi = '<span class="fc-vi">' + L().ko(w[1]) + '</span>';
      stage.innerHTML = '<button type="button" class="fc-card" id="fcCard" aria-label="Lật thẻ">' +
        '<span class="fc-front">' + (front === 'ko' ? ko : vi) + '</span>' +
        '<span class="fc-back" hidden>' + (front === 'ko' ? vi : ko) + '</span>' +
        '<span class="fc-hint muted">' + (front === 'ko' ? 'Nghĩa là gì?' : 'Tiếng Hàn là gì?') + ' · bấm để lật</span></button>' +
        '<div class="fc-actions"><button type="button" class="btn ghost small" id="fcSay">🔊 Nghe</button>' +
        '<button type="button" class="btn red" id="fcNo" disabled>😕 Chưa nhớ</button><button type="button" class="btn green" id="fcYes" disabled>😊 Đã nhớ</button></div>';
      if (front === 'ko') L().speak(sayOf(w));
    }
    function flip() {
      var c = document.getElementById('fcCard');
      if (!c) return;
      flipped = !flipped;
      c.classList.toggle('flipped', flipped);
      c.querySelector('.fc-front').hidden = flipped;
      c.querySelector('.fc-back').hidden = !flipped;
      c.querySelector('.fc-hint').textContent = flipped ? 'Bạn nhớ từ này chưa?' : 'Bấm để lật';
      document.getElementById('fcNo').disabled = document.getElementById('fcYes').disabled = false;
      if (flipped && front === 'vi') L().speak(sayOf(deck[0]));
    }
    function rate(ok) {
      if (!deck.length || document.getElementById('fcYes').disabled) return;
      var w = deck.shift();
      if (ok) { known++; if (!again[w[0]]) first[w[0]] = 1; }
      else { again[w[0]] = 1; deck.push(w); }
      show();
    }
    function done() {
      var nFirst = Object.keys(first).length;
      var xp = XP_CARD_ROUND + nFirst;
      credit(xp);
      enroll(data);
      HD.track('cards_complete', { lesson_id: data.id, words: all.length, first_try: nFirst });
      L().renderStats();
      var missed = all.filter(function (w) { return again[w[0]]; });
      stage.innerHTML = '<div class="fc-done"><div class="big-emoji">🃏</div><h2>Xong ' + all.length + ' thẻ!</h2>' +
        '<p class="muted">Nhớ ngay lần đầu <b id="fcFirst">' + nFirst + '/' + all.length + '</b> từ · <b>+' + xp + '</b> ⭐ XP</p>' +
        (missed.length ? '<details class="review"' + (missed.length <= 8 ? ' open' : '') + '><summary>' + missed.length + ' từ cần xem lại</summary><ul>' +
          missed.map(function (w) { return '<li><span class="ko">' + esc(w[0]) + '</span> → ' + L().ko(w[1]) + '</li>'; }).join('') + '</ul></details>' : '') +
        '<p class="muted small-note">Từ của bài đã vào hàng <a href="#/on-tap">Ôn hôm nay</a> để hỏi lại vào những ngày sau.</p>' +
        '<div class="actions"><button type="button" class="btn ghost" id="fcAgain">🔁 Lật lại từ đầu</button>' +
        '<a class="btn ghost" href="#/bai/' + esc(data.id) + '/chinh-ta">🎧 Chép chính tả</a><a class="btn" href="#/bai/' + esc(data.id) + '/lam-bai">Làm bài →</a></div></div>';
    }
    root.addEventListener('click', function (e) {
      var f = e.target.closest('[data-front]');
      if (f) {
        front = pref(f.getAttribute('data-front'));
        root.querySelectorAll('[data-front]').forEach(function (b) { b.setAttribute('aria-pressed', String(b === f)); });
        if (deck.length) show();
        return;
      }
      if (e.target.closest('#fcCard')) return flip();
      if (e.target.closest('#fcSay')) return deck.length && L().speak(sayOf(deck[0]));
      if (e.target.closest('#fcYes')) return rate(true);
      if (e.target.closest('#fcNo')) return rate(false);
      if (e.target.closest('#fcAgain')) return start();
    });
    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey || !deck.length) return;
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === ' ' || e.key === 'Enter') { if (e.target && e.target.closest && e.target.closest('button:not(#fcCard)')) return; e.preventDefault(); flip(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); rate(true); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); rate(false); }
    }
    document.addEventListener('keydown', onKey);
    HD.setCleanup(function () { document.removeEventListener('keydown', onKey); });
    start();
  }

  // ---------- chép chính tả ----------
  function renderDictation(app, data, found) {
    document.title = 'Chép chính tả · ' + (found ? L().fullName(found) : data.title) + ' – Hana Dul';
    var all = words(data);
    var h = '<div class="panel dt-panel" id="dtRoot"><div class="fc-tools"><span class="muted" id="dtCount"></span></div><div class="dt-stage"></div>' +
      '<p class="muted small-note dt-note">⌨️ Cần bàn phím tiếng Hàn: điện thoại Android thêm “한국어” trong Gboard, iPhone vào Cài đặt › Cài đặt chung › Bàn phím, máy tính thêm bàn phím Korean. ' +
      'Giọng đọc là giọng có sẵn của trình duyệt/máy nên có thể hơi máy móc; nếu không nghe thấy gì, hãy cài giọng tiếng Hàn cho máy.</p></div>';
    app.innerHTML = page(data, found, 'chinh-ta', h);
    var root = document.getElementById('dtRoot');
    var stage = root.querySelector('.dt-stage');
    var queue, pos, right, total, wrongs, checked;
    function start() {
      queue = L().shuffle(all).slice(0, Math.min(DICT_ROUND, all.length));
      total = queue.length; pos = 0; right = 0; wrongs = [];
      show();
    }
    function show() {
      checked = false;
      document.getElementById('dtCount').textContent = 'Từ ' + Math.min(pos + 1, total) + '/' + total + ' · đúng ' + right;
      if (pos >= queue.length) return done();
      var w = queue[pos];
      stage.innerHTML = '<div class="dt-play"><button type="button" class="play" id="dtSay" aria-label="Nghe lại">🔊</button>' +
        '<div><b>Nghe rồi gõ lại bằng chữ Hàn</b><br><button type="button" class="slow" id="dtSlow">🐢 Nghe chậm</button> ' +
        '<button type="button" class="slow" id="dtHint">💡 Gợi ý nghĩa</button></div></div>' +
        '<p class="dt-hint" id="dtHintText" hidden>Nghĩa: ' + L().ko(w[1]) + '</p>' +
        '<form id="dtForm" class="dt-form" autocomplete="off"><input type="text" id="dtIn" class="ko" lang="ko" maxlength="60" autocomplete="off" autocapitalize="off" spellcheck="false" aria-label="Gõ từ vừa nghe" placeholder="Gõ chữ Hàn…">' +
        '<button type="submit" class="btn">Kiểm tra</button></form><div id="dtFb"></div>';
      L().speak(sayOf(w));
      var inp = document.getElementById('dtIn');
      if (window.matchMedia && !window.matchMedia('(pointer: coarse)').matches) inp.focus({ preventScroll: true });
    }
    function check() {
      if (checked) return next();
      var w = queue[pos];
      var val = document.getElementById('dtIn').value;
      if (!norm(val)) { L().toast('Hãy gõ từ bạn nghe được (bàn phím tiếng Hàn).'); return; }
      checked = true;
      var ok = accepts(w).indexOf(norm(val)) >= 0;
      if (ok) right++; else wrongs.push({ w: w, typed: val });
      document.getElementById('dtIn').readOnly = true;
      document.getElementById('dtFb').innerHTML = '<div class="feedback ' + (ok ? 'ok' : 'bad') + '" role="alert"><div>' +
        '<div class="fb-title">' + (ok ? '✅ Chính xác!' : '❌ Chưa đúng') + '</div>' +
        '<p class="fb-text">' + (ok ? '' : 'Bạn viết: <span class="ko dt-typed">' + esc(val) + '</span><br>') +
        'Đáp án: <b class="ko">' + esc(w[0]) + '</b> = ' + L().ko(w[1]) + ' ' + L().speakBtn(sayOf(w)) + '</p></div>' +
        '<button type="button" class="btn ' + (ok ? 'green' : 'red') + '" id="dtNext">Tiếp tục</button></div>';
      document.getElementById('dtNext').focus({ preventScroll: true });
      document.getElementById('dtCount').textContent = 'Từ ' + (pos + 1) + '/' + total + ' · đúng ' + right;
    }
    function next() { pos++; show(); }
    function done() {
      var xp = right * XP_DICT;
      if (xp) credit(xp);
      enroll(data);
      HD.track('dictation_complete', { lesson_id: data.id, score: right, questions: total });
      L().renderStats();
      document.getElementById('dtCount').textContent = '';
      stage.innerHTML = '<div class="fc-done"><div class="big-emoji">' + (right === total ? '🏆' : right >= total / 2 ? '🎉' : '💪') + '</div>' +
        '<h2 id="dtScore">' + right + '/' + total + ' từ đúng</h2><p class="muted"><b>+' + xp + '</b> ⭐ XP</p>' +
        (wrongs.length ? '<details class="review" open><summary>' + wrongs.length + ' từ viết chưa đúng</summary><ul>' + wrongs.map(function (x) {
          return '<li><span class="ko dt-typed">' + esc(x.typed) + '</span> → <b class="ko">' + esc(x.w[0]) + '</b> (' + L().ko(x.w[1]) + ') ' + L().speakBtn(sayOf(x.w)) + '</li>';
        }).join('') + '</ul></details>' : '') +
        '<div class="actions"><button type="button" class="btn ghost" id="dtAgain">🔁 Lượt mới</button>' +
        '<a class="btn ghost" href="#/bai/' + esc(data.id) + '/the-tu">🃏 Thẻ từ</a><a class="btn" href="#/bai/' + esc(data.id) + '/lam-bai">Làm bài →</a></div></div>';
    }
    root.addEventListener('submit', function (e) { e.preventDefault(); check(); });
    root.addEventListener('click', function (e) {
      var w = queue && queue[pos];
      if (e.target.closest('#dtSay')) return w && L().speak(sayOf(w));
      if (e.target.closest('#dtSlow')) return w && L().speak(sayOf(w), 0.55);
      if (e.target.closest('#dtHint')) { document.getElementById('dtHintText').hidden = false; return; }
      if (e.target.closest('#dtNext')) return next();
      if (e.target.closest('#dtAgain')) return start();
    });
    start();
  }

  HD.renderCards = function (app, data, found, tab) {
    if (tab === 'chinh-ta') return renderDictation(app, data, found);
    renderCards(app, data, found);
  };
  HD.cardsLib = { norm: norm, accepts: accepts };
})();
