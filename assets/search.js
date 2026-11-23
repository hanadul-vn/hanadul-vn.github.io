/* Ô "Tra từ, ngữ pháp": tìm trong mọi bài (data/search.json, sinh bởi tools/build_pages.py).
   Dùng chung cho trang học (#/…, body có data-spa) và trang tĩnh bai/<id>/ (body có data-base).
   - Gõ chữ Hàn: so phần chữ Hàn (bỏ dấu cách, ngoặc, gạch), nên "으니까" khớp "-(으)니까".
   - Gõ tiếng Việt: không cần dấu ("truong hoc" khớp "trường học"). */
(function () {
  'use strict';
  var MAX_W = 8, MAX_G = 6;
  var HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;
  var spa = document.body.hasAttribute('data-spa');
  var base = document.body.getAttribute('data-base') || '';
  var loading = null, idx = null;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Bỏ dấu tiếng Việt, giữ nguyên chữ Hàn (NFC ghép lại âm tiết Hàn sau khi tách).
  function vn(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC')
      .replace(/đ/g, 'd').replace(/\s+/g, ' ').trim();
  }
  function hg(s) { return String(s || '').replace(/[^\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/g, ''); }

  function load() {
    if (!loading) {
      loading = fetch(base + 'data/search.json').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        // Khóa so sánh tính sẵn một lần.
        d.w.forEach(function (x) { x.k = hg(x[0]); x.v = vn(x[1]); });
        d.g.forEach(function (x) { x.k = hg(x[0]); x.v = vn(x[1]); });
        idx = d;
        return d;
      }).catch(function (e) { loading = null; throw e; });
    }
    return loading;
  }

  // Điểm càng nhỏ càng khớp: 0 trùng hẳn, 1 bắt đầu bằng, 2 đầu một từ, 3 nằm giữa. -1 = không khớp.
  function score(hay, q) {
    if (!hay || !q) return -1;
    if (hay === q) return 0;
    var i = hay.indexOf(q);
    if (i < 0) return -1;
    if (i === 0) return 1;
    return /[\s,(;/]/.test(hay.charAt(i - 1)) ? 2 : 3;
  }
  // Nghĩa tiếng Việt: so với từng nghĩa tách bởi dấu phẩy để "trường" xếp "trường học" trước "nhà trường cũ".
  function scoreVi(v, q) {
    var best = score(v, q);
    if (best < 0) return -1;
    v.split(/[,;]/).forEach(function (p) {
      var s = score(p.replace(/\(.*?\)/g, '').trim(), q);
      if (s >= 0 && s < best) best = s;
    });
    return best;
  }

  function find(q) {
    var isKo = HANGUL.test(q);
    var qk = isKo ? hg(q) : '';
    var qv = vn(q);
    if (isKo ? !qk : qv.length < 2) return null;
    function run(list) {
      var out = [];
      list.forEach(function (x) {
        var s = isKo ? score(x.k, qk) : scoreVi(x.v, qv);
        if (s >= 0) out.push({ x: x, s: s });
      });
      out.sort(function (a, b) { return a.s - b.s || a.x[0].length - b.x[0].length || a.x[2] - b.x[2]; });
      // Cùng một từ/nghĩa ở nhiều bài: giữ tất cả (người học thấy từ xuất hiện ở bài nào).
      return out;
    }
    return { w: run(idx.w), g: run(idx.g), q: q };
  }

  function href(li, kind, n) {
    var id = idx.l[li][0];
    return spa ? '#/bai/' + id : base + 'bai/' + id + '/#' + kind + n;
  }

  function item(x, kind) {
    return '<li><a class="sr-item" href="' + esc(href(x[2], kind, x[3])) + '" data-kind="' + kind + '" data-n="' + x[3] + '">' +
      '<span class="sr-ko ko" lang="ko">' + esc(x[0]) + '</span>' +
      (x[1] ? '<span class="sr-vi">' + esc(x[1]) + '</span>' : '') +
      '<span class="sr-where">' + esc(idx.l[x[2]][1]) + '</span></a></li>';
  }

  function render(box, res) {
    var out = box.querySelector('.search-results');
    if (!res) { out.innerHTML = ''; return; }
    if (!res.w.length && !res.g.length) {
      out.innerHTML = '<p class="sr-empty muted">Không tìm thấy “' + esc(res.q) + '” trong các bài hiện có.</p>';
      return;
    }
    var h = '';
    if (res.g.length) {
      h += '<h3 class="sr-head">Ngữ pháp <span class="muted">(' + res.g.length + ')</span></h3><ul class="sr-list">' +
        res.g.slice(0, MAX_G).map(function (r) { return item(r.x, 'g'); }).join('') + '</ul>';
    }
    if (res.w.length) {
      h += '<h3 class="sr-head">Từ vựng <span class="muted">(' + res.w.length + ')</span></h3><ul class="sr-list">' +
        res.w.slice(0, MAX_W).map(function (r) { return item(r.x, 't'); }).join('') + '</ul>';
    }
    var more = Math.max(0, res.w.length - MAX_W) + Math.max(0, res.g.length - MAX_G);
    if (more) h += '<p class="sr-more muted">Còn ' + more + ' kết quả khác, gõ cụ thể hơn để thu hẹp.</p>';
    out.innerHTML = h;
  }

  var timer = null;
  function onInput(input) {
    var box = input.closest('[data-search]');
    var q = input.value.trim();
    clearTimeout(timer);
    if (!q) return render(box, null);
    timer = setTimeout(function () {
      load().then(function () {
        if (input.value.trim() === q) render(box, find(q));
      }).catch(function () {
        box.querySelector('.search-results').innerHTML = '<p class="sr-empty muted">Không tải được dữ liệu tra cứu. Thử tải lại trang.</p>';
      });
    }, 120);
  }

  document.addEventListener('input', function (e) {
    if (e.target.classList && e.target.classList.contains('search-input')) onInput(e.target);
  });
  // Tải sẵn chỉ mục khi người học bấm vào ô.
  document.addEventListener('focusin', function (e) {
    if (e.target.classList && e.target.classList.contains('search-input')) load().catch(function () {});
  });
  document.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t.classList || !t.classList.contains('search-input')) return;
    if (e.key === 'Escape') { t.value = ''; onInput(t); }
    if (e.key === 'Enter') {
      var first = t.closest('[data-search]').querySelector('.sr-item');
      if (first) { e.preventDefault(); first.click(); }
    }
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('.sr-item');
    if (!a) return;
    var input = a.closest('[data-search]').querySelector('.search-input');
    if (window.HD && HD.track) HD.track('search', { search_term: input ? input.value.trim() : '' });
    // Trang học: nhớ mục cần làm nổi bật, trang bài đọc khi vẽ xong (app.js).
    if (spa && window.HD) HD.searchFocus = { kind: a.getAttribute('data-kind'), n: +a.getAttribute('data-n') };
  });

  // Trang tĩnh: mở từ kết quả tra (#t12, #g2) thì làm nổi bật mục đó.
  function flashHash() {
    var m = /^#([tg]\d+)$/.exec(location.hash);
    var el = m && document.getElementById(m[1]);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }
  if (!spa) {
    window.addEventListener('hashchange', flashHash);
    flashHash();
  }

  window.HDSearch = {
    html: function () {
      return '<div class="search" data-search>' +
        '<label class="search-label" for="tra-cuu">🔎 Tra từ, ngữ pháp trong mọi bài</label>' +
        '<input id="tra-cuu" class="search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Ví dụ: 학교, trường học, 으니까" aria-describedby="tra-cuu-kq">' +
        '<div id="tra-cuu-kq" class="search-results" aria-live="polite"></div></div>';
    },
    find: function (q) { return load().then(function () { return find(q); }); }
  };
})();
