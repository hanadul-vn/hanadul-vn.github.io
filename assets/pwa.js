/* Cài Hana Dul như app (PWA) và học không cần mạng.
   - Đăng ký service worker (sw.js ở thư mục gốc).
   - Bắt sự kiện beforeinstallprompt (Chrome/Edge trên Android, máy tính) để hiện nút "Cài app"; iPhone/iPad hướng dẫn Thêm vào Màn hình chính.
   - Trang #/ung-dung: cài app, tải toàn bộ bài (dữ liệu bài, đề thi thử) vào bộ nhớ máy để học offline.
   - Báo ngắn khi mất mạng / có mạng lại.
   Kiểm thử tự động (navigator.webdriver) không đăng ký service worker, trừ khi trang đặt window.__HD_SW_TEST = true:
   các test cũ chặn/giả lập request qua Playwright, service worker sẽ đi vòng qua chỗ chặn đó. */
(function () {
  'use strict';

  var HD = window.HD = window.HD || {};
  var DATA_CACHE = 'hd-data-v1'; // trùng với sw.js
  var deferred = null;

  function standalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  }
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  var swOk = 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  var allowSW = swOk && (!navigator.webdriver || window.__HD_SW_TEST === true);
  HD.pwaReady = allowSW ? new Promise(function (resolve) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').then(function (reg) { resolve(reg); }).catch(function () { resolve(null); });
    });
  }) : Promise.resolve(null);

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    paintInstall();
  });
  window.addEventListener('appinstalled', function () {
    deferred = null;
    if (HD.track) HD.track('pwa_installed', {});
    paintInstall();
  });
  function toast(msg) { if (HD.lib) HD.lib.toast(msg); }
  window.addEventListener('offline', function () { toast('📴 Đang mất mạng. Bài đã mở hoặc đã tải về vẫn học được.'); });
  window.addEventListener('online', function () { toast('🌐 Đã có mạng lại.'); });

  function install() {
    if (!deferred) return;
    var d = deferred;
    deferred = null;
    d.prompt();
    (d.userChoice || Promise.resolve({})).then(function (c) {
      if (HD.track) HD.track('pwa_install_prompt', { outcome: c && c.outcome || '' });
      paintInstall();
    });
  }

  function installHtml() {
    if (standalone()) return '<p class="pwa-ok">✅ Bạn đang dùng Hana Dul dạng app trên máy này.</p>';
    var h = '';
    if (deferred) h += '<div class="actions" style="justify-content:flex-start"><button type="button" class="btn" id="pwaInstall">📲 Cài app Hana Dul</button></div>';
    if (isIOS()) {
      h += '<ol class="pwa-steps"><li>Mở trang này bằng <b>Safari</b>.</li><li>Bấm nút <b>Chia sẻ</b> (ô vuông có mũi tên lên).</li><li>Chọn <b>Thêm vào Màn hình chính</b> rồi bấm <b>Thêm</b>.</li></ol>';
    } else if (!deferred) {
      h += '<ul class="pwa-steps"><li><b>Android (Chrome):</b> bấm menu ⋮ › <b>Thêm vào màn hình chính</b> hoặc <b>Cài đặt ứng dụng</b>.</li>' +
        '<li><b>Máy tính (Chrome, Edge):</b> bấm biểu tượng cài đặt ở cuối thanh địa chỉ.</li>' +
        '<li><b>iPhone, iPad:</b> mở bằng Safari › nút Chia sẻ › <b>Thêm vào Màn hình chính</b>.</li></ul>';
    }
    return h;
  }
  function paintInstall() {
    var box = document.getElementById('pwaInstallBox');
    if (box) box.innerHTML = installHtml();
    var slot = document.getElementById('pwaSlot');
    if (slot && deferred && !standalone() && HD.lib && HD.lib.readStore().xp > 0) slot.innerHTML = cardHtml();
  }

  // Danh sách file để học offline: dữ liệu mọi bài + đề thi thử.
  function offlineList() {
    var L = HD.lib;
    return Promise.all([L.getIndex(), L.loadJSON('data/exams/index.json').catch(function () { return { exams: [] }; })]).then(function (r) {
      var urls = ['data/index.json', 'data/placement.json', 'data/exams/index.json'];
      L.allLessons(r[0]).forEach(function (x) { urls.push('data/lessons/' + x.lesson.id + '.json'); });
      (r[1].exams || []).forEach(function (e) { urls.push('data/exams/' + e.id + '.json'); });
      return { urls: urls, lessons: L.allLessons(r[0]).length };
    });
  }
  function countCached(urls) {
    if (!window.caches) return Promise.resolve(0);
    return caches.open(DATA_CACHE).then(function (c) {
      return Promise.all(urls.map(function (u) { return c.match(u).then(function (r) { return r ? 1 : 0; }); }));
    }).then(function (a) { return a.reduce(function (x, y) { return x + y; }, 0); });
  }
  function download(urls, onStep) {
    return caches.open(DATA_CACHE).then(function (c) {
      var done = 0, fail = 0, i = 0;
      // Tải 4 file một lúc cho nhanh mà không nghẽn mạng yếu.
      function worker() {
        if (i >= urls.length) return Promise.resolve();
        var u = urls[i++];
        return fetch(u, { cache: 'no-cache' }).then(function (r) {
          if (!r.ok) throw new Error(r.status);
          return c.put(u, r);
        }).then(function () { done++; }, function () { fail++; }).then(function () { onStep(done, fail); return worker(); });
      }
      return Promise.all([worker(), worker(), worker(), worker()]).then(function () { return { done: done, fail: fail }; });
    });
  }

  HD.renderAppPage = function (app) {
    var L = HD.lib;
    document.title = 'Cài app, học offline – Hana Dul';
    var h = '<div class="container narrow"><div class="lesson-hero" data-ko="앱 설치"><div class="crumbs"><a href="#/">Trang chủ</a></div>' +
      '<h1><span class="emoji">📲</span>Cài app, học không cần mạng</h1><p>Hana Dul cài được lên điện thoại, máy tính như một ứng dụng: mở nhanh từ màn hình chính, toàn màn hình, không cần tải từ kho ứng dụng. Miễn phí.</p></div>' +
      '<div class="panel pwa-panel"><h2>1. Cài lên màn hình chính</h2><div id="pwaInstallBox">' + installHtml() + '</div></div>' +
      '<div class="panel pwa-panel"><h2>2. Tải bài để học offline</h2>';
    if (!swOk || !window.caches) {
      h += '<p class="muted" id="pwaNoSupport">Trình duyệt này chưa hỗ trợ học offline. Hãy dùng Chrome, Edge hoặc Safari bản mới.</p>';
    } else {
      h += '<p class="muted">Bài nào bạn đã mở sẽ tự được lưu. Muốn đi đường, lên máy bay vẫn học được thì tải hết một lần (khoảng 1–2 MB).</p>' +
        '<p id="pwaStatus" class="pwa-status">Đang kiểm tra…</p><div class="pl-bar-track pwa-track" hidden><span id="pwaBar" style="width:0"></span></div>' +
        '<div class="actions" style="justify-content:flex-start"><button type="button" class="btn" id="pwaDownload" disabled>⬇️ Tải tất cả bài</button></div>';
    }
    h += '<p class="muted small-note">Khi không có mạng vẫn học bài, làm trắc nghiệm, thẻ từ, Ôn hôm nay, Sổ câu sai và đề thi thử; tiến độ lưu trên máy và tự đồng bộ vào tài khoản khi có mạng lại. ' +
      'Cần mạng: đăng nhập, bảng xếp hạng, chứng nhận. Giọng đọc tiếng Hàn trên một số máy Android cần mạng hoặc phải tải gói giọng nói trong cài đặt máy.</p></div></div>';
    app.innerHTML = h;
    var ib = document.getElementById('pwaInstallBox');
    ib.addEventListener('click', function (e) { if (e.target.closest('#pwaInstall')) install(); });
    var btn = document.getElementById('pwaDownload');
    if (!btn) return;
    var st = document.getElementById('pwaStatus');
    offlineList().then(function (list) {
      function paint(n) {
        st.innerHTML = n >= list.urls.length ? '✅ Đã tải đủ ' + list.lessons + ' bài và đề thi thử về máy này.' : 'Đã có ' + n + '/' + list.urls.length + ' file trên máy.';
        btn.textContent = n >= list.urls.length ? '🔄 Tải lại bản mới nhất' : '⬇️ Tải tất cả bài';
        btn.disabled = false;
      }
      countCached(list.urls).then(paint);
      btn.addEventListener('click', function () {
        btn.disabled = true;
        var track = app.querySelector('.pwa-track'), bar = document.getElementById('pwaBar');
        track.hidden = false;
        download(list.urls, function (d, f) {
          bar.style.width = Math.round((d + f) / list.urls.length * 100) + '%';
          st.textContent = 'Đang tải ' + (d + f) + '/' + list.urls.length + '…';
        }).then(function (r) {
          if (HD.track) HD.track('offline_download', { files: r.done, failed: r.fail });
          if (r.fail) { st.textContent = '⚠️ Tải được ' + r.done + '/' + list.urls.length + ' file. Kiểm tra mạng rồi bấm tải lại.'; btn.disabled = false; return; }
          countCached(list.urls).then(paint);
          L.toast('✅ Đã tải xong, giờ học được cả khi không có mạng.');
        });
      });
    }).catch(function () { st.textContent = 'Không tải được danh sách bài. Kiểm tra mạng rồi thử lại.'; });
  };

  function cardHtml() {
    return '<a class="continue pwa-card" href="#/ung-dung"><span class="emoji">📲</span>' +
      '<span><span class="label">Học cả khi không có mạng</span><br><span class="title">Cài Hana Dul như app</span></span><span class="go">→</span></a>';
  }
  // Trang chủ: người đã học (có XP) mà chưa cài app; Chrome báo cài được thì thẻ tự hiện vào chỗ trống.
  HD.pwaHomeCard = function () {
    if (standalone()) return '';
    var s = HD.lib && HD.lib.readStore();
    var show = (deferred || isIOS()) && s && s.xp > 0;
    return '<div id="pwaSlot">' + (show ? cardHtml() : '') + '</div>';
  };
  HD.pwa = { standalone: standalone, offlineList: offlineList };
})();
