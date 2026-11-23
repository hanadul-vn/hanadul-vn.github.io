// Test hàm gộp tiến độ (assets/merge.js). Chạy: node tests/merge.test.js
'use strict';
const assert = require('assert');
const { merge, sameData, hasProgress } = require('../assets/merge.js');

const NOW = Date.parse('2026-11-21T12:00:00Z');
let pass = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '\n ', e.message); process.exitCode = 1; }
}

t('M1 khách lần đầu đăng nhập, tài khoản trống: giữ nguyên toàn bộ tiến độ máy', () => {
  const local = { lessons: { a: { best: 80, stars: 2, last: '2026-11-20' } }, xp: 120, days: ['2026-11-20'], last: 'a', wrong: { q1: { item: {}, n: 1, ok: 0, t: '2026-11-20' } }, writing: { a: '안녕' } };
  const m = merge(local, null, NOW);
  assert.strictEqual(m.xp, 120);
  assert.deepStrictEqual(m.lessons.a, { best: 80, stars: 2, last: '2026-11-20' });
  assert.deepStrictEqual(m.days, ['2026-11-20']);
  assert.ok(m.wrong.q1);
  assert.strictEqual(m.writing.a, '안녕');
  assert.strictEqual(m.last, 'a');
});

t('M2 gộp khách vào tài khoản đã có: XP cộng, bài lấy điểm cao nhất, ngày hợp lại', () => {
  const local = { lessons: { a: { best: 60, stars: 1, last: '2026-11-21' }, b: { best: 90, stars: 3, last: '2026-11-21' } }, xp: 50, days: ['2026-11-21'] };
  const remote = { lessons: { a: { best: 85, stars: 2, last: '2026-11-19' } }, xp: 300, days: ['2026-11-19', '2026-11-20'] };
  const m = merge(local, remote, NOW);
  assert.strictEqual(m.xp, 350);
  assert.deepStrictEqual(m.lessons.a, { best: 85, stars: 2, last: '2026-11-21' });
  assert.strictEqual(m.lessons.b.best, 90);
  assert.deepStrictEqual(m.days, ['2026-11-19', '2026-11-20', '2026-11-21']);
});

t('M3 đồng bộ lặp lại không cộng trùng XP', () => {
  const remote = { xp: 300 };
  const local = { xp: 300, xpSynced: 300 };
  assert.strictEqual(merge(local, remote, NOW).xp, 300);
});

t('M4 hai máy cùng kiếm XP: không mất phần nào', () => {
  // Máy A đồng bộ lúc tài khoản có 100, sau đó kiếm thêm 30. Trong lúc đó máy B đẩy tài khoản lên 150.
  const local = { xp: 130, xpSynced: 100 };
  assert.strictEqual(merge(local, { xp: 150 }, NOW).xp, 180);
});

t('M5 Sổ câu sai: câu đã gỡ trên máy khác (mới hơn) thì gỡ luôn', () => {
  const local = { wrong: { q1: { item: {}, n: 1, ok: 1, ts: 1000 } } };
  const remote = { wrong: {}, wrongDel: { q1: 2000 } };
  const m = merge(local, remote, 3000);
  assert.ok(!m.wrong.q1);
  assert.strictEqual(m.wrongDel.q1, 2000);
});

t('M6 Sổ câu sai: sai lại sau khi đã gỡ thì câu quay lại sổ', () => {
  const local = { wrong: { q1: { item: {}, n: 2, ok: 0, ts: 5000 } } };
  const remote = { wrongDel: { q1: 2000 } };
  const m = merge(local, remote, 6000);
  assert.ok(m.wrong.q1);
  assert.ok(!m.wrongDel.q1);
});

t('M7 Sổ câu sai: cùng câu ở 2 nơi lấy bản mới hơn; câu riêng mỗi nơi giữ cả hai', () => {
  const local = { wrong: { q1: { item: {}, n: 1, ok: 1, ts: 9000 }, q2: { item: {}, n: 1, ok: 0, ts: 1 } } };
  const remote = { wrong: { q1: { item: {}, n: 3, ok: 0, ts: 4000 }, q3: { item: {}, n: 1, ok: 0, t: '2026-11-01' } } };
  const m = merge(local, remote, NOW);
  assert.strictEqual(m.wrong.q1.ok, 1);
  assert.deepStrictEqual(Object.keys(m.wrong).sort(), ['q1', 'q2', 'q3']);
});

t('M8 dữ liệu cũ chưa có ts vẫn so được theo ngày t', () => {
  const local = { wrong: { q1: { item: {}, n: 1, ok: 0, t: '2026-11-10' } } };
  const remote = { wrongDel: { q1: Date.parse('2026-11-15T00:00:00') } };
  assert.ok(!merge(local, remote, NOW).wrong.q1);
});

t('M9 dấu gỡ quá 120 ngày được dọn', () => {
  const m = merge({ wrongDel: { old: NOW - 200 * 864e5, recent: NOW - 5 * 864e5 } }, null, NOW);
  assert.deepStrictEqual(Object.keys(m.wrongDel), ['recent']);
});

t('M10 bài viết: lấy bản sửa sau cùng', () => {
  const local = { writing: { a: 'cũ', b: 'chỉ máy này' }, writingAt: { a: 100, b: 50 } };
  const remote = { writing: { a: 'mới' }, writingAt: { a: 200 } };
  const m = merge(local, remote, NOW);
  assert.strictEqual(m.writing.a, 'mới');
  assert.strictEqual(m.writing.b, 'chỉ máy này');
});

t('M11 bài gần nhất: lấy theo lastAt mới hơn', () => {
  assert.strictEqual(merge({ last: 'a', lastAt: 100 }, { last: 'b', lastAt: 200 }, NOW).last, 'b');
  assert.strictEqual(merge({ last: 'a', lastAt: 300 }, { last: 'b', lastAt: 200 }, NOW).last, 'a');
  assert.strictEqual(merge({}, { last: 'b' }, NOW).last, 'b');
});

t('M12 chuỗi ngày giữ tối đa 400 ngày gần nhất, không trùng', () => {
  const days = [];
  for (let i = 0; i < 450; i++) days.push(new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10));
  const m = merge({ days: days.slice(0, 300) }, { days: days.slice(200) }, NOW);
  assert.strictEqual(m.days.length, 400);
  assert.strictEqual(m.days[399], days[449]);
});

t('M13 merge có tính lũy đẳng: gộp kết quả với chính nó không đổi', () => {
  const local = { lessons: { a: { best: 60, stars: 1, last: '2026-11-21' } }, xp: 50, days: ['2026-11-21'], wrong: { q: { item: {}, n: 1, ok: 0, ts: 10 } } };
  const m1 = merge(local, { xp: 10 }, NOW);
  const m2 = merge(Object.assign({}, m1, { xpSynced: m1.xp }), m1, NOW);
  assert.ok(sameData(m1, m2));
});

t('M14 dữ liệu hỏng / null không làm lỗi', () => {
  const m = merge(null, { xp: 'abc', days: 'x', lessons: [1], wrong: null }, NOW);
  assert.strictEqual(m.xp, 0);
  assert.deepStrictEqual(m.days, []);
  assert.deepStrictEqual(m.lessons, {});
});

t('M15 sameData bỏ qua trường chỉ dùng trên máy; hasProgress', () => {
  assert.ok(sameData({ xp: 5, owner: 'u', xpSynced: 5 }, { xp: 5 }));
  assert.ok(!sameData({ xp: 5 }, { xp: 6 }));
  assert.ok(!hasProgress({}));
  assert.ok(hasProgress({ days: ['2026-11-21'] }));
});


t('M16 đề thi thử: giữ điểm cao nhất, lượt gần nhất theo thời điểm nộp, số lượt lấy lớn nhất', () => {
  const local = { exams: { 'doc-01': { best: 70, last: 70, at: 2000, n: 3, ans: '0123', secs: 3000 } } };
  const remote = { exams: { 'doc-01': { best: 84, last: 60, at: 1000, n: 2, ans: '3210', secs: 4000 }, 'doc-02': { best: 50, last: 50, at: 500, n: 1 } } };
  const m = merge(local, remote, NOW);
  assert.deepStrictEqual(m.exams['doc-01'], { best: 84, last: 70, at: 2000, n: 3, ans: '0123', secs: 3000 });
  assert.strictEqual(m.exams['doc-02'].best, 50);
  assert.ok(hasProgress({ exams: { x: { best: 10 } } }), 'chỉ có điểm thi thử cũng là có tiến độ');
  assert.ok(!sameData({ exams: {} }, { exams: { x: { best: 1 } } }));
});

t('M17 dữ liệu đề thi thử hỏng (không phải object) bị bỏ qua, không làm lỗi', () => {
  const m = merge({ exams: 'x' }, { exams: { a: 'y', b: { best: 'z', at: 5 } } }, NOW);
  assert.deepStrictEqual(m.exams.a, { best: 0, n: 0, last: 0, at: 0 });
  assert.strictEqual(m.exams.b.best, 0);
});

t('M18 đề Viết: bài viết và điểm tự chấm theo bản tự chấm gần nhất (gat), không theo máy nộp sau', () => {
  const a = { exams: { 'viet-01': { best: 23, pb: 0, last: 23, at: 1000, gat: 5000, n: 1, secs: 600, texts: { 53: '가나다' }, self: { '53-0': 1 } } } };
  const b = { exams: { 'viet-01': { best: 5, pb: 0, last: 5, at: 1000, n: 1, secs: 600, texts: { 53: '가나다' }, self: {} } } };
  const m = merge(b, a, NOW).exams['viet-01'];
  assert.deepStrictEqual(m, { best: 23, n: 1, last: 23, at: 1000, secs: 600, texts: { 53: '가나다' }, self: { '53-0': 1 }, pb: 0, gat: 5000 });
  const c = { exams: { 'viet-01': { best: 10, pb: 23, last: 10, at: 9000, n: 2, texts: { 54: '라' }, self: {} } } };
  const m2 = merge(a, c, NOW).exams['viet-01'];
  assert.strictEqual(m2.last, 10); assert.strictEqual(m2.best, 23); assert.deepStrictEqual(m2.texts, { 54: '라' }); assert.strictEqual(m2.n, 2);
  assert.ok(!('texts' in merge({ exams: { d: { best: 1, at: 1 } } }, {}, NOW).exams.d), 'đề Đọc không thêm trường Viết');
});

console.log(`\n${pass} test pass`);
