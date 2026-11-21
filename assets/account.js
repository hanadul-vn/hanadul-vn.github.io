/* Tài khoản Hana Dul (không bắt buộc): đăng nhập Google hoặc email, đồng bộ tiến độ lên Supabase.
   Chưa điền supabaseUrl/supabaseKey trong config.js thì file này không làm gì, web chạy như cũ (chỉ lưu trên máy). */
(function () {
  'use strict';

  var cfg = window.HANADUL_CONFIG || {};
  var HD = window.HD = window.HD || {};
  var M = window.HDMerge;
  var STORE_KEY = 'hanadul:v2';
  var SDK = 'assets/vendor/supabase-2.118.0.js';
  var PUSH_DELAY = 2500;

  var url = String(cfg.supabaseUrl || '').trim().replace(/\/+$/, '');
  var key = String(cfg.supabaseKey || '').trim();

  // Chặn nhầm khóa bí mật: khóa này cho toàn quyền dữ liệu, không bao giờ được nằm trên web.
  function isSecretKey(k) {
    if (/^sb_secret_/.test(k)) return true;
    var p = k.split('.');
    if (p.length !== 3) return false;
    try { return JSON.parse(atob(p[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; } catch (e) { return false; }
  }
  var secret = key && isSecretKey(key);
  if (secret) console.error('[Hana Dul] supabaseKey trong config.js là khóa BÍ MẬT. Chỉ dùng khóa công khai (publishable / anon). Tài khoản đã tắt.');

  HD.accountOn = !!(url && key && !secret && M && /^https:\/\//.test(url));

  var sb = null;
  var user = null;
  var ready = false;
  var sync = { state: 'idle', at: 0, error: '' };
  var pushTimer = null, running = null, again = false;
  var view = { step: 'start', email: '', msg: '', bad: false, busy: false, confirmDelete: false };

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
  }
  function writeLocal(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) { /* chế độ ẩn danh */ }
  }
  function refreshApp() { if (HD.refresh) HD.refresh(); }
  function track(n, p) { if (HD.track) HD.track(n, p); }

  HD.isSignedIn = function () { return !!user; };
  HD.accountReady = function () { return ready; };

  // ---------- badge trên thanh trên cùng ----------
  HD.renderAccountBadge = function () {
    var el = document.getElementById('acct');
    if (!el) return;
    if (!HD.accountOn) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    if (!user) {
      el.innerHTML = '<a class="acct-btn" href="#/tai-khoan" title="Đăng nhập để lưu tiến độ lên tài khoản">' +
        '<span aria-hidden="true">👤</span><span class="acct-label">Đăng nhập</span></a>';
      return;
    }
    var busy = sync.state === 'syncing' || sync.state === 'pending';
    var dot = sync.state === 'error' ? 'bad' : busy ? 'busy' : 'ok';
    var tip = sync.state === 'error' ? 'Chưa đồng bộ được' : busy ? 'Đang đồng bộ…' : 'Đã đồng bộ';
    el.innerHTML = '<a class="acct-btn me" href="#/tai-khoan" title="Tài khoản · ' + tip + '" aria-label="Tài khoản, ' + tip + '">' +
      '<span class="avatar" aria-hidden="true">' + esc(initial()) + '</span><span class="sync-dot ' + dot + '" aria-hidden="true"></span></a>';
  };
  function initial() {
    var n = displayName();
    return (n.trim()[0] || '?').toUpperCase();
  }
  function displayName() {
    if (!user) return '';
    var m = user.user_metadata || {};
    return m.full_name || m.name || user.email || 'Bạn';
  }
  function setSync(state, error) {
    sync.state = state;
    if (state === 'ok') sync.at = Date.now();
    sync.error = error || '';
    HD.renderAccountBadge();
    var st = document.getElementById('syncStatus');
    if (st) st.innerHTML = syncStatusHtml();
  }

  // ---------- đồng bộ ----------
  // Đọc tài khoản → gộp với máy này → ghi lại cả hai. Dùng cột version để 2 máy ghi cùng lúc không đè mất dữ liệu của nhau.
  function syncNow() {
    if (!sb || !user) return Promise.resolve();
    if (running) { again = true; return running; }
    clearTimeout(pushTimer);
    var uid = user.id;
    setSync('syncing');
    var tries = 0;
    function attempt() {
      tries++;
      return sb.from('progress').select('data, version').eq('user_id', uid).maybeSingle().then(function (res) {
        if (res.error) throw res.error;
        if (!user || user.id !== uid) return 'stop';
        var row = res.data;
        var remote = row ? row.data : null;
        var local = readLocal();
        // Dữ liệu trên máy thuộc tài khoản khác: không gộp sang tài khoản này.
        if (local.owner && local.owner !== uid) local = {};
        var merged = M.merge(local, remote);
        var localChanged = !M.sameData(local, merged);
        var remoteChanged = !row || !M.sameData(remote, merged);
        // xpSynced = XP đang có trên tài khoản. Chỉ nâng lên sau khi ghi lên tài khoản thành công.
        var baseXp = row ? (remote && remote.xp) || 0 : 0;
        writeLocal(Object.assign({}, merged, { owner: uid, xpSynced: baseXp }));
        if (localChanged) refreshApp();
        if (!remoteChanged) return 'ok';
        var q = row
          ? sb.from('progress').update({ data: merged, version: row.version + 1 }).eq('user_id', uid).eq('version', row.version).select('version')
          : sb.from('progress').insert({ user_id: uid, data: merged, version: 1 }).select('version');
        return q.then(function (r) {
          var conflict = (r.error && r.error.code === '23505') || (!r.error && (!r.data || !r.data.length));
          if (conflict) {
            if (tries < 4) return attempt();
            throw new Error('Máy khác đang đồng bộ, thử lại sau.');
          }
          if (r.error) throw r.error;
          var now = readLocal();
          if (now.owner === uid) { now.xpSynced = merged.xp; writeLocal(now); }
          return 'ok';
        });
      });
    }
    running = attempt().then(function () {
      setSync('ok');
    }, function (err) {
      console.warn('[Hana Dul] đồng bộ lỗi', err);
      setSync('error', (err && err.message) || String(err));
    }).then(function () {
      running = null;
      if (again) { again = false; return syncNow(); }
    });
    return running;
  }
  HD.syncNow = syncNow;

  // app.js gọi mỗi khi tiến độ trên máy thay đổi.
  HD.onLocalChange = function () {
    if (!user) return;
    var s = readLocal();
    if (!s.owner) { s.owner = user.id; writeLocal(s); }
    clearTimeout(pushTimer);
    pushTimer = setTimeout(syncNow, PUSH_DELAY);
    if (sync.state !== 'syncing') setSync('pending');
  };

  var lastFocusSync = 0;
  document.addEventListener('visibilitychange', function () {
    if (!user) return;
    if (document.visibilityState === 'hidden') {
      if (pushTimer) syncNow();
    } else if (Date.now() - lastFocusSync > 30000) {
      lastFocusSync = Date.now();
      syncNow();
    }
  });

  // ---------- khởi động ----------
  function loadSdk() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SDK;
      s.onload = resolve;
      s.onerror = function () { reject(new Error('Không tải được thư viện đăng nhập')); };
      document.head.appendChild(s);
    });
  }
  // Sau khi Google/link email quay về, đưa người dùng lại màn đang xem (thường là #/tai-khoan).
  var BACK_KEY = 'hanadul:back';
  function redirectUrl() {
    try { sessionStorage.setItem(BACK_KEY, location.hash || '#/'); } catch (e) { /* bỏ qua */ }
    return location.origin + location.pathname;
  }
  function takeBack() {
    var b = null;
    try { b = sessionStorage.getItem(BACK_KEY); sessionStorage.removeItem(BACK_KEY); } catch (e) { /* bỏ qua */ }
    return b && /^#\//.test(b) ? b : null;
  }
  function cleanUrl() {
    if (/[?&](code|error|error_description|token_hash|type)=/.test(location.search)) {
      history.replaceState(null, '', location.pathname + location.hash);
    }
  }

  function setUser(u) {
    var before = user && user.id;
    user = u || null;
    HD.renderAccountBadge();
    if (user && user.id !== before) {
      setTimeout(syncNow, 0);
    }
  }

  function start() {
    if (!HD.accountOn) { ready = true; return; }
    var qs = new URLSearchParams(location.search);
    var authError = qs.get('error_description');
    var returning = qs.has('code') || !!authError;
    loadSdk().then(function () {
      sb = window.supabase.createClient(url, key, {
        auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'hanadul:auth' }
      });
      sb.auth.onAuthStateChange(function (event, session) {
        // Không gọi Supabase trực tiếp trong callback này (dễ treo), đẩy sang lượt sau.
        setTimeout(function () {
          if (event === 'SIGNED_OUT') { user = null; HD.renderAccountBadge(); refreshApp(); return; }
          var wasIn = !!user;
          setUser(session && session.user);
          if (event === 'SIGNED_IN' && !wasIn && user) {
            track('login', { method: (user.app_metadata && user.app_metadata.provider) || 'email' });
            if (/^#\/tai-khoan/.test(location.hash)) refreshApp();
          }
        }, 0);
      });
      return sb.auth.getSession();
    }).then(function (res) {
      ready = true;
      cleanUrl();
      setUser(res && res.data && res.data.session && res.data.session.user);
      var back = returning ? takeBack() : null;
      if (authError) { view.msg = 'Đăng nhập chưa thành công: ' + authError; view.bad = true; back = '#/tai-khoan'; }
      if (back && back !== location.hash) location.hash = back;
      else refreshApp();
    }).catch(function (err) {
      ready = true;
      console.warn('[Hana Dul] tài khoản', err);
      HD.renderAccountBadge();
    });
  }

  // ---------- màn Tài khoản (#/tai-khoan) ----------
  function syncStatusHtml() {
    if (sync.state === 'syncing' || sync.state === 'pending') return '⏳ Đang đồng bộ…';
    if (sync.state === 'error') return '⚠️ Chưa đồng bộ được. Tiến độ vẫn lưu trên máy này và sẽ tự đồng bộ lại khi có mạng.';
    if (sync.at) {
      var d = new Date(sync.at);
      return '✅ Đã đồng bộ lúc ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    return '';
  }

  HD.renderAccountPage = function (app) {
    document.title = 'Tài khoản – Hana Dul';
    var h = '<div class="container narrow"><div class="lesson-hero"><div class="crumbs"><a href="#/">Trang chủ</a></div>' +
      '<h1><span class="emoji">👤</span>Tài khoản</h1>';
    if (!HD.accountOn) {
      h += '<p>Hana Dul chưa mở đăng nhập. Tiến độ của bạn vẫn được lưu trên máy này.</p></div>' +
        '<div class="actions" style="margin-top:16px"><a class="btn" href="#/">Về trang chủ</a></div></div>';
      app.innerHTML = h;
      return;
    }
    if (!ready) {
      app.innerHTML = h + '<p>Đang tải…</p></div></div>';
      return;
    }
    h += user
      ? '<p>Tiến độ, XP, chuỗi ngày và Sổ câu sai được lưu vào tài khoản để học tiếp trên máy khác.</p></div>'
      : '<p>Không bắt buộc. Đăng nhập để lưu tiến độ, XP, chuỗi ngày và Sổ câu sai vào tài khoản, đổi máy vẫn học tiếp được.</p></div>';
    h += user ? signedInHtml() : signedOutHtml();
    app.innerHTML = h + '</div>';
    bindAccountPage(app);
  };

  function signedOutHtml() {
    var local = readLocal();
    var h = '<div class="panel account-panel">';
    if (view.msg) h += '<p class="form-msg' + (view.bad ? ' bad' : '') + '" role="status">' + esc(view.msg) + '</p>';
    if (view.step === 'code') {
      h += '<div class="big-emoji">📬</div><h2>Kiểm tra email</h2>' +
        '<p class="muted">Hana Dul vừa gửi email tới <b>' + esc(view.email) + '</b>. Bấm nút đăng nhập trong email, hoặc nhập mã 6 số trong email vào đây.</p>' +
        '<form class="acct-form" id="codeForm" novalidate><label class="sr-only" for="otp">Mã đăng nhập</label>' +
        '<input id="otp" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="Mã trong email" required>' +
        '<button class="btn" type="submit"' + (view.busy ? ' disabled' : '') + '>Xác nhận</button></form>' +
        '<p class="muted small-note">Không thấy email? Xem thư mục Spam hoặc <button type="button" class="linkish" id="backEmail">nhập lại email</button>.</p>';
      return h + '</div>';
    }
    h += '<div class="big-emoji">🔐</div><h2>Đăng nhập Hana Dul</h2>' +
      (M.hasProgress(local) ? '<p class="muted">Tiến độ bạn đang có trên máy này sẽ được gộp vào tài khoản, không mất gì.</p>' : '<p class="muted">Lần đầu đăng nhập là tạo tài khoản luôn, miễn phí.</p>') +
      '<button type="button" class="btn ghost block google-btn" id="googleBtn"' + (view.busy ? ' disabled' : '') + '>' +
      '<svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>' +
      '<span>Tiếp tục với Google</span></button>' +
      '<div class="or"><span>hoặc dùng email</span></div>' +
      '<form class="acct-form" id="emailForm" novalidate><label class="sr-only" for="acctEmail">Email</label>' +
      '<input id="acctEmail" type="email" name="email" autocomplete="email" placeholder="Email của bạn" value="' + esc(view.email) + '" required>' +
      '<button class="btn" type="submit"' + (view.busy ? ' disabled' : '') + '>Gửi link đăng nhập</button></form>' +
      '<p class="muted small-note">Không cần mật khẩu: Hana Dul gửi link và mã đăng nhập vào email. Xem <a href="chinh-sach-bao-mat.html">Quyền riêng tư</a>.</p>';
    return h + '</div>';
  }

  function signedInHtml() {
    var local = M.normalize(readLocal());
    var provider = (user.app_metadata && user.app_metadata.provider) === 'google' ? 'Google' : 'Email';
    var h = '<div class="panel account-panel">' +
      '<div class="acct-head"><span class="avatar big" aria-hidden="true">' + esc(initial()) + '</span><div>' +
      '<b>' + esc(displayName()) + '</b><br><span class="muted">' + esc(user.email || '') + ' · ' + provider + '</span></div></div>' +
      '<div class="result-grid"><div class="rbox xp"><b>' + local.xp + '</b><span>⭐ XP</span></div>' +
      '<div class="rbox acc"><b>' + Object.keys(local.lessons).length + '</b><span>📘 Bài đã làm</span></div>' +
      '<div class="rbox fire"><b>' + Object.keys(local.wrong).length + '</b><span>📒 Câu cần ôn</span></div></div>' +
      '<p class="muted" id="syncStatus" role="status">' + syncStatusHtml() + '</p>' +
      '<div class="actions"><button type="button" class="btn ghost" id="syncBtn">🔄 Đồng bộ ngay</button>' +
      '<button type="button" class="btn ghost" id="logoutBtn">Đăng xuất</button></div>' +
      '<p class="muted small-note">Đăng xuất sẽ xóa tiến độ khỏi máy này (vẫn còn trong tài khoản), để người khác dùng máy không thấy dữ liệu của bạn.</p></div>';
    h += '<details class="danger-zone"' + (view.confirmDelete ? ' open' : '') + '><summary>Xóa tài khoản</summary>' +
      '<p>Xóa vĩnh viễn tài khoản và toàn bộ tiến độ đã lưu trên server. Không khôi phục được.</p>' +
      (view.msg ? '<p class="form-msg' + (view.bad ? ' bad' : '') + '" role="status">' + esc(view.msg) + '</p>' : '') +
      (view.confirmDelete
        ? '<p><b>Bạn chắc chắn chứ?</b></p><div class="actions"><button type="button" class="btn red" id="deleteYes"' + (view.busy ? ' disabled' : '') + '>Xóa vĩnh viễn</button><button type="button" class="btn ghost" id="deleteNo">Thôi</button></div>'
        : '<button type="button" class="btn ghost" id="deleteBtn">Xóa tài khoản…</button>') +
      '</details>';
    return h;
  }

  function rerender() { var app = document.getElementById('app'); if (app && /^#\/tai-khoan/.test(location.hash)) HD.renderAccountPage(app); }
  function say(msg, bad) { view.msg = msg; view.bad = !!bad; }
  function errText(err) {
    var m = (err && err.message) || String(err);
    if (/rate limit|too many|security purposes/i.test(m)) return 'Bạn gửi hơi nhiều lần, đợi vài phút rồi thử lại nhé.';
    if (/expired|invalid/i.test(m)) return 'Mã không đúng hoặc đã hết hạn. Bạn kiểm tra lại, hoặc gửi email mới.';
    if (/fetch|network/i.test(m)) return 'Không kết nối được. Bạn kiểm tra mạng rồi thử lại nhé.';
    return 'Có lỗi: ' + m;
  }

  function bindAccountPage(app) {
    function on(id, ev, fn) { var el = app.querySelector('#' + id); if (el) el.addEventListener(ev, fn); }
    on('googleBtn', 'click', function () {
      view.busy = true; say('');
      track('login_start', { method: 'google' });
      sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirectUrl() } }).then(function (r) {
        if (r.error) throw r.error;
      }).catch(function (err) { view.busy = false; say(errText(err), true); rerender(); });
    });
    on('emailForm', 'submit', function (e) {
      e.preventDefault();
      var email = e.target.elements.email.value.trim();
      view.email = email;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { say('Email chưa đúng, bạn kiểm tra lại nhé.', true); return rerender(); }
      view.busy = true; say('Đang gửi…'); rerender();
      track('login_start', { method: 'email' });
      sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: redirectUrl(), shouldCreateUser: true } }).then(function (r) {
        if (r.error) throw r.error;
        view.step = 'code'; view.busy = false; say('');
        rerender();
      }).catch(function (err) { view.busy = false; say(errText(err), true); rerender(); });
    });
    on('codeForm', 'submit', function (e) {
      e.preventDefault();
      var code = e.target.elements.code.value.replace(/\s/g, '');
      if (!/^\d{6,10}$/.test(code)) { say('Mã gồm các chữ số trong email.', true); return rerender(); }
      view.busy = true; say('Đang kiểm tra…'); rerender();
      sb.auth.verifyOtp({ email: view.email, token: code, type: 'email' }).then(function (r) {
        if (r.error) throw r.error;
        view.step = 'start'; view.busy = false; say('');
      }).catch(function (err) { view.busy = false; say(errText(err), true); rerender(); });
    });
    on('backEmail', 'click', function () { view.step = 'start'; say(''); rerender(); });
    on('syncBtn', 'click', function () { syncNow(); });
    on('logoutBtn', 'click', function () {
      var b = this; b.disabled = true; b.textContent = 'Đang đăng xuất…';
      syncNow().then(function () { return sb.auth.signOut(); }).then(function () {
        try { localStorage.removeItem(STORE_KEY); } catch (e) { /* bỏ qua */ }
        user = null; sync = { state: 'idle', at: 0, error: '' }; view = { step: 'start', email: '', msg: 'Đã đăng xuất.', bad: false, busy: false, confirmDelete: false };
        HD.renderAccountBadge();
        refreshApp();
      });
    });
    on('deleteBtn', 'click', function () { view.confirmDelete = true; say(''); rerender(); });
    on('deleteNo', 'click', function () { view.confirmDelete = false; say(''); rerender(); });
    on('deleteYes', 'click', function () {
      view.busy = true; rerender();
      clearTimeout(pushTimer);
      sb.rpc('delete_my_account').then(function (r) {
        if (r.error) throw r.error;
        return sb.auth.signOut({ scope: 'local' });
      }).then(function () {
        try { localStorage.removeItem(STORE_KEY); } catch (e) { /* bỏ qua */ }
        track('account_deleted');
        user = null; sync = { state: 'idle', at: 0, error: '' };
        view = { step: 'start', email: '', msg: 'Đã xóa tài khoản và dữ liệu trên server.', bad: false, busy: false, confirmDelete: false };
        HD.renderAccountBadge();
        refreshApp();
      }).catch(function (err) { view.busy = false; say(errText(err), true); rerender(); });
    });
  }

  // Thẻ mời đăng nhập ở trang chủ: chỉ hiện khi đã có tiến độ mà chưa đăng nhập.
  HD.accountHomeCard = function (hasProgress) {
    if (!HD.accountOn || !ready || user || !hasProgress) return '';
    return '<a class="continue acct-card" href="#/tai-khoan"><span class="emoji">☁️</span>' +
      '<span><span class="label">Không bắt buộc</span><br><span class="title">Lưu tiến độ vào tài khoản để học trên nhiều máy</span></span><span class="go">→</span></a>';
  };

  start();
})();
