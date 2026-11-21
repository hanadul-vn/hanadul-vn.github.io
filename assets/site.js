/* Phần dùng chung cho mọi trang: đo lượt truy cập, form đăng ký nhận bài mới, form cảm nhận. */
(function () {
  'use strict';

  var cfg = window.HANADUL_CONFIG || {};
  var SIGNUP_KEY = 'hanadul:signup';
  var HD = window.HD = {};

  // ---------- đo lượt truy cập (GA4) ----------
  var gaOn = /^G-[A-Z0-9]+$/i.test(cfg.gaId || '');
  if (gaOn) {
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(cfg.gaId);
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    // Trang học dùng #/..., nên tự gửi page_view theo từng màn (xem HD.pageview).
    window.gtag('config', cfg.gaId, { send_page_view: !document.body.hasAttribute('data-spa') });
  }
  HD.track = function (name, params) {
    if (gaOn) window.gtag('event', name, params || {});
  };
  // Màn trong trang học (#/bai/sc1-03) được ghi như một đường dẫn riêng (/bai/sc1-03) để xem bài nào được học nhiều.
  HD.pageview = function (title) {
    if (!gaOn) return;
    var path = '/' + location.hash.replace(/^#\/?/, '');
    window.gtag('event', 'page_view', {
      page_title: title || document.title,
      page_location: location.origin + path,
      page_path: path
    });
  };

  // ---------- localStorage an toàn ----------
  function getLS(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function setLS(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* chế độ ẩn danh */ } }
  HD.signedUp = function () { return getLS(SIGNUP_KEY) === '1'; };

  // ---------- có kênh liên hệ nào đang bật ----------
  HD.hasForm = !!(cfg.form && cfg.form.url);
  HD.hasZalo = !!cfg.zaloUrl;
  HD.hasFacebook = !!cfg.facebookUrl;
  HD.hasContact = HD.hasForm || HD.hasZalo || HD.hasFacebook;

  function esc(t) {
    return String(t).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Khối đăng ký nhận bài mới, dùng trong trang học (trang chủ và màn kết quả).
  HD.signupHtml = function (source, compact) {
    if (!HD.hasContact || HD.signedUp()) return '';
    var h = '<div class="signup-card' + (compact ? ' compact' : '') + '">' +
      '<div class="signup-ic" aria-hidden="true">💌</div><div class="signup-body">' +
      '<h3>Nhận thông báo khi có bài mới</h3>' +
      '<p class="muted">Mỗi khi có bài mới, Hana Dul báo bạn một lần. Không gửi quảng cáo.</p>';
    if (HD.hasForm) h += emailFormHtml(source);
    h += channelLinksHtml();
    return h + '</div></div>';
  };
  function emailFormHtml(source) {
    return '<form class="signup-form" data-form="dang-ky" data-source="' + esc(source) + '" novalidate>' +
      '<label class="sr-only" for="em-' + esc(source) + '">Email của bạn</label>' +
      '<input id="em-' + esc(source) + '" type="email" name="email" placeholder="Email của bạn" autocomplete="email" required>' +
      '<input type="text" name="_gotcha" tabindex="-1" autocomplete="off" class="hp" aria-hidden="true">' +
      '<button class="btn" type="submit">Đăng ký</button>' +
      '<p class="form-msg" role="status"></p></form>';
  }
  function channelLinksHtml() {
    var h = '';
    if (HD.hasZalo) h += '<a class="btn ghost small" href="' + esc(cfg.zaloUrl) + '" target="_blank" rel="noopener" data-channel="zalo">💬 Vào nhóm Zalo</a>';
    if (HD.hasFacebook) h += '<a class="btn ghost small" href="' + esc(cfg.facebookUrl) + '" target="_blank" rel="noopener" data-channel="facebook">👍 Theo dõi Facebook</a>';
    return h ? '<div class="channel-links">' + h + '</div>' : '';
  }

  // Trang tĩnh: bật/tắt các khối theo cấu hình, gắn link kênh.
  HD.applyConfig = function (root) {
    root = root || document;
    root.querySelectorAll('[data-needs]').forEach(function (el) {
      var need = el.getAttribute('data-needs');
      var on = need === 'form' ? HD.hasForm : need === 'zalo' ? HD.hasZalo : need === 'facebook' ? HD.hasFacebook : HD.hasContact;
      el.hidden = !on;
    });
    root.querySelectorAll('[data-hide-if]').forEach(function (el) {
      if (el.getAttribute('data-hide-if') === 'contact') el.hidden = HD.hasContact;
    });
    root.querySelectorAll('[data-channel="zalo"]').forEach(function (a) { a.href = cfg.zaloUrl || '#'; });
    root.querySelectorAll('[data-channel="facebook"]').forEach(function (a) { a.href = cfg.facebookUrl || '#'; });
  };

  // ---------- gửi form ----------
  function send(fields) {
    var f = cfg.form;
    if (f.type === 'google') {
      var map = f.fields || {};
      var body = new URLSearchParams();
      Object.keys(fields).forEach(function (k) { if (map[k]) body.append(map[k], fields[k]); });
      // Google Form không trả CORS: gửi được là coi như thành công.
      return fetch(f.url, { method: 'POST', mode: 'no-cors', body: body });
    }
    var fd = new FormData();
    Object.keys(fields).forEach(function (k) { fd.append(k, fields[k]); });
    return fetch(f.url, { method: 'POST', body: fd, headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r;
    });
  }

  function onSubmit(e) {
    var form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    var kind = form.getAttribute('data-form');
    var msg = form.querySelector('.form-msg');
    var btn = form.querySelector('button[type="submit"]');
    function say(text, bad) { msg.textContent = text; msg.classList.toggle('bad', !!bad); }
    if (!HD.hasForm) return say('Form đang tạm đóng, bạn quay lại sau nhé.', true);
    if (form.elements._gotcha && form.elements._gotcha.value) return; // bot

    var email = form.elements.email ? form.elements.email.value.trim() : '';
    var fields = { kind: kind, page: location.pathname + location.hash, source: form.getAttribute('data-source') || '' };
    if (kind === 'dang-ky') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return say('Email chưa đúng, bạn kiểm tra lại nhé.', true);
      fields.email = email;
      fields._subject = 'Hana Dul: đăng ký nhận bài mới';
    } else {
      var message = form.elements.message.value.trim();
      if (message.length < 10) return say('Bạn viết thêm vài chữ nữa nhé (ít nhất 10 ký tự).', true);
      fields.message = message;
      fields.name = form.elements.name.value.trim();
      if (email) fields.email = email;
      fields.publish = form.elements.publish && form.elements.publish.checked ? 'có' : 'không';
      fields._subject = 'Hana Dul: cảm nhận người học';
    }

    btn.disabled = true;
    say('Đang gửi…');
    send(fields).then(function () {
      if (kind === 'dang-ky') {
        setLS(SIGNUP_KEY, '1');
        HD.track('sign_up', { method: 'email', source: fields.source });
        form.innerHTML = '<p class="form-done">🎉 Đăng ký xong! Có bài mới Hana Dul sẽ báo bạn.</p>';
      } else {
        HD.track('feedback_sent', { publish: fields.publish });
        form.innerHTML = '<p class="form-done">💛 Cảm ơn bạn! Hana Dul đã nhận được cảm nhận.</p>';
      }
    }).catch(function () {
      btn.disabled = false;
      say('Chưa gửi được, bạn thử lại sau ít phút nhé.', true);
    });
  }
  document.addEventListener('submit', onSubmit);

  // Bấm vào nút kênh (Zalo/Facebook) cũng được ghi lại.
  document.addEventListener('click', function (e) {
    var a = e.target.closest('[data-channel]');
    if (a) HD.track('join_channel', { channel: a.getAttribute('data-channel') });
  });
})();
