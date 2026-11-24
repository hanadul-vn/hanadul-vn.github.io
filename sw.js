/* Service worker của Hana Dul: cho cài web như app (PWA) và học khi không có mạng.
   - Cùng tên miền: luôn lấy bản mới qua mạng trước (web cập nhật thường xuyên), lấy được thì lưu bản sao;
     mất mạng thì dùng bản đã lưu. Trang HTML chưa lưu thì trả trang chủ đã lưu.
   - Font Google: dùng bản đã lưu, đồng thời cập nhật nền.
   - Dịch vụ ngoài khác (tài khoản Supabase, Google Analytics, form góp ý) đi thẳng, không lưu.
   Nút "Tải tất cả bài" ở #/ung-dung (assets/pwa.js) ghi thẳng vào DATA_CACHE. */
'use strict';
var VERSION = '2026-11-23a';
var CORE_CACHE = 'hd-core-' + VERSION;
var DATA_CACHE = 'hd-data-v1';
var FONT_CACHE = 'hd-fonts-v1';
var CORE = [
  './', 'index.html', 'manifest.webmanifest',
  'assets/style.css', 'assets/icon.svg', 'assets/icon-192.png',
  'assets/config.js', 'assets/site.js', 'assets/merge.js', 'assets/move.js', 'assets/account.js', 'assets/exam.js', 'assets/rank.js',
  'assets/share.js', 'assets/review.js', 'assets/badges.js', 'assets/search.js', 'assets/placement.js', 'assets/cards.js', 'assets/pwa.js', 'assets/app.js',
  'data/index.json', 'data/placement.json', 'data/exams/index.json'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CORE_CACHE).then(function (c) {
    // Từng file một: thiếu 1 file cũng không làm hỏng cả lần cài.
    return Promise.all(CORE.map(function (u) { return c.add(new Request(u, { cache: 'reload' })).catch(function () {}); }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return /^hd-core-/.test(k) && k !== CORE_CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function cacheFor(url) {
  return /\/data\/|\/bai\//.test(url.pathname) ? DATA_CACHE : CORE_CACHE;
}
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (r) {
    if (r) return r;
    if (req.mode === 'navigate') return caches.match('index.html').then(function (x) { return x || caches.match('./'); });
    return undefined;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {
        var copy = res.clone();
        caches.open(cacheFor(url)).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return fromCache(req).then(function (r) { return r || new Response('Offline', { status: 503, statusText: 'Offline' }); });
    }));
    return;
  }
  if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(FONT_CACHE).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { if (res && (res.ok || res.type === 'opaque')) c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
  }
});
