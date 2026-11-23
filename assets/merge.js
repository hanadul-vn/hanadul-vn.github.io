/* Gộp tiến độ học giữa máy này (localStorage) và tài khoản (server).
   Hàm thuần, không đụng DOM hay mạng: dùng chung cho trình duyệt và test (node tests/merge.test.js). */
(function (root) {
  'use strict';

  var DAYS_MAX = 400;
  var TOMBSTONE_DAYS = 120;

  function obj(x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; }
  function num(x) { return typeof x === 'number' && isFinite(x) ? x : 0; }

  // Dữ liệu cũ (trước khi có tài khoản) chưa có ts: lấy theo ngày ghi trong t.
  function entryTs(e) {
    if (!e) return 0;
    if (num(e.ts)) return e.ts;
    var t = e.t ? Date.parse(e.t + 'T00:00:00') : 0;
    return isFinite(t) ? t : 0;
  }

  function normalize(s) {
    s = obj(s);
    return {
      lessons: obj(s.lessons),
      xp: num(s.xp),
      days: Array.isArray(s.days) ? s.days.filter(function (d) { return typeof d === 'string'; }) : [],
      last: typeof s.last === 'string' ? s.last : null,
      lastAt: num(s.lastAt),
      wrong: obj(s.wrong),
      wrongDel: obj(s.wrongDel),
      writing: obj(s.writing),
      writingAt: obj(s.writingAt),
      exams: obj(s.exams),
      srs: obj(s.srs),
      srsLog: obj(s.srsLog),
      badges: obj(s.badges)
    };
  }

  // Ôn hôm nay (ôn ngắt quãng): mỗi từ lấy bản có lần trả lời mới nhất (ts). Từ chỉ được thêm vào
  // mà chưa trả lời lần nào có ts = 0 nên luôn nhường bản đã ôn ở máy khác.
  function mergeSrs(a, b) {
    var out = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
      if (out[k]) return;
      var x = a[k], y = b[k];
      var okx = x && typeof x === 'object', oky = y && typeof y === 'object';
      if (!okx && !oky) return;
      out[k] = !oky || (okx && num(x.ts) >= num(y.ts)) ? x : y;
    });
    return out;
  }
  // Số từ đã ôn theo ngày: lấy số lớn hơn.
  function mergeMax(a, b) {
    var out = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) { out[k] = Math.max(num(a[k]), num(b[k])); });
    return out;
  }
  // Huy hiệu: đã đạt ở máy nào cũng giữ, ngày đạt lấy ngày sớm nhất.
  function mergeBadges(a, b) {
    var out = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (k) {
      var x = num(a[k]), y = num(b[k]);
      var v = x && y ? Math.min(x, y) : x || y;
      if (v) out[k] = v;
    });
    return out;
  }

  // Đề thi thử: điểm cao nhất giữ lại; lượt làm gần nhất (điểm, đáp án đã chọn) lấy theo thời điểm nộp mới hơn.
  function mergeExams(a, b) {
    var out = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (id) {
      if (out[id]) return;
      var x = obj(a[id]), y = obj(b[id]);
      // Bản mới hơn: theo lần nộp (at) hoặc lần tự chấm gần nhất (gat, phần Viết).
      var tx = Math.max(num(x.at), num(x.gat)), ty = Math.max(num(y.at), num(y.gat));
      var newer = tx >= ty ? x : y;
      var e = { best: Math.max(num(x.best), num(y.best)), n: Math.max(num(x.n), num(y.n)), last: num(newer.last), at: num(newer.at) };
      if (typeof newer.ans === 'string') e.ans = newer.ans;
      if (num(newer.secs)) e.secs = num(newer.secs);
      if (newer.texts && typeof newer.texts === 'object') {
        e.texts = newer.texts; e.self = obj(newer.self); e.pb = num(newer.pb);
        if (num(newer.gat)) e.gat = num(newer.gat);
      }
      out[id] = e;
    });
    return out;
  }

  function mergeLessons(a, b) {
    var out = {};
    Object.keys(a).concat(Object.keys(b)).forEach(function (id) {
      if (out[id]) return;
      var x = obj(a[id]), y = obj(b[id]);
      var lx = typeof x.last === 'string' ? x.last : '', ly = typeof y.last === 'string' ? y.last : '';
      out[id] = { best: Math.max(num(x.best), num(y.best)), stars: Math.max(num(x.stars), num(y.stars)), last: lx > ly ? lx : ly || lx };
    });
    return out;
  }

  // Sổ câu sai: câu nào có thay đổi mới nhất (ghi sai, hoặc bị gỡ khỏi sổ) thì thắng.
  function mergeWrong(a, b, now) {
    var wrong = {}, del = {};
    var ids = {};
    [a.wrong, b.wrong, a.wrongDel, b.wrongDel].forEach(function (m) { Object.keys(m).forEach(function (k) { ids[k] = 1; }); });
    var cutoff = now - TOMBSTONE_DAYS * 864e5;
    Object.keys(ids).forEach(function (id) {
      var ea = a.wrong[id], eb = b.wrong[id];
      var e = ea && eb ? (entryTs(ea) >= entryTs(eb) ? ea : eb) : ea || eb;
      var d = Math.max(num(a.wrongDel[id]), num(b.wrongDel[id]));
      if (e && entryTs(e) > d) wrong[id] = e;
      else if (d && d >= cutoff) del[id] = d;
    });
    return { wrong: wrong, wrongDel: del };
  }

  function mergeWriting(a, b) {
    var w = {}, at = {};
    Object.keys(a.writing).concat(Object.keys(b.writing)).forEach(function (id) {
      if (id in w) return;
      var ta = num(a.writingAt[id]), tb = num(b.writingAt[id]);
      var va = a.writing[id], vb = b.writing[id];
      var useA = va != null && (vb == null || ta >= tb);
      w[id] = useA ? va : vb;
      var t = useA ? ta : tb;
      if (t) at[id] = t;
    });
    return { writing: w, writingAt: at };
  }

  /* local: dữ liệu trên máy (có thể kèm xpSynced = XP lúc đồng bộ lần trước).
     remote: dữ liệu trong tài khoản (null nếu tài khoản chưa có gì).
     XP cộng dồn: XP tài khoản + phần XP máy này kiếm thêm từ lần đồng bộ trước,
     để học song song trên 2 máy không mất điểm và đồng bộ nhiều lần không bị cộng trùng. */
  function merge(local, remote, now) {
    now = now || Date.now();
    var lraw = obj(local);
    var a = normalize(local), b = normalize(remote);
    var gained = Math.max(0, a.xp - num(lraw.xpSynced));
    var days = {};
    a.days.concat(b.days).forEach(function (d) { days[d] = 1; });
    var useALast = a.last && (!b.last || a.lastAt >= b.lastAt);
    var wr = mergeWrong(a, b, now);
    var wt = mergeWriting(a, b);
    return {
      lessons: mergeLessons(a.lessons, b.lessons),
      xp: (remote ? b.xp : 0) + gained,
      days: Object.keys(days).sort().slice(-DAYS_MAX),
      last: useALast ? a.last : b.last || a.last,
      lastAt: useALast ? a.lastAt : b.lastAt || a.lastAt,
      wrong: wr.wrong,
      wrongDel: wr.wrongDel,
      writing: wt.writing,
      writingAt: wt.writingAt,
      exams: mergeExams(a.exams, b.exams),
      srs: mergeSrs(a.srs, b.srs),
      srsLog: mergeMax(a.srsLog, b.srsLog),
      badges: mergeBadges(a.badges, b.badges)
    };
  }

  // So sánh nội dung (bỏ qua trường chỉ dùng trên máy như owner, xpSynced).
  function sameData(x, y) {
    return JSON.stringify(stable(normalize(x))) === JSON.stringify(stable(normalize(y)));
  }
  function stable(v) {
    if (Array.isArray(v)) return v.map(stable);
    if (v && typeof v === 'object') {
      var o = {};
      Object.keys(v).sort().forEach(function (k) { o[k] = stable(v[k]); });
      return o;
    }
    return v;
  }
  function hasProgress(s) {
    s = normalize(s);
    return s.xp > 0 || s.days.length > 0 || Object.keys(s.lessons).length > 0 || Object.keys(s.wrong).length > 0 || Object.keys(s.exams).length > 0 || Object.keys(s.srs).length > 0;
  }

  var api = { merge: merge, sameData: sameData, normalize: normalize, hasProgress: hasProgress };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HDMerge = api;
})(this);
