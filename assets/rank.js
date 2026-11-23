/* Bảng xếp hạng tuần (#/xep-hang): XP kiếm được từ thứ Hai (giờ Việt Nam), chỉ người tự chọn tham gia, chỉ hiện tên hiển thị.
   Server tự tính XP tuần từ tiến độ đã đồng bộ (supabase/schema.sql: weekly_xp, leaderboard_week, set_leaderboard).
   Ai cũng xem được; muốn có tên trên bảng thì đăng nhập, đặt tên hiển thị rồi bấm tham gia. Miễn phí. */
(function () {
  'use strict';

  var HD = window.HD = window.HD || {};
  var MEDAL = { 1: '🥇', 2: '🥈', 3: '🥉' };
  var st = { ago: 0, opt: null, optFor: '', busy: false, msg: '', bad: false };

  function L() { return HD.lib; }
  function esc(s) { return L().esc(s); }
  function dm(d) { return d.getDate() + '/' + (d.getMonth() + 1); }
  function weekLabel(ago) {
    // Thứ Hai đầu tuần theo giờ Việt Nam (UTC+7).
    var vn = new Date(Date.now() + 7 * 3600000);
    var dow = (vn.getUTCDay() + 6) % 7;
    var mon = new Date(Date.UTC(vn.getUTCFullYear(), vn.getUTCMonth(), vn.getUTCDate() - dow - 7 * ago));
    var sun = new Date(mon.getTime() + 6 * 86400000);
    return dm(new Date(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate())) + ' – ' + dm(new Date(sun.getUTCFullYear(), sun.getUTCMonth(), sun.getUTCDate()));
  }
  function errText(err) {
    var m = (err && err.message) || String(err);
    if (/^Cần đặt tên|^Cần đăng nhập/.test(m)) return m + '.';
    if (/fetch|network/i.test(m)) return 'Không kết nối được. Bạn kiểm tra mạng rồi thử lại nhé.';
    return 'Có lỗi: ' + m;
  }

  function hero() {
    return '<div class="lesson-hero rank-hero" data-ko="순위"><div class="crumbs"><a href="#/">Trang chủ</a></div>' +
      '<h1><span class="emoji">🏆</span>Bảng xếp hạng tuần</h1>' +
      '<p>XP kiếm được từ thứ Hai đến Chủ nhật. Chỉ người tự chọn tham gia, chỉ hiện tên hiển thị. Miễn phí.</p></div>';
  }

  function meHtml() {
    var h = '<section class="panel rank-me" id="rankMe">';
    if (st.msg) h += '<p class="form-msg' + (st.bad ? ' bad' : '') + '" role="status" id="rankMsg">' + esc(st.msg) + '</p>';
    if (!HD.isSignedIn()) {
      return h + '<p>Muốn có tên trên bảng? <a href="#/tai-khoan">Đăng nhập</a> (miễn phí), đặt tên hiển thị rồi bấm tham gia.</p></section>';
    }
    var name = HD.displayName();
    if (!name) return h + '<p>Đặt <a href="#/tai-khoan">tên hiển thị</a> ở trang Tài khoản trước, rồi quay lại để tham gia.</p></section>';
    if (st.opt === null) return h + '<p class="muted">Đang tải…</p></section>';
    if (st.opt) {
      return h + '<p>✅ Bạn đang tham gia với tên <b>' + esc(name) + '</b>. XP học được từ lúc tham gia sẽ được tính (cập nhật sau khi tiến độ đồng bộ).</p>' +
        '<button type="button" class="btn ghost small" id="rankLeave"' + (st.busy ? ' disabled' : '') + '>Rời bảng xếp hạng</button></section>';
    }
    return h + '<p>Bạn chưa tham gia. Tham gia thì <b>tên hiển thị</b> và XP tuần của bạn hiện công khai trên bảng này (không có email). Rời lúc nào cũng được.</p>' +
      '<button type="button" class="btn small" id="rankJoin"' + (st.busy ? ' disabled' : '') + '>Tham gia với tên ' + esc(name) + '</button></section>';
  }

  function listHtml(rows) {
    if (!rows.length) {
      return '<p class="muted rank-empty" id="rankEmpty">' + (st.ago ? 'Tuần trước chưa có ai trên bảng.' : 'Tuần này chưa có ai trên bảng. Học một bài là có tên ngay!') + '</p>';
    }
    var h = '<ol class="rank-list" id="rankList">', prev = 0;
    rows.forEach(function (r) {
      var n = +r.rank;
      if (prev && n > 50 && prev <= 50) h += '<li class="rank-gap" aria-hidden="true">…</li>';
      prev = n;
      h += '<li class="rank-row' + (r.is_me ? ' me' : '') + (n <= 3 ? ' top' : '') + '"><span class="rank-n">' + (MEDAL[n] || n) + '</span>' +
        '<span class="rank-name">' + esc(r.display_name) + (r.is_me ? ' <span class="tag">Bạn</span>' : '') + '</span>' +
        '<span class="rank-xp">' + (+r.xp).toLocaleString('vi-VN') + ' XP</span></li>';
    });
    return h + '</ol>';
  }

  function render(app) {
    document.title = 'Bảng xếp hạng tuần – Hana Dul';
    if (!HD.accountOn) {
      app.innerHTML = '<div class="container narrow">' + hero() + '<p class="muted" style="margin-top:16px">Bảng xếp hạng cần tài khoản, Hana Dul chưa mở đăng nhập.</p></div>';
      return;
    }
    if (!HD.accountReady() || !HD.sb()) {
      if (HD.ensureAccount) HD.ensureAccount();
      app.innerHTML = '<div class="container narrow">' + hero() + '<p class="muted" style="margin-top:16px">Đang tải…</p></div>';
      return; // account.js gọi HD.refresh khi sẵn sàng
    }
    var sb = HD.sb();
    var uid = HD.userId();
    if (uid && st.optFor !== uid) {
      st.opt = null; st.optFor = uid;
      sb.from('profiles').select('leaderboard').eq('user_id', uid).maybeSingle().then(function (r) {
        if (r.error) throw r.error;
        st.opt = !!(r.data && r.data.leaderboard);
      }).catch(function (err) { st.opt = false; st.msg = errText(err); st.bad = true; }).then(repaintMe);
    }
    app.innerHTML = '<div class="container narrow">' + hero() + meHtml() +
      '<div class="seg rank-tabs" role="tablist">' +
      '<button type="button" data-ago="0" aria-pressed="' + (st.ago === 0) + '">Tuần này</button>' +
      '<button type="button" data-ago="1" aria-pressed="' + (st.ago === 1) + '">Tuần trước</button></div>' +
      '<p class="muted small-note" id="rankWeek">Tuần ' + weekLabel(st.ago) + (st.ago ? '' : ' · tuần mới bắt đầu 0 giờ thứ Hai') + '</p>' +
      '<div id="rankBody"><p class="muted">Đang tải bảng…</p></div></div>';
    var ago = st.ago;
    sb.rpc('leaderboard_week', { p_ago: ago }).then(function (r) {
      if (r.error) throw r.error;
      var body = document.getElementById('rankBody');
      if (body && st.ago === ago) body.innerHTML = listHtml(r.data || []);
    }).catch(function (err) {
      var body = document.getElementById('rankBody');
      if (body) body.innerHTML = '<p class="form-msg bad">⚠️ Chưa tải được bảng xếp hạng. <button type="button" class="linkish" id="rankRetry">Thử lại</button></p>';
      console.warn('[Hana Dul] xếp hạng', err);
    });
    bind(app);
  }
  function repaintMe() {
    var el = document.getElementById('rankMe');
    if (!el || !/^#\/xep-hang/.test(location.hash)) return;
    el.outerHTML = meHtml();
  }
  function bind(app) {
    var root = app.firstChild;
    root.addEventListener('click', function (e) {
      var t = e.target.closest('[data-ago]');
      if (t) { st.ago = +t.getAttribute('data-ago'); st.msg = ''; return render(app); }
      if (e.target.id === 'rankRetry') return render(app);
      if (e.target.id === 'rankJoin' || e.target.id === 'rankLeave') {
        var on = e.target.id === 'rankJoin';
        st.busy = true; st.msg = ''; repaintMe();
        // Đồng bộ trước để mốc XP lúc tham gia là số mới nhất.
        (on && HD.syncNow ? HD.syncNow() : Promise.resolve()).then(function () {
          return HD.sb().rpc('set_leaderboard', { p_on: on });
        }).then(function (r) {
          if (r.error) throw r.error;
          st.opt = on; st.busy = false;
          st.msg = on ? '🎉 Đã tham gia. Học thêm bài để có tên trên bảng tuần này.' : 'Đã rời bảng xếp hạng. Tên bạn không còn hiện nữa.';
          st.bad = false;
          HD.track(on ? 'leaderboard_join' : 'leaderboard_leave');
          render(app);
        }).catch(function (err) { st.busy = false; st.msg = errText(err); st.bad = true; repaintMe(); });
      }
    });
  }

  HD.renderRank = render;
  // Thẻ ở trang chủ: ai cũng xem được bảng; khách được mời xem, người đã đăng nhập vào thẳng.
  HD.rankHomeCard = function () {
    if (!HD.accountOn) return '';
    var signed = HD.isSignedIn && HD.isSignedIn();
    return '<a class="continue rank-card" href="#/xep-hang"><span class="emoji">🏆</span>' +
      '<span><span class="label">' + (signed ? 'Tuần ' + weekLabel(0) : 'Ai học chăm nhất tuần này?') + '</span><br><span class="title">Bảng xếp hạng tuần</span></span><span class="go">→</span></a>';
  };
})();
