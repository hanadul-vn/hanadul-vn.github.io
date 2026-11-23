/* Thẻ ảnh kết quả để chia sẻ lên Facebook/Zalo: vẽ bằng canvas ngay trên máy người học (không gửi gì lên server).
   HD.share.open({ kind, emoji, kicker, title, ko?, sub?, big?, bigLabel?, stats?: [[icon, chữ]…], url? })
   Điện thoại có Web Share (chia sẻ kèm tệp) thì bấm "Chia sẻ" rồi chọn Facebook/Zalo; máy tính thì tải ảnh về rồi đăng.
   Dùng được độc lập (trang chung-nhan.html), không cần assets/app.js. */
(function () {
  'use strict';

  var HD = window.HD = window.HD || {};
  var SIZE = 1080;
  var FONT = '"Be Vietnam Pro", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  var FONT_KO = '"Noto Sans KR", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  var EMOJI = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  var lastFocus = null;

  function esc(t) {
    return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function track(n, p) { if (HD.track) HD.track(n, p); }
  function siteHost() {
    var h = location.host;
    return /^(localhost|127\.|0\.0\.0\.0|\[)/.test(h) || !h ? 'hanadul-vn.github.io' : h;
  }
  function siteUrl(path) {
    var base = /^https?:$/.test(location.protocol) ? location.origin + location.pathname.replace(/[^/]*$/, '') : 'https://hanadul-vn.github.io/';
    return base + (path || 'gioi-thieu.html');
  }
  function fontsReady() {
    if (!document.fonts || !document.fonts.load) return Promise.resolve();
    var all = Promise.all([
      document.fonts.load('800 56px "Be Vietnam Pro"'),
      document.fonts.load('600 30px "Be Vietnam Pro"'),
      document.fonts.load('900 52px "Noto Sans KR"', '하나둘')
    ]).catch(function () {});
    return Promise.race([all, new Promise(function (r) { setTimeout(r, 1500); })]);
  }

  function round(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // Ngắt dòng theo độ rộng, tối đa max dòng (dòng cuối thêm …).
  function wrap(ctx, text, width, max) {
    var words = String(text || '').split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (ctx.measureText(t).width <= width || !cur) cur = t;
      else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    if (lines.length > max) {
      lines = lines.slice(0, max);
      var last = lines[max - 1];
      while (last.length > 1 && ctx.measureText(last + '…').width > width) last = last.slice(0, -1);
      lines[max - 1] = last + '…';
    }
    return lines;
  }

  function draw(o) {
    var c = document.createElement('canvas');
    c.width = c.height = SIZE;
    var ctx = c.getContext('2d');
    var g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    g.addColorStop(0, '#ff8a5c'); g.addColorStop(1, '#ff5470');
    ctx.fillStyle = g; ctx.fillRect(0, 0, SIZE, SIZE);

    // Thẻ trắng
    ctx.save();
    ctx.shadowColor = 'rgba(80, 20, 30, .25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    round(ctx, 60, 60, 960, 960, 48); ctx.fillStyle = '#ffffff'; ctx.fill();
    ctx.restore();
    // Chữ Hàn trang trí mờ ở góc
    ctx.save();
    round(ctx, 60, 60, 960, 960, 48); ctx.clip();
    ctx.fillStyle = '#fff4ec'; ctx.font = '900 260px ' + FONT_KO; ctx.textAlign = 'right'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('하나', 1050, 1000);
    ctx.restore();

    // Logo
    var lg = ctx.createLinearGradient(110, 110, 194, 194);
    lg.addColorStop(0, '#ff6b5b'); lg.addColorStop(1, '#ff5470');
    round(ctx, 110, 110, 84, 84, 24); ctx.fillStyle = lg; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '900 50px ' + FONT_KO; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('하', 152, 154);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#2a2136'; ctx.font = '800 44px ' + FONT; ctx.fillText('Hana Dul', 216, 148);
    ctx.fillStyle = '#6f6479'; ctx.font = '500 26px ' + FONT; ctx.fillText('Học tiếng Hàn miễn phí', 216, 186);

    ctx.textAlign = 'center';
    var cx = SIZE / 2, y = 290;
    if (o.kicker) {
      ctx.fillStyle = '#d9433a'; ctx.font = '800 30px ' + FONT;
      ctx.fillText(String(o.kicker).toUpperCase(), cx, y); y += 30;
    }
    if (o.emoji) {
      ctx.font = '120px ' + EMOJI; ctx.textBaseline = 'middle';
      ctx.fillText(o.emoji, cx, y + 80); ctx.textBaseline = 'alphabetic'; y += 175;
    }
    ctx.fillStyle = '#2a2136'; ctx.font = '800 56px ' + FONT + ', ' + FONT_KO;
    wrap(ctx, o.title, 840, 2).forEach(function (l) { y += 66; ctx.fillText(l, cx, y); });
    if (o.ko) { y += 50; ctx.fillStyle = '#6f6479'; ctx.font = '700 38px ' + FONT_KO; ctx.fillText(o.ko, cx, y); }
    if (o.sub) {
      ctx.fillStyle = '#6f6479'; ctx.font = '500 30px ' + FONT;
      y += 6;
      wrap(ctx, o.sub, 820, 2).forEach(function (l) { y += 42; ctx.fillText(l, cx, y); });
    }
    if (o.big) {
      y += 130;
      var fs = 120;
      ctx.font = '900 ' + fs + 'px ' + FONT;
      while (fs > 50 && ctx.measureText(o.big).width > 840) { fs -= 6; ctx.font = '900 ' + fs + 'px ' + FONT; }
      ctx.fillStyle = '#ff5470'; ctx.fillText(o.big, cx, y);
      if (o.bigLabel) { y += 46; ctx.fillStyle = '#6f6479'; ctx.font = '600 30px ' + FONT; ctx.fillText(o.bigLabel, cx, y); }
    }
    // Ô thông số
    var stats = (o.stats || []).slice(0, 3);
    if (stats.length) {
      ctx.font = '700 30px ' + FONT;
      var pads = stats.map(function (st) { return ctx.measureText(st[0] + '  ' + st[1]).width + 56; });
      var total = pads.reduce(function (a, b) { return a + b; }, 0) + 20 * (stats.length - 1);
      var sy = Math.max(y + 40, 850), sx = cx - total / 2;
      stats.forEach(function (st, i) {
        round(ctx, sx, sy, pads[i], 64, 32); ctx.fillStyle = i % 2 ? '#e3edff' : '#fff1cc'; ctx.fill();
        ctx.fillStyle = '#2a2136'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = '30px ' + EMOJI; ctx.fillText(st[0], sx + 40, sy + 34);
        ctx.font = '700 30px ' + FONT; ctx.textAlign = 'left'; ctx.fillText(st[1], sx + 64, sy + 34);
        sx += pads[i] + 20;
      });
      ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    }
    ctx.fillStyle = '#6f6479'; ctx.font = '600 26px ' + FONT;
    ctx.fillText(siteHost(), cx, 985);
    return c;
  }

  function close() {
    var m = document.getElementById('shareModal');
    if (!m) return;
    var img = m.querySelector('#shareDl');
    if (img && img.href && /^blob:/.test(img.href)) URL.revokeObjectURL(img.href);
    m.remove();
    document.removeEventListener('keydown', onKey);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  function open(o) {
    close();
    lastFocus = document.activeElement;
    var url = o.url || siteUrl();
    var file = 'hanadul-' + (o.kind || 'ket-qua') + '.png';
    var m = document.createElement('div');
    m.className = 'share-modal';
    m.id = 'shareModal';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'shareTitle');
    m.innerHTML = '<div class="share-box"><button type="button" class="share-close" id="shareClose" aria-label="Đóng">✕</button>' +
      '<h2 id="shareTitle">📸 Ảnh để khoe</h2>' +
      '<div class="share-preview"><p class="muted" id="shareWait">Đang tạo ảnh…</p></div>' +
      '<p class="muted share-hint">Điện thoại: bấm <b>Chia sẻ</b> rồi chọn Facebook hoặc Zalo. Máy tính: <b>Tải ảnh</b> về rồi đăng kèm bài viết.</p>' +
      '<div class="actions share-actions">' +
      '<button type="button" class="btn" id="shareNative" hidden>📤 Chia sẻ</button>' +
      '<a class="btn" id="shareDl" download="' + esc(file) + '" aria-disabled="true">⬇️ Tải ảnh</a>' +
      '<a class="btn ghost" id="shareFb" target="_blank" rel="noopener" href="https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url) + '">Facebook</a>' +
      '<button type="button" class="btn ghost" id="shareCopy">🔗 Sao chép link</button></div></div>';
    document.body.appendChild(m);
    document.addEventListener('keydown', onKey);
    m.addEventListener('click', function (e) { if (e.target === m) close(); });
    m.querySelector('#shareClose').addEventListener('click', close);
    m.querySelector('#shareClose').focus();
    m.querySelector('#shareFb').addEventListener('click', function () { track('share_card', { kind: o.kind, method: 'facebook' }); });
    m.querySelector('#shareCopy').addEventListener('click', function () {
      var b = this;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { b.textContent = '✅ Đã sao chép'; }, function () { b.textContent = url; });
      track('share_card', { kind: o.kind, method: 'copy' });
    });
    track('share_open', { kind: o.kind });

    fontsReady().then(function () {
      if (!document.getElementById('shareModal')) return;
      var canvas = draw(o);
      var alt = [o.kicker, o.title, o.big && o.big + ' ' + (o.bigLabel || '')].filter(Boolean).join(' · ');
      var img = new Image();
      img.id = 'shareImg';
      img.alt = 'Ảnh kết quả Hana Dul: ' + alt;
      img.src = canvas.toDataURL('image/png');
      var pv = m.querySelector('.share-preview');
      pv.innerHTML = '';
      pv.appendChild(img);
      canvas.toBlob(function (blob) {
        if (!blob || !document.getElementById('shareModal')) return;
        var dl = m.querySelector('#shareDl');
        dl.href = URL.createObjectURL(blob);
        dl.removeAttribute('aria-disabled');
        dl.addEventListener('click', function () { track('share_card', { kind: o.kind, method: 'download' }); });
        var f = typeof File === 'function' ? new File([blob], file, { type: 'image/png' }) : null;
        var nat = m.querySelector('#shareNative');
        if (f && navigator.canShare && navigator.canShare({ files: [f] })) {
          nat.hidden = false;
          nat.addEventListener('click', function () {
            navigator.share({ files: [f], title: 'Hana Dul', text: alt + ' – học tiếng Hàn miễn phí: ' + url }).then(function () {
              track('share_card', { kind: o.kind, method: 'native' });
            }).catch(function () { /* người dùng hủy */ });
          });
        }
      }, 'image/png');
    });
  }

  HD.share = { open: open, close: close, draw: draw };
})();
