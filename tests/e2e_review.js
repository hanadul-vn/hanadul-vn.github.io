// Test Ôn hôm nay (assets/review.js), huy hiệu (assets/badges.js) và thẻ ảnh chia sẻ (assets/share.js).
// Chạy: python3 -m http.server 8765 (ở thư mục gốc repo), rồi node tests/e2e_review.js   (ONLY=C01,B01 chạy riêng; SHOTS=/thư-mục để lưu ảnh)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8765/';
const SHOTS = process.env.SHOTS || '';
const ROOT = path.resolve(__dirname, '..');
const KEY = 'hanadul:v2';
const LES = (id) => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/lessons', id + '.json'), 'utf8'));
const WORDS = (d) => { const s = new Set(); d.vocab.forEach((g) => g.words.forEach((w) => s.add(w[0]))); return [...s]; };
const EXAMS = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/exams/index.json'), 'utf8'));

function ymd(n) {
  const d = new Date(); d.setDate(d.getDate() + (n || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const results = [];
async function tc(id, name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) return;
  try { await fn(); results.push([id, name, 'PASS']); console.log('PASS', id, name); }
  catch (e) { results.push([id, name, 'FAIL: ' + e.message.split('\n')[0]]); console.log('FAIL', id, name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n   ')); process.exitCode = 1; }
}
async function device(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1100, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' }, opts.ctx || {}));
  await require('./stub_third_party')(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/supabase\.co\//, (r) => r.abort());
  await ctx.route('**/assets/config.js', async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace(/supabaseUrl: '[^']*'/, "supabaseUrl: ''").replace(/supabaseKey: '[^']*'/, "supabaseKey: ''");
    route.fulfill({ response: r, body });
  });
  await ctx.addInitScript(() => { if (window.speechSynthesis) window.speechSynthesis.speak = () => {}; window.__tracks = []; });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) page.errors.push(m.text()); });
  return { ctx, page };
}
async function open(page, hash, store) {
  // Ghi tiến độ ở trang không chạy app (robots.txt) rồi mới mở web: app chỉ chạy 1 lần với đúng tiến độ.
  await page.goto(BASE + 'robots.txt');
  await page.evaluate(([k, s]) => { localStorage.clear(); sessionStorage.clear(); if (s) localStorage.setItem(k, JSON.stringify(s)); }, [KEY, store || null]);
  await page.goto(BASE + 'index.html' + hash);
  await page.waitForTimeout(250);
}
const getStore = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), KEY);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }); }

// Đáp án đúng cho câu trong bài (dữ liệu bài) và câu ôn (dữ liệu srs trong localStorage).
function lessonAnswer(d, info) {
  const norm = (s) => String(s || '').replace(/__/g, '').replace(/\s+/g, ' ').trim();
  const opts = info.options.map(norm);
  const want = new Set();
  const q = norm(info.q);
  (d.grammar || []).forEach((g) => g.questions.forEach((x) => { if (norm(x.q) === q) want.add(norm(x.options[0])); }));
  (d.usage || []).forEach((x) => { if (norm(x.q) === q) want.add(norm(x.options[0])); });
  (d.listening || []).forEach((x) => { if (norm(x.listen) === norm(info.listen)) want.add(norm(x.options[0])); });
  if (d.reading) d.reading.questions.forEach((x) => { if (norm(x.q) === q) want.add(norm(x.options[0])); });
  (d.topik || []).forEach((x) => { if (norm(x.q) === q && (!x.passage || norm(info.passage) === norm(x.passage) || x.lines)) want.add(norm(x.options[0])); });
  let m = q.match(/^Nghĩa của (.+) là gì\?$/);
  d.vocab.forEach((g) => g.words.forEach((w) => {
    if (m && norm(w[0]) === norm(m[1])) want.add(norm(w[1]));
    const m2 = q.match(/^“(.+)” trong tiếng Hàn là gì\?$/);
    if (m2 && norm(w[1]) === norm(m2[1])) want.add(norm(w[0]));
  }));
  return opts.findIndex((o) => want.has(o));
}
async function qinfo(page) {
  return page.evaluate(() => ({
    q: (document.querySelector('.qtext > span') || {}).innerText || '',
    listen: (document.querySelector('.listen-box .play') || { getAttribute: () => '' }).getAttribute('data-say') || '',
    passage: (document.querySelector('.passage') || {}).innerText || '',
    retry: /Làm lại/.test((document.querySelector('.retry-tag') || {}).innerText || ''),
    options: [...document.querySelectorAll('.opt')].map((b) => b.querySelector('span:last-child').innerText),
  }));
}
// Làm hết lượt câu hỏi; answerFn(info) trả về chỉ số đúng; wrongFirst: các câu (thứ tự lần đầu) cố ý trả lời sai.
async function play(page, answerFn, wrongFirst) {
  wrongFirst = wrongFirst || [];
  let first = 0, steps = 0;
  const seen = [];
  while (steps++ < 200) {
    await page.waitForSelector('.opt, .result-grid', { timeout: 5000 });
    if (await page.$('.result-grid')) break;
    const info = await qinfo(page);
    let i = await answerFn(info);
    assert.ok(i >= 0, 'không tìm được đáp án: ' + info.q);
    if (!info.retry) { seen.push(info); if (wrongFirst.includes(first)) i = (i + 1) % info.options.length; first++; }
    await page.click(`.opt[data-o="${i}"]`);
    await page.click('#next');
  }
  await page.waitForSelector('.result-grid');
  return { first, seen };
}
async function srsAnswer(page, info) {
  const s = await getStore(page);
  const es = Object.values(s.srs || {});
  let m = info.q.match(/^Nghĩa của (.+) là gì\?$/);
  if (m) { const e = es.find((x) => x.w === m[1].trim()); return info.options.indexOf(e.v); }
  m = info.q.match(/^“(.+)” trong tiếng Hàn là gì\?$/);
  const e = es.find((x) => x.v === m[1].trim());
  return info.options.indexOf(e.w);
}
// Tiến độ có sẵn: n từ đến hạn hôm nay (bài sc2-01, sc2-02).
function dueStore(n, extra) {
  const srs = {};
  const words = [];
  ['sc2-01', 'sc2-02', 'sc2-03'].forEach((id) => LES(id).vocab.forEach((g) => g.words.forEach((w) => { if (!words.some((x) => x[1] === w[0])) words.push([id, w[0], w[1]]); })));
  const seenV = new Set();
  words.filter((w) => !seenV.has(w[2]) && seenV.add(w[2])).forEach((w, i) => {
    srs['t' + i] = { l: w[0], w: w[1], v: w[2], b: i < n ? 2 : 3, d: i < n ? ymd(-1) : ymd(5), ts: 1000 + i };
  });
  return Object.assign({ xp: 100, days: [ymd(-1)], lessons: { 'sc2-01': { best: 80, stars: 2, last: ymd(-1) }, 'sc2-02': { best: 90, stars: 3, last: ymd(-1) }, 'sc2-03': { best: 75, stars: 2, last: ymd(-1) } }, srs }, extra || {});
}

(async () => {
  const browser = await chromium.launch();
  const { page } = await device(browser);

  // ================= Ôn hôm nay =================
  await tc('C01', 'Người mới: trang Ôn hôm nay báo "Chưa có từ để ôn", trang chủ không có thẻ Ôn hôm nay/Huy hiệu', async () => {
    await open(page, '#/');
    assert.ok(!(await page.$('#srsCard')), 'không có thẻ ôn');
    assert.ok(!(await page.$('#badgeCard')), 'không có thẻ huy hiệu');
    await open(page, '#/on-tap');
    await page.waitForSelector('#srsEmpty');
    assert.strictEqual(await page.textContent('#srsDue'), '0');
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('C02', 'Làm Luyện nhanh SC2 Bài 1 (sai 1 câu từ vựng): từ được hỏi vào hàng ôn theo kết quả (đúng → hộp 1, sai → hộp 0, hẹn ngày mai), từ chưa hỏi vào hàng ôn chia ≤20 từ/ngày từ ngày mai, ts=0; Sổ câu sai vẫn ghi câu sai', async () => {
    const d = LES('sc2-01');
    await open(page, '#/bai/sc2-01/lam-bai');
    await page.click('.mode[data-mode="quick"]');
    const r = await play(page, (info) => lessonAnswer(d, info), [0]);
    const s = await getStore(page);
    const es = Object.values(s.srs);
    const words = WORDS(d);
    assert.strictEqual(es.length, words.length, 'đủ từ của bài: ' + es.length + '/' + words.length);
    const asked = r.seen.filter((x) => /^Nghĩa của|trong tiếng Hàn là gì/.test(x.q));
    assert.ok(asked.length >= 5, 'có câu từ vựng');
    const answered = es.filter((e) => e.ts > 0);
    assert.strictEqual(answered.length, asked.length, 'từ đã hỏi có ts');
    assert.strictEqual(answered.filter((e) => e.b === 0).length, 1, '1 từ sai ở hộp 0');
    assert.ok(answered.every((e) => e.d === ymd(1)), 'từ đã hỏi hẹn ngày mai');
    assert.ok(answered.filter((e) => e.b === 1).length === asked.length - 1);
    const rest = es.filter((e) => !e.ts);
    assert.ok(rest.every((e) => e.b === 0 && e.d >= ymd(1)), 'từ chưa hỏi từ ngày mai');
    const per = {};
    es.forEach((e) => { per[e.d] = (per[e.d] || 0) + 1; });
    assert.ok(Object.values(per).every((n) => n <= 20), 'mỗi ngày ≤20 từ: ' + JSON.stringify(per));
    assert.strictEqual(Object.keys(s.wrong).length, 1, 'Sổ câu sai có 1 câu');
    await page.goto(BASE + 'index.html#/');
    await page.waitForSelector('#srsCard');
    assert.match(await page.textContent('#srsCard'), /Lượt sau: ngày mai/);
  });

  await tc('C03', 'Bài bảng chữ Hangeul (hỏi cách đọc chữ cái) không đưa vào hàng ôn từ', async () => {
    const d = LES('sc1-00');
    await open(page, '#/bai/sc1-00/lam-bai');
    await page.click('.mode[data-mode="quick"]');
    await play(page, (info) => {
      const m = info.q.match(/^Chữ (.+) đọc gần với âm nào\?$/);
      if (m) { for (const g of d.vocab) for (const w of g.words) if (w[0] === m[1].trim()) return info.options.indexOf(w[1]); }
      return lessonAnswer(d, info);
    });
    const s = await getStore(page);
    assert.strictEqual(Object.keys(s.srs || {}).length, 0);
  });

  await tc('C04', '8 từ đến hạn: trang chủ "8 từ đến hạn ôn"; vào ôn đủ 8 câu, 4 đáp án khác nhau có đáp án đúng; sai 1 câu → hỏi lại cuối lượt; kết quả: đúng lên hộp (hộp 2 → 3, hẹn 7 ngày), sai về hộp 0 hẹn mai; +5 XP/câu đúng; Sổ câu sai không đổi; srsLog hôm nay = 8', async () => {
    await open(page, '#/', dueStore(8));
    await page.waitForSelector('#srsCard');
    assert.match(await page.textContent('#srsCard'), /8 từ đến hạn ôn/);
    await page.click('#srsCard');
    await page.waitForSelector('#startSrs');
    assert.strictEqual(await page.textContent('#srsDue'), '8');
    await page.click('#startSrs');
    const r = await play(page, async (info) => {
      assert.strictEqual(info.options.length, 4, '4 đáp án');
      assert.strictEqual(new Set(info.options).size, 4, 'đáp án không trùng');
      return srsAnswer(page, info);
    }, [2]);
    assert.strictEqual(r.first, 8);
    assert.match(await page.textContent('h2'), /Ôn xong hôm nay/);
    assert.strictEqual(await page.textContent('.rbox.xp b'), '+35');
    const s = await getStore(page);
    const es = Object.values(s.srs);
    const touched = es.filter((e) => e.ts > 5000);
    assert.strictEqual(touched.length, 8);
    assert.strictEqual(touched.filter((e) => e.b === 0 && e.d === ymd(1)).length, 1, '1 từ sai về hộp 0');
    assert.strictEqual(touched.filter((e) => e.b === 3 && e.d === ymd(7)).length, 7, '7 từ lên hộp 3, hẹn 7 ngày');
    assert.strictEqual(s.xp, 135);
    assert.deepStrictEqual(s.wrong || {}, {});
    assert.strictEqual(s.srsLog[ymd(0)], 8);
    assert.ok(s.days.includes(ymd(0)), 'tính ngày học');
    assert.match(await page.textContent('#srsLeft'), /Đã ôn hết/);
    await page.goto(BASE + 'index.html#/');
    await page.waitForSelector('#srsCard');
    assert.match(await page.textContent('#srsCard'), /Đã ôn xong hôm nay/);
    await page.goto(BASE + 'index.html#/on-tap');
    await page.waitForSelector('#srsDone');
    assert.match(await page.textContent('#srsDone'), /Đã ôn xong hôm nay/);
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('C05', '27 từ đến hạn: mỗi lượt tối đa 20 từ; xong lượt báo còn 7 từ và có nút Ôn tiếp; lượt 2 ôn 7 từ còn lại', async () => {
    await open(page, '#/on-tap', dueStore(27));
    await page.waitForSelector('#startSrs');
    assert.match(await page.textContent('.panel h2'), /Lượt này 20 từ/);
    await page.click('#startSrs');
    const r = await play(page, (info) => srsAnswer(page, info));
    assert.strictEqual(r.first, 20);
    assert.match(await page.textContent('#srsLeft'), /Còn 7 từ/);
    await page.click('a[href="#/on-tap"].btn');
    await page.waitForSelector('#startSrs');
    await page.click('#startSrs');
    const r2 = await play(page, (info) => srsAnswer(page, info));
    assert.strictEqual(r2.first, 7);
    const s = await getStore(page);
    assert.strictEqual(s.srsLog[ymd(0)], 27);
  });

  await tc('C06', 'Người học cũ (đã làm bài trước khi có tính năng, chưa có hàng ôn): mở Ôn hôm nay → từ các bài đã làm vào hàng ôn, ≤20 từ/ngày, ts=0; bỏ qua bài Hangeul', async () => {
    await open(page, '#/on-tap', { xp: 300, days: [ymd(-2)], lessons: { 'sc1-00': { best: 90, stars: 3 }, 'sc1-01': { best: 80, stars: 2 }, 'sc1-02': { best: 70, stars: 2 } } });
    await page.waitForSelector('#srsDone');
    const s = await getStore(page);
    const es = Object.values(s.srs);
    const n = WORDS(LES('sc1-01')).length + WORDS(LES('sc1-02')).length;
    assert.strictEqual(es.length, n);
    assert.ok(es.every((e) => e.ts === 0 && e.b === 0 && e.l !== 'sc1-00'));
    const per = {};
    es.forEach((e) => { per[e.d] = (per[e.d] || 0) + 1; });
    assert.ok(Object.values(per).every((x) => x <= 20) && Object.keys(per).sort()[0] === ymd(1), JSON.stringify(per));
    assert.match(await page.textContent('#srsDone'), /ngày mai/);
  });

  await tc('C07', 'Lượt ôn: câu ôn hiện tên bài; nút ✕ thoát về trang Ôn hôm nay (và sửa kèm: ✕ trong lượt ôn Sổ câu sai cũng thoát được)', async () => {
    await open(page, '#/on-tap', dueStore(3));
    await page.click('#startSrs');
    await page.waitForSelector('.opt');
    assert.match(await page.textContent('.retry-tag'), /Sơ cấp 2 · Bài/);
    assert.strictEqual(await page.getAttribute('.qclose', 'href'), '#/on-tap');
    await page.click('.qclose');
    await page.waitForSelector('#startSrs');
    assert.ok(!(await page.$('.opt')), 'đã thoát lượt ôn');
    // Sửa kèm: ✕ trong lượt ôn Sổ câu sai trước đây không thoát được (cùng hash)
    await open(page, '#/so-cau-sai', { xp: 0, days: [], wrong: { a: { item: { lid: 'sc1-01', kind: 'grammar', q: 'Câu thử?', options: ['A', 'B'], answer: 'A' }, n: 1, ok: 0, t: ymd(0), ts: 1 } } });
    await page.click('#startReview'); await page.waitForSelector('.opt');
    await page.click('.qclose');
    await page.waitForSelector('#startReview');
  });

  // ================= Huy hiệu =================
  await tc('B01', 'Tiến độ có chuỗi 7 ngày, 1.200 XP, 3 bài: mở web báo huy hiệu mới; trang Huy hiệu ghi đạt 5/18 (Khởi động, Một tuần bền bỉ, Bài đầu tiên, 1.000 XP, Thử sức TOPIK), có ngày đạt; huy hiệu chưa đạt có thanh tiến độ đúng số', async () => {
    const days = []; for (let i = -7; i <= -1; i++) days.push(ymd(i));
    await open(page, '#/', { xp: 1200, days, lessons: { 'sc1-01': { best: 80, stars: 3 }, 'sc1-02': { best: 75, stars: 2 }, 'sc1-03': { best: 60, stars: 1 } }, exams: { 'doc-01': { best: 30, last: 30, n: 1, at: 1 } } });
    await page.waitForSelector('#toast:not([hidden])');
    assert.match(await page.textContent('#toast'), /5 huy hiệu mới/);
    const s = await getStore(page);
    assert.deepStrictEqual(Object.keys(s.badges).sort(), ['exam-1', 'lessons-1', 'streak-3', 'streak-7', 'xp-1000']);
    await page.waitForSelector('#badgeCard');
    assert.match(await page.textContent('#badgeCard'), /5\/18/);
    await page.click('#badgeCard');
    await page.waitForSelector('#badgeGrid');
    assert.match(await page.textContent('#badgeCount'), /5\/18/);
    assert.strictEqual(await page.$$eval('.badge.got', (x) => x.length), 5);
    assert.match(await page.textContent('[data-badge="streak-7"]'), /Đạt ngày/);
    assert.match(await page.textContent('[data-badge="lessons-10"]'), /2\/10/);
    assert.match(await page.textContent('[data-badge="streak-30"]'), /7\/30/);
    assert.match(await page.textContent('[data-badge="xp-5000"]'), /1200\/5000/);
    // F5 không báo lại
    await page.reload(); await page.waitForTimeout(400);
    assert.ok(await page.$eval('#toast', (t) => t.hidden), 'không báo lại');
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('B02', 'Chuỗi ngày đứt (học cách đây 20 ngày) thì huy hiệu chuỗi đã đạt vẫn giữ, chuỗi hiện tại 🔥 0', async () => {
    const days = []; for (let i = -27; i <= -20; i++) days.push(ymd(i));
    await open(page, '#/huy-hieu', { xp: 10, days, badges: { 'streak-7': Date.now() - 20 * 864e5 } });
    await page.waitForSelector('#badgeGrid');
    assert.ok(await page.$('[data-badge="streak-7"].got'));
    assert.ok(await page.$('[data-badge="streak-3"].got'), 'chuỗi dài nhất 8 ngày vẫn tính');
    assert.match(await page.textContent('.stat.fire'), /0/);
  });

  await tc('B03', 'Người mới làm xong bài đầu (≥70%): màn kết quả hiện "Bạn vừa mở khóa huy hiệu: Bài đầu tiên" kèm nút Chia sẻ; không bật thêm thông báo trùng', async () => {
    const d = LES('sc1-01');
    await open(page, '#/bai/sc1-01/lam-bai');
    await page.click('.mode[data-mode="quick"]');
    await play(page, (info) => lessonAnswer(d, info));
    await page.waitForSelector('#badgeNew');
    assert.match(await page.textContent('#badgeNew'), /Bài đầu tiên/);
    assert.ok(await page.$('#badgeNew [data-share-badge="lessons-1"]'));
    assert.ok(await page.$eval('#toast', (t) => t.hidden || !/Huy hiệu/.test(t.textContent)), 'không báo trùng');
    // Nút "Bài tiếp theo" vẫn là nút chính đầu tiên (giữ hành vi cũ)
    assert.strictEqual(await page.getAttribute('.actions a.btn:not(.ghost)', 'href'), '#/bai/sc1-02');
    await page.click('#badgeNew [data-share-badge="lessons-1"]');
    await page.waitForSelector('#shareImg');
    await page.keyboard.press('Escape');
    assert.ok(!(await page.$('#shareModal')));
  });

  // ================= Thẻ ảnh chia sẻ =================
  await tc('S01', 'Kết quả bài học → "Khoe kết quả": hộp thoại có ảnh 1080×1080 (vẽ trên máy, không gọi mạng), nút Tải ảnh là tệp PNG, link Facebook trỏ trang giới thiệu; Esc/✕/bấm nền đóng và trả focus về nút', async () => {
    const d = LES('sc2-02');
    await open(page, '#/bai/sc2-02/lam-bai');
    await page.click('.mode[data-mode="quick"]');
    await play(page, (info) => lessonAnswer(d, info));
    const reqs = [];
    page.on('request', (r) => { if (!/^(data|blob):|127\.0\.0\.1|localhost/.test(r.url())) reqs.push(r.url()); });
    await page.click('#shareResult');
    await page.waitForSelector('#shareImg');
    const img = await page.$eval('#shareImg', (i) => ({ w: i.naturalWidth, h: i.naturalHeight, alt: i.alt }));
    assert.strictEqual(img.w, 1080); assert.strictEqual(img.h, 1080);
    assert.match(img.alt, /Hoàn thành bài học · Sơ cấp 2 · Bài 2/);
    await page.waitForFunction(() => /^blob:/.test(document.getElementById('shareDl').href));
    assert.strictEqual(await page.getAttribute('#shareDl', 'download'), 'hanadul-bai-hoc.png');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#shareDl')]);
    assert.strictEqual(dl.suggestedFilename(), 'hanadul-bai-hoc.png');
    const buf = fs.readFileSync(await dl.path());
    assert.strictEqual(buf.slice(1, 4).toString(), 'PNG');
    assert.match(await page.getAttribute('#shareFb', 'href'), /facebook\.com\/sharer\/sharer\.php\?u=.*gioi-thieu\.html/);
    assert.ok(await page.$eval('#shareNative', (b) => b.hidden), 'máy tính không có Web Share tệp → ẩn nút Chia sẻ');
    await shot(page, 'chia-se-bai-hoc.png');
    await page.keyboard.press('Escape');
    assert.ok(!(await page.$('#shareModal')));
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'shareResult');
    await page.click('#shareResult'); await page.waitForSelector('#shareClose');
    await page.click('#shareClose'); assert.ok(!(await page.$('#shareModal')));
    await page.click('#shareResult'); await page.waitForSelector('#shareModal');
    await page.mouse.click(5, 5); assert.ok(!(await page.$('#shareModal')));
    assert.deepStrictEqual(reqs.filter((u) => !/facebook/.test(u)), []);
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('S02', 'Kết quả Ôn hôm nay có "Khoe kết quả", ảnh ghi "Ôn xong N từ"', async () => {
    await open(page, '#/on-tap', dueStore(4));
    await page.click('#startSrs');
    await play(page, (info) => srsAnswer(page, info));
    await page.click('#shareResult');
    await page.waitForSelector('#shareImg');
    assert.match(await page.getAttribute('#shareImg', 'alt'), /Ôn xong 4 từ · 100%/);
    assert.strictEqual(await page.getAttribute('#shareDl', 'download'), 'hanadul-on-tap.png');
  });

  await tc('S03', 'Kết quả đề thi thử Đọc và Viết có "Khoe kết quả" (ảnh ghi số câu đúng / điểm tự chấm); Sổ câu sai ôn xong KHÔNG có nút khoe', async () => {
    const doc = EXAMS.exams.find((e) => e.part !== 'viet').id;
    const ex = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/exams', doc + '.json'), 'utf8'));
    const n = ex.sets.reduce((a, st) => a + st.questions.length, 0);
    await open(page, '#/thi-thu/' + doc + '/ket-qua', { xp: 10, days: [ymd(0)], exams: { [doc]: { best: 30, last: 30, n: 1, at: Date.now(), ans: '0'.repeat(n), secs: 3000 } } });
    await page.waitForSelector('#shareResult');
    await page.click('#shareResult');
    await page.waitForSelector('#shareImg');
    assert.match(await page.getAttribute('#shareImg', 'alt'), /Đọc · .* · \d+\/50 câu đúng/);
    await page.keyboard.press('Escape');
    const viet = EXAMS.exams.find((e) => e.part === 'viet');
    if (viet) {
      await open(page, '#/thi-thu/' + viet.id + '/ket-qua', { xp: 10, days: [ymd(0)], exams: { [viet.id]: { best: 0, last: 0, n: 1, at: Date.now(), texts: { '53': '테스트' }, self: {}, secs: 600 } } });
      await page.waitForSelector('#shareResult');
      await page.click('#shareResult');
      await page.waitForSelector('#shareImg');
      assert.match(await page.getAttribute('#shareImg', 'alt'), /Viết · .*điểm/);
    }
    // Sổ câu sai
    await open(page, '#/so-cau-sai', { xp: 0, days: [], wrong: { a: { item: { lid: 'sc1-01', kind: 'grammar', q: 'Câu thử?', options: ['A', 'B'], answer: 'A' }, n: 1, ok: 0, t: ymd(0), ts: 1 } } });
    await page.click('#startReview');
    await play(page, (info) => info.options.indexOf('A'));
    assert.ok(!(await page.$('#shareResult')));
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('S04', 'Trang Huy hiệu: huy hiệu đã đạt có nút Chia sẻ → ảnh "Huy hiệu mới · <tên>"; chưa đạt không có nút', async () => {
    await open(page, '#/huy-hieu', { xp: 1500, days: [ymd(0)], badges: { 'xp-1000': Date.now() } });
    await page.waitForSelector('#badgeGrid');
    assert.ok(!(await page.$('[data-badge="xp-5000"] [data-share-badge]')));
    await page.click('[data-badge="xp-1000"] [data-share-badge]');
    await page.waitForSelector('#shareImg');
    assert.match(await page.getAttribute('#shareImg', 'alt'), /Huy hiệu mới · 1\.000 XP/);
    await shot(page, 'chia-se-huy-hieu.png');
  });

  await tc('S05', 'Điện thoại có Web Share kèm tệp: hiện nút "📤 Chia sẻ", bấm gọi navigator.share với 1 ảnh PNG', async () => {
    const { ctx: c2, page: p2 } = await device(browser);
    await c2.addInitScript(() => {
      window.__shared = null;
      navigator.canShare = (d) => !!(d && d.files && d.files.length);
      navigator.share = (d) => { window.__shared = { n: d.files.length, type: d.files[0].type, name: d.files[0].name, text: d.text }; return Promise.resolve(); };
    });
    await open(p2, '#/huy-hieu', { xp: 1500, days: [ymd(0)], badges: { 'xp-1000': Date.now() } });
    await p2.click('[data-badge="xp-1000"] [data-share-badge]');
    await p2.waitForSelector('#shareNative:not([hidden])');
    await p2.click('#shareNative');
    await p2.waitForFunction(() => window.__shared);
    const sh = await p2.evaluate(() => window.__shared);
    assert.deepStrictEqual([sh.n, sh.type, sh.name], [1, 'image/png', 'hanadul-huy-hieu.png']);
    assert.match(sh.text, /học tiếng Hàn miễn phí/);
    await c2.close();
  });

  await tc('S06', 'Trang xác minh chứng nhận: chứng nhận hợp lệ có nút "📸 Ảnh chia sẻ" → ảnh ghi tên, cấp độ, mã, link Facebook trỏ đúng trang chứng nhận', async () => {
    const { ctx: c3, page: p3 } = await device(browser);
    await c3.unroute('**/assets/config.js');
    await c3.route('**/assets/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: "window.HANADUL_CONFIG={supabaseUrl:'https://x.supabase.co',supabaseKey:'sb_publishable_x'};" }));
    await c3.unroute(/supabase\.co\//);
    await c3.route(/supabase\.co\/rest\/v1\/rpc\/verify_certificate/, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify([{ code: 'HD-AB12-CD34', kind: 'level-sc1', title: 'Hoàn thành Sơ cấp 1', display_name: 'Lan', detail: { lessons: 16, avg: 88 }, issued_at: '2026-11-20T10:00:00Z' }]) }));
    await p3.goto(BASE + 'chung-nhan.html?ma=HD-AB12-CD34');
    await p3.waitForSelector('#shareBtn');
    await p3.click('#shareBtn');
    await p3.waitForSelector('#shareImg');
    assert.match(await p3.getAttribute('#shareImg', 'alt'), /Chứng nhận hoàn thành · Lan · HD-AB12-CD34/);
    assert.match(decodeURIComponent(await p3.getAttribute('#shareFb', 'href')), /chung-nhan\.html\?ma=HD-AB12-CD34/);
    await shot(p3, 'chia-se-chung-nhan.png');
    assert.deepStrictEqual(p3.errors, []);
    await c3.close();
  });

  // ================= Điện thoại, giao diện tối =================
  await tc('R01', 'Điện thoại 375px: trang chủ có thẻ Ôn hôm nay + Huy hiệu, trang Ôn hôm nay, lượt ôn, trang Huy hiệu và hộp thoại chia sẻ không tràn ngang; hộp thoại nằm trọn màn hình', async () => {
    const { ctx: c4, page: p4 } = await device(browser, { ctx: { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true } });
    const st = dueStore(5, { badges: { 'xp-1000': Date.now() } });
    await open(p4, '#/', st);
    await p4.waitForSelector('#srsCard'); await p4.waitForSelector('#badgeCard');
    assert.ok(await noHScroll(p4), 'trang chủ');
    await shot(p4, 'trang-chu-on-tap-dien-thoai.png');
    await p4.goto(BASE + 'index.html#/on-tap'); await p4.waitForSelector('#startSrs');
    assert.ok(await noHScroll(p4), 'ôn hôm nay');
    await shot(p4, 'on-tap-dien-thoai.png');
    await p4.click('#startSrs'); await p4.waitForSelector('.opt');
    assert.ok(await noHScroll(p4), 'lượt ôn');
    await p4.goto(BASE + 'index.html#/huy-hieu'); await p4.waitForSelector('#badgeGrid');
    assert.ok(await noHScroll(p4), 'huy hiệu');
    await shot(p4, 'huy-hieu-dien-thoai.png');
    await p4.click('[data-badge="xp-1000"] [data-share-badge]'); await p4.waitForSelector('#shareImg');
    assert.ok(await noHScroll(p4), 'hộp thoại');
    const box = await p4.$eval('.share-box', (b) => { const r = b.getBoundingClientRect(); return [r.left, r.right, r.width]; });
    assert.ok(box[0] >= 0 && box[1] <= 375, JSON.stringify(box));
    await shot(p4, 'chia-se-dien-thoai.png');
    assert.deepStrictEqual(p4.errors, []);
    await c4.close();
  });

  await tc('R02', 'Giao diện tối: trang Huy hiệu, Ôn hôm nay và hộp thoại chia sẻ dùng nền tối, chữ sáng', async () => {
    const { ctx: c5, page: p5 } = await device(browser, { dark: true });
    await open(p5, '#/huy-hieu', { xp: 1500, days: [ymd(0)], badges: { 'xp-1000': Date.now() } });
    await p5.waitForSelector('#badgeGrid');
    const lum = (c) => { const m = c.match(/\d+/g).map(Number); return (m[0] * 299 + m[1] * 587 + m[2] * 114) / 1000; };
    const bg = await p5.$eval('.badge', (b) => getComputedStyle(b).backgroundColor);
    const fg = await p5.$eval('.badge b', (b) => getComputedStyle(b).color);
    assert.ok(lum(bg) < 80 && lum(fg) > 180, bg + ' / ' + fg);
    await p5.click('[data-badge="xp-1000"] [data-share-badge]'); await p5.waitForSelector('#shareImg');
    assert.ok(lum(await p5.$eval('.share-box', (b) => getComputedStyle(b).backgroundColor)) < 80);
    await p5.keyboard.press('Escape');
    await p5.goto(BASE + 'index.html#/on-tap'); await p5.waitForSelector('.srs-stats');
    assert.ok(lum(await p5.$eval('.srs-stats > div', (b) => getComputedStyle(b).backgroundColor)) < 80);
    await c5.close();
  });

  await browser.close();
  console.log('\n' + results.filter((r) => r[2] === 'PASS').length + '/' + results.length + ' PASS');
  if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
})();
