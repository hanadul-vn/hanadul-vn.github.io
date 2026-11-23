/* Ôn hôm nay (#/on-tap): ôn ngắt quãng các từ đã học, từ nào đến hạn mới hỏi lại, mỗi lượt tối đa 20 từ (~5 phút).
   Dữ liệu nằm trong tiến độ hanadul:v2 → srs (đồng bộ theo tài khoản như phần học):
     srs[key] = { l: mã bài, w: từ tiếng Hàn, v: nghĩa, s: chữ đem đọc (tùy chọn), b: hộp 0–7, d: ngày đến hạn YYYY-MM-DD, ts: lần trả lời gần nhất (0 = chưa ôn) }
     srsLog[YYYY-MM-DD] = số câu đã ôn hôm đó.
   Trả lời đúng thì lên hộp, khoảng cách dài dần (1, 3, 7, 14, 30, 60, 120 ngày); sai thì về hộp 0, hỏi lại ngày mai.
   Từ vào hàng ôn khi làm bài trắc nghiệm của bài (từ đã hỏi theo kết quả, từ chưa hỏi chia đều các ngày sau).
   Cần assets/app.js (HD.lib). */
(function () {
  'use strict';

  var HD = window.HD = window.HD || {};
  var GAP = [1, 1, 3, 7, 14, 30, 60, 120]; // số ngày tới lần ôn sau, theo hộp mới
  var MAX_BOX = GAP.length - 1;
  var PER_DAY = 20;
  var LOG_DAYS = 400;

  function L() { return HD.lib; }
  function esc(s) { return L().esc(s); }
  function dayAdd(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function key(lid, w) {
    var str = lid + '|' + w, h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return 'w' + h.toString(36);
  }
  // Bài bảng chữ (vocabDirection "ko", hỏi cách đọc chữ cái) không đưa vào ôn từ.
  function skipLesson(data) { return !data || data.vocabDirection === 'ko'; }
  function lessonWords(data) {
    var out = [], seen = {};
    (data.vocab || []).forEach(function (g) { g.words.forEach(function (w) { if (!seen[w[0]]) { seen[w[0]] = 1; out.push(w); } }); });
    return out;
  }
  function entry(lid, w) {
    var e = { l: lid, w: w[0], v: w[1], b: 0, d: dayAdd(1), ts: 0 };
    if (w[2]) e.s = w[2];
    return e;
  }
  // Bản sao kèm khóa k (không sửa dữ liệu gốc để khỏi lưu k vào tiến độ).
  function list(s) {
    var m = s.srs || {};
    return Object.keys(m).filter(function (k) { return m[k] && m[k].w && m[k].v; }).map(function (k) { return Object.assign({ k: k }, m[k]); });
  }
  function dueList(s) {
    var t = L().today();
    return list(s).filter(function (e) { return e.d <= t; })
      .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : a.b - b.b; });
  }

  // Thêm các từ chưa có vào hàng ôn, chia đều PER_DAY từ mỗi ngày bắt đầu từ ngày mai. ts = 0: chưa ôn lần nào.
  function enroll(s, lid, words) {
    s.srs = s.srs || {};
    var perDay = {};
    list(s).forEach(function (e) { perDay[e.d] = (perDay[e.d] || 0) + 1; });
    var day = 1, added = 0;
    words.forEach(function (w) {
      var k = key(lid, w[0]);
      if (s.srs[k]) return;
      while ((perDay[dayAdd(day)] || 0) >= PER_DAY) day++;
      var e = entry(lid, w);
      e.d = dayAdd(day);
      perDay[e.d] = (perDay[e.d] || 0) + 1;
      s.srs[k] = e;
      added++;
    });
    return added;
  }

  function step(e, ok) {
    e.b = ok ? Math.min((e.b || 0) + 1, MAX_BOX) : 0;
    e.d = dayAdd(GAP[e.b]);
    e.ts = Date.now();
  }

  HD.srs = {
    PER_DAY: PER_DAY,
    key: key,
    // Câu từ vựng trong bài (lần trả lời đầu): từ mới vào hàng ôn theo kết quả; từ đã có thì
    // sai → về hộp 0, đúng mà đã đến hạn → tính như một lần ôn, đúng mà chưa đến hạn → giữ nguyên.
    fromLesson: function (q, ok) {
      if (!q.w || q.kind !== 'vocab') return;
      var s = L().readStore();
      s.srs = s.srs || {};
      var k = key(q.lid, q.w[0]);
      var e = s.srs[k];
      if (!e) { e = s.srs[k] = entry(q.lid, q.w); step(e, ok); }
      else if (!ok || e.d <= L().today()) step(e, ok);
      else return;
      L().writeStore(s);
    },
    // Làm xong bài: các từ còn lại của bài (chưa được hỏi ở Luyện nhanh) vào hàng ôn những ngày sau.
    finishLesson: function (data) {
      if (skipLesson(data)) return;
      var s = L().readStore();
      if (enroll(s, data.id, lessonWords(data))) L().writeStore(s);
    },
    answer: function (k, ok) {
      var s = L().readStore();
      var e = s.srs && s.srs[k];
      if (!e) return;
      step(e, ok);
      L().writeStore(s);
    },
    logDone: function (s, n) {
      s.srsLog = s.srsLog || {};
      var t = L().today();
      s.srsLog[t] = (s.srsLog[t] || 0) + n;
      var ks = Object.keys(s.srsLog).sort();
      ks.slice(0, Math.max(0, ks.length - LOG_DAYS)).forEach(function (d) { delete s.srsLog[d]; });
    },
    stats: function (s) {
      var all = list(s);
      return {
        total: all.length,
        learned: all.filter(function (e) { return e.b >= 1; }).length,
        known: all.filter(function (e) { return e.b >= 4; }).length,
        due: dueList(s).length,
        doneToday: (s.srsLog || {})[L().today()] || 0,
        days: Object.keys(s.srsLog || {}).length,
        next: all.map(function (e) { return e.d; }).sort()[0] || ''
      };
    }
  };

  // Bài đã làm trước khi có tính năng này: thêm từ của các bài đó vào hàng ôn (một lần, ts = 0).
  function backfill(s) {
    var ids = Object.keys(s.lessons || {});
    var have = {};
    list(s).forEach(function (e) { have[e.l] = 1; });
    var need = ids.filter(function (id) { return !have[id]; });
    if (!need.length) return Promise.resolve(false);
    return Promise.all(need.map(function (id) {
      if (!/^[a-z0-9-]+$/.test(id)) return null;
      return L().loadJSON('data/lessons/' + id + '.json').catch(function () { return null; });
    })).then(function (res) {
      var st = L().readStore(), added = 0;
      res.forEach(function (d) { if (d && !skipLesson(d)) added += enroll(st, d.id, lessonWords(d)); });
      if (added) L().writeStore(st);
      return !!added;
    });
  }

  function dateVi(d) {
    if (!d) return '';
    if (d <= L().today()) return 'hôm nay';
    if (d === dayAdd(1)) return 'ngày mai';
    var p = d.split('-');
    return 'ngày ' + (+p[2]) + '/' + (+p[1]);
  }

  // Câu hỏi: xen kẽ Hàn → Việt và Việt → Hàn; đáp án nhiễu lấy từ các từ khác trong hàng ôn (ưu tiên cùng bài).
  function buildQuestions(s, items, names) {
    var pool = list(s);
    return L().shuffle(items).map(function (e, i) {
      var same = pool.filter(function (o) { return o.l === e.l && o.w !== e.w && o.v !== e.v; });
      var other = pool.filter(function (o) { return o.l !== e.l && o.w !== e.w && o.v !== e.v; });
      var picks = L().shuffle(same).concat(L().shuffle(other)), dis = [], seenV = {}, seenW = {};
      seenV[e.v] = seenW[e.w] = 1;
      picks.forEach(function (o) { if (dis.length < 3 && !seenV[o.v] && !seenW[o.w]) { seenV[o.v] = seenW[o.w] = 1; dis.push(o); } });
      var say = e.s || e.w;
      var q = { lid: e.l, kind: 'vocab', srsKey: e.k, lessonName: names[e.l] || '', explain: e.w + ' = ' + e.v };
      if (i % 2 === 0 || dis.length < 1) {
        q.q = 'Nghĩa của ' + e.w + ' là gì?'; q.say = say; q.answer = e.v;
        q.options = L().shuffle([e.v].concat(dis.map(function (o) { return o.v; })));
      } else {
        q.q = '“' + e.v + '” trong tiếng Hàn là gì?'; q.sayAnswer = say; q.answer = e.w;
        q.options = L().shuffle([e.w].concat(dis.map(function (o) { return o.w; })));
      }
      return q;
    });
  }

  function render(app) {
    document.title = 'Ôn hôm nay – Hana Dul';
    var s = L().readStore();
    var pre = backfill(s);
    Promise.all([pre, L().getIndex()]).then(function (res) {
      var idx = res[1];
      var names = {};
      L().allLessons(idx).forEach(function (x) { names[x.lesson.id] = L().fullName(x); });
      s = L().readStore();
      var st = HD.srs.stats(s);
      var due = dueList(s);
      var n = Math.min(PER_DAY, due.length);
      var h = '<div class="container narrow"><div class="lesson-hero" data-ko="복습"><div class="crumbs"><a href="#/">Trang chủ</a></div>' +
        '<h1><span class="emoji">🧠</span>Ôn hôm nay</h1>' +
        '<p>Ôn lại từ đã học đúng lúc sắp quên: từ nào trả lời đúng sẽ được hỏi lại sau 1, 3, 7, 14, 30… ngày; trả lời sai thì ngày mai hỏi lại. Mỗi ngày khoảng 5 phút.</p></div>';
      h += '<div class="srs-stats" id="srsStats">' +
        '<div><b id="srsDue">' + st.due + '</b><span>đến hạn hôm nay</span></div>' +
        '<div><b>' + st.learned + '</b><span>từ đã học</span></div>' +
        '<div><b>' + st.known + '</b><span>từ đã nhớ lâu</span></div></div>';
      if (!st.total) {
        h += '<div class="panel" style="margin-top:14px" id="srsEmpty"><div class="big-emoji">🌱</div><h2>Chưa có từ để ôn</h2>' +
          '<p class="muted">Học một bài và làm bài trắc nghiệm, từ của bài sẽ vào đây để ôn vào những ngày sau.</p>' +
          '<div class="actions"><a class="btn" href="#/">Chọn bài để học</a></div></div>';
      } else if (!due.length) {
        h += '<div class="panel" style="margin-top:14px" id="srsDone"><div class="big-emoji">✅</div><h2>' + (st.doneToday ? 'Đã ôn xong hôm nay!' : 'Hôm nay chưa có từ đến hạn') + '</h2>' +
          '<p class="muted">Lượt ôn tiếp theo: <b>' + esc(dateVi(st.next)) + '</b>. Trong lúc chờ, bạn có thể học bài mới.</p>' +
          '<div class="actions"><a class="btn ghost" href="#/huy-hieu">🏅 Xem huy hiệu</a><a class="btn" href="#/">Về trang chủ</a></div></div>';
      } else {
        h += '<div class="panel" style="margin-top:14px"><h2>' + (n < due.length ? 'Lượt này ' + n + ' từ' : n + ' từ cần ôn') + '</h2>' +
          '<p class="muted">' + (n < due.length ? 'Còn ' + (due.length - n) + ' từ đến hạn, ôn xong lượt này có thể ôn tiếp. ' : '') + 'Trả lời từng câu, câu sai được hỏi lại ở cuối lượt.</p>' +
          '<div class="actions"><button type="button" class="btn" id="startSrs">Bắt đầu ôn →</button></div></div>';
      }
      h += '</div>';
      app.innerHTML = h;
      var b = document.getElementById('startSrs');
      if (b) b.addEventListener('click', function () {
        var cur = L().readStore();
        var items = dueList(cur).slice(0, PER_DAY);
        HD.track('srs_start', { words: items.length });
        L().runQuiz({ srs: true, questions: buildQuestions(cur, items, names) });
      });
    }).catch(function (err) {
      app.innerHTML = '<div class="container narrow" style="padding:40px 16px"><h1>Không tải được nội dung</h1><p class="muted">' + esc(err.message || err) + '</p><p><a href="#/">Về trang chủ</a></p></div>';
    });
  }
  HD.renderReview = render;

  // Thẻ trang chủ: có từ đến hạn thì mời ôn; đã ôn xong thì báo lượt sau.
  HD.reviewHomeCard = function (s) {
    var st = HD.srs.stats(s);
    var started = Object.keys(s.lessons || {}).length;
    if (!st.total && !started) return '';
    var label, title;
    if (st.due) { label = 'Ôn hôm nay · khoảng 5 phút'; title = st.due + ' từ đến hạn ôn'; }
    else if (!st.total) { label = 'Ôn hôm nay'; title = 'Ôn lại từ các bài đã học'; }
    else { label = st.doneToday ? 'Đã ôn xong hôm nay ✅' : 'Ôn hôm nay'; title = 'Lượt sau: ' + dateVi(st.next); }
    return '<a class="continue srs-card' + (st.due ? ' hot' : '') + '" href="#/on-tap" id="srsCard"><span class="emoji">🧠</span>' +
      '<span><span class="label">' + esc(label) + '</span><br><span class="title">' + esc(title) + '</span></span><span class="go">→</span></a>';
  };
})();
