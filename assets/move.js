/* Chuyển nhà: hanadul-vn.github.io → hanadul.app.
   localStorage gắn theo tên miền, nên tiến độ của người chưa đăng nhập không tự sang tên miền mới.
   - Ở tên miền cũ: kiểm tra tên miền mới đã chạy, rồi chuyển sang cùng trang, mang theo dữ liệu
     "hanadul:*" (trừ phiên đăng nhập) trong phần # của đường dẫn (phần # không gửi lên máy chủ nào).
   - Ở tên miền mới: chỉ nhận dữ liệu khi trang trước là tên miền cũ, gộp vào máy này rồi xóa phần #
     trước khi app và Google Analytics đọc địa chỉ trang.
   File phải nạp sớm trong <head>, ngay sau merge.js và trước mọi script khác. */
(function () {
  'use strict';
  var OLD_HOST = 'hanadul-vn.github.io';
  var NEW_ORIGIN = 'https://hanadul.app';
  var PARAM = 'hd-move=';
  var MOVED_KEY = 'hanadul:moved';
  var SKIP = { 'hanadul:auth': 1, 'hanadul:moved': 1 }; // phiên đăng nhập không mang theo: đăng nhập lại 1 lần
  var STORE_KEY = 'hanadul:v2';

  function ls() { try { return window.localStorage; } catch (e) { return null; } }
  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64decode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // ---------- Tên miền cũ: chuyển đi ----------
  if (location.hostname === OLD_HOST) {
    var store = ls();
    var pack = null;
    if (store && !store.getItem(MOVED_KEY)) {
      var data = {}, n = 0;
      for (var i = 0; i < store.length; i++) {
        var k = store.key(i);
        if (k && k.indexOf('hanadul:') === 0 && !SKIP[k]) { data[k] = store.getItem(k); n++; }
      }
      if (n) pack = b64encode(JSON.stringify(data));
    }
    var target = NEW_ORIGIN + location.pathname + location.search;
    if (pack || location.hash) target += '#' + PARAM + (pack || '') + '&h=' + encodeURIComponent(location.hash);

    // Chỉ chuyển khi tên miền mới đã trả lời; lỗi mạng thì ở lại trang cũ, học bình thường.
    var root = document.documentElement;
    root.style.visibility = 'hidden';
    var shown = false;
    function show() { if (!shown) { shown = true; root.style.visibility = ''; } }
    var timer = setTimeout(show, 2500);
    fetch(NEW_ORIGIN + '/robots.txt?move=' + Date.now(), { mode: 'no-cors', cache: 'no-store' }).then(function () {
      clearTimeout(timer);
      if (pack && store) { try { store.setItem(MOVED_KEY, String(Date.now())); } catch (e) { /* bỏ qua */ } }
      location.replace(target);
    }, show);
    return;
  }

  // ---------- Tên miền mới: nhận dữ liệu ----------
  var h = location.hash;
  if (h.indexOf('#' + PARAM) !== 0) return;
  var rest = h.slice(1 + PARAM.length);
  var amp = rest.indexOf('&h=');
  var payload = amp < 0 ? rest : rest.slice(0, amp);
  var origHash = '';
  if (amp >= 0) { try { origHash = decodeURIComponent(rest.slice(amp + 3)); } catch (e) { origHash = ''; } }
  if (origHash && origHash.charAt(0) !== '#') origHash = '';
  // Xóa dữ liệu khỏi địa chỉ trang ngay (không để lọt vào lịch sử, thống kê, link chia sẻ).
  history.replaceState(null, '', location.pathname + location.search + origHash);

  var fromOld = false;
  try { fromOld = new URL(document.referrer).hostname === OLD_HOST; } catch (e) { fromOld = false; }
  var store2 = ls();
  if (!payload || !fromOld || !store2) return;

  var incoming;
  try { incoming = JSON.parse(b64decode(payload)); } catch (e) { return; }
  if (!incoming || typeof incoming !== 'object') return;
  Object.keys(incoming).forEach(function (k) {
    var v = incoming[k];
    if (k.indexOf('hanadul:') !== 0 || SKIP[k] || typeof v !== 'string') return;
    var cur = store2.getItem(k);
    try {
      if (k === STORE_KEY) {
        var inc = JSON.parse(v);
        if (!inc || typeof inc !== 'object' || Array.isArray(inc)) return;
        var here = cur ? JSON.parse(cur) : null;
        if (here && typeof here === 'object' && window.HDMerge) {
          // Đã có tiến độ ở tên miền mới: gộp hai bên (merge.js nạp trước file này).
          var merged = window.HDMerge.merge(inc, here);
          if (here.owner) merged.owner = here.owner;
          if (typeof here.xpSynced === 'number') merged.xpSynced = here.xpSynced;
          store2.setItem(k, JSON.stringify(merged));
        } else if (!here) {
          store2.setItem(k, v);
        }
      } else if (cur === null) {
        store2.setItem(k, v);
      }
    } catch (e) { /* dữ liệu hỏng: bỏ qua */ }
  });
})();
