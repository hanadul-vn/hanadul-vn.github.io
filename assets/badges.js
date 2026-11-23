/* Huy hiệu (#/huy-hieu): tính từ tiến độ đã có (chuỗi ngày, từ đã học, bài, ôn tập, thi thử, XP), không cần server.
   Huy hiệu đã đạt lưu ở hanadul:v2 → badges[id] = thời điểm đạt (ms), đồng bộ theo tài khoản; đạt rồi thì giữ luôn
   (kể cả khi chuỗi ngày bị đứt). Mỗi huy hiệu đạt được có nút tạo ảnh chia sẻ (assets/share.js).
   Cần assets/app.js (HD.lib) và assets/review.js (HD.srs). */
(function () {
  'use strict';

  var HD = window.HD = window.HD || {};
  function L() { return HD.lib; }
  function esc(s) { return L().esc(s); }

  // Chuỗi ngày học liên tiếp dài nhất từng có.
  function bestStreak(days) {
    var ds = (days || []).slice().sort(), best = 0, run = 0, prev = null;
    ds.forEach(function (d) {
      if (d === prev) return;
      var t = Date.parse(d + 'T00:00:00Z');
      run = prev !== null && t - Date.parse(prev + 'T00:00:00Z') === 864e5 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = d;
    });
    return best;
  }
  function metrics(s) {
    var lessons = s.lessons || {}, exams = s.exams || {};
    var st = HD.srs ? HD.srs.stats(s) : { learned: 0, days: 0 };
    return {
      streak: bestStreak(s.days),
      words: st.learned,
      lessons: Object.keys(lessons).filter(function (k) { return (lessons[k].best || 0) >= 70; }).length,
      stars: Object.keys(lessons).filter(function (k) { return (lessons[k].stars || 0) >= 3; }).length,
      review: st.days,
      exams: Object.keys(exams).reduce(function (a, k) { return a + (exams[k].n || 0); }, 0),
      xp: s.xp || 0
    };
  }

  // id cố định (đã lưu trong tiến độ người học): chỉ thêm mới, không đổi id cũ.
  var LIST = [
    { id: 'streak-3', m: 'streak', goal: 3, icon: '🔥', name: 'Khởi động', desc: 'Học 3 ngày liên tiếp' },
    { id: 'streak-7', m: 'streak', goal: 7, icon: '🔥', name: 'Một tuần bền bỉ', desc: 'Học 7 ngày liên tiếp' },
    { id: 'streak-30', m: 'streak', goal: 30, icon: '🌟', name: 'Một tháng kiên trì', desc: 'Học 30 ngày liên tiếp' },
    { id: 'streak-100', m: 'streak', goal: 100, icon: '👑', name: 'Trăm ngày không nghỉ', desc: 'Học 100 ngày liên tiếp' },
    { id: 'words-100', m: 'words', goal: 100, icon: '📚', name: '100 từ', desc: 'Học được 100 từ (trả lời đúng ít nhất 1 lần)' },
    { id: 'words-300', m: 'words', goal: 300, icon: '📚', name: '300 từ', desc: 'Học được 300 từ' },
    { id: 'words-700', m: 'words', goal: 700, icon: '📖', name: '700 từ', desc: 'Học được 700 từ' },
    { id: 'words-1500', m: 'words', goal: 1500, icon: '🎓', name: '1.500 từ', desc: 'Học được 1.500 từ' },
    { id: 'lessons-1', m: 'lessons', goal: 1, icon: '🌱', name: 'Bài đầu tiên', desc: 'Hoàn thành 1 bài (đúng từ 70%)' },
    { id: 'lessons-10', m: 'lessons', goal: 10, icon: '🪴', name: '10 bài', desc: 'Hoàn thành 10 bài' },
    { id: 'lessons-30', m: 'lessons', goal: 30, icon: '🌳', name: '30 bài', desc: 'Hoàn thành 30 bài' },
    { id: 'stars-10', m: 'stars', goal: 10, icon: '⭐', name: 'Mười bài 3 sao', desc: 'Đạt 3 sao ở 10 bài' },
    { id: 'review-7', m: 'review', goal: 7, icon: '🧠', name: 'Ôn đều tay', desc: 'Ôn hôm nay trong 7 ngày' },
    { id: 'review-30', m: 'review', goal: 30, icon: '🧠', name: 'Trí nhớ thép', desc: 'Ôn hôm nay trong 30 ngày' },
    { id: 'exam-1', m: 'exams', goal: 1, icon: '📝', name: 'Thử sức TOPIK', desc: 'Nộp 1 đề thi thử' },
    { id: 'exam-5', m: 'exams', goal: 5, icon: '🏆', name: 'Quen phòng thi', desc: 'Nộp 5 lượt đề thi thử' },
    { id: 'xp-1000', m: 'xp', goal: 1000, icon: '⚡', name: '1.000 XP', desc: 'Đạt 1.000 điểm kinh nghiệm' },
    { id: 'xp-5000', m: 'xp', goal: 5000, icon: '⚡', name: '5.000 XP', desc: 'Đạt 5.000 điểm kinh nghiệm' }
  ];
  function byId(id) { return LIST.filter(function (b) { return b.id === id; })[0]; }
  function dateVi(ms) { var d = new Date(ms); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }

  function shareBadge(id) {
    var b = byId(id), s = L().readStore();
    if (!b || !HD.share) return;
    var at = (s.badges || {})[id];
    HD.share.open({ kind: 'huy-hieu', emoji: b.icon, kicker: 'Huy hiệu mới', title: b.name, sub: b.desc + (at ? ' · ' + dateVi(at) : ''),
      stats: [['🔥', L().streakOf(s.days) + ' ngày liên tiếp'], ['⭐', (s.xp || 0) + ' XP']] });
  }

  HD.badges = {
    list: LIST,
    metrics: metrics,
    // Ghi các huy hiệu vừa đạt, trả về danh sách mới (để báo). Không có gì mới thì không ghi tiến độ.
    check: function () {
      var s = L().readStore(), m = metrics(s), now = Date.now(), fresh = [];
      LIST.forEach(function (b) {
        if (!s.badges[b.id] && m[b.m] >= b.goal) { s.badges[b.id] = now; fresh.push(b); }
      });
      if (fresh.length) L().writeStore(s);
      return fresh;
    },
    newHtml: function (list) {
      return '<div class="badge-new" id="badgeNew"><p class="badge-new-title">🏅 Bạn vừa mở khóa huy hiệu</p>' + list.map(function (b) {
        return '<div class="badge-new-item"><span class="bi">' + b.icon + '</span><span><b>' + esc(b.name) + '</b><br><span class="muted">' + esc(b.desc) + '</span></span>' +
          (HD.share ? '<button type="button" class="btn ghost small" data-share-badge="' + esc(b.id) + '">📸 Chia sẻ</button>' : '') + '</div>';
      }).join('') + '</div>';
    },
    bindNew: function (root) {
      root.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('[data-share-badge]');
        if (b) shareBadge(b.getAttribute('data-share-badge'));
      });
    }
  };

  HD.renderBadges = function (app) {
    document.title = 'Huy hiệu – Hana Dul';
    HD.badges.check();
    var s = L().readStore(), m = metrics(s);
    var got = LIST.filter(function (b) { return s.badges[b.id]; }).length;
    var h = '<div class="container narrow"><div class="lesson-hero" data-ko="배지"><div class="crumbs"><a href="#/">Trang chủ</a></div>' +
      '<h1><span class="emoji">🏅</span>Huy hiệu</h1>' +
      '<p>Học đều mỗi ngày, ôn từ và thử đề thi để mở khóa huy hiệu. Đã đạt thì giữ mãi, có thể tạo ảnh để khoe với bạn bè.</p></div>' +
      '<p class="badge-count" id="badgeCount">Đã có <b>' + got + '</b>/' + LIST.length + ' huy hiệu</p><ul class="badge-grid" id="badgeGrid">';
    LIST.forEach(function (b) {
      var at = s.badges[b.id], v = Math.min(m[b.m], b.goal);
      h += '<li class="badge' + (at ? ' got' : '') + '" data-badge="' + esc(b.id) + '"><span class="bi" aria-hidden="true">' + b.icon + '</span>' +
        '<b>' + esc(b.name) + '</b><span class="bd">' + esc(b.desc) + '</span>' +
        (at ? '<span class="bdate">Đạt ngày ' + dateVi(at) + '</span>' + (HD.share ? '<button type="button" class="btn ghost small" data-share-badge="' + esc(b.id) + '">📸 Chia sẻ</button>' : '')
          : '<span class="bprog" role="progressbar" aria-valuemin="0" aria-valuemax="' + b.goal + '" aria-valuenow="' + v + '"><span style="width:' + Math.round(v / b.goal * 100) + '%"></span></span><span class="bnum">' + v + '/' + b.goal + '</span>') +
        '</li>';
    });
    h += '</ul></div>';
    app.innerHTML = h;
    HD.badges.bindNew(document.getElementById('badgeGrid'));
  };

  HD.badgeHomeCard = function (s) {
    var got = LIST.filter(function (b) { return s.badges && s.badges[b.id]; });
    if (!got.length && !Object.keys(s.lessons || {}).length) return '';
    var last = got.sort(function (a, b) { return s.badges[b.id] - s.badges[a.id]; })[0];
    return '<a class="continue badge-card" href="#/huy-hieu" id="badgeCard"><span class="emoji">' + (last ? last.icon : '🏅') + '</span>' +
      '<span><span class="label">Huy hiệu · ' + got.length + '/' + LIST.length + '</span><br><span class="title">' + (last ? 'Mới nhất: ' + esc(last.name) : 'Mở khóa huy hiệu đầu tiên') + '</span></span><span class="go">→</span></a>';
  };
})();
