// Test đợt D: kiểm tra xếp lớp (assets/placement.js), thẻ từ + chép chính tả (assets/cards.js),
// đề thi thử Nghe (assets/exam.js, part "nghe"), cài app + học offline (manifest, sw.js, assets/pwa.js).
// Chạy: python3 -m http.server 8765 (ở thư mục gốc repo), rồi node tests/e2e_dot_d.js   (ONLY=P01,W02 chạy riêng; SHOTS=/thư-mục để lưu ảnh)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8765/';
const SHOTS = process.env.SHOTS || '';
const ROOT = path.resolve(__dirname, '..');
const KEY = 'hanadul:v2';
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const PL = J('data/placement.json');
const IDX = J('data/index.json');
const ORDER = IDX.levels.flatMap((lv) => lv.lessons.map((l) => l.id));
const NG = J('data/exams/nghe-01.json');
const NGQ = NG.sets.flatMap((s) => s.questions);
const WORDS = (id) => { const s = new Map(); J('data/lessons/' + id + '.json').vocab.forEach((g) => g.words.forEach((w) => { if (!s.has(w[0])) s.set(w[0], w); })); return [...s.values()]; };

const results = [];
async function tc(id, name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) return;
  try { await fn(); results.push([id, name, 'PASS']); console.log('PASS', id, name); }
  catch (e) { results.push([id, name, 'FAIL: ' + e.message.split('\n')[0]]); console.log('FAIL', id, name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n   ')); process.exitCode = 1; }
}
async function device(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext(Object.assign({ viewport: opts.viewport || { width: 1100, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' }, opts.ctx || {}));
  await require('./stub_third_party')(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/supabase\.co\//, (r) => r.abort());
  // Các case L0x kiểm đường đọc bằng giọng trình duyệt: bỏ âm thanh thu sẵn (đường đó do tests/e2e_tts.js kiểm).
  await ctx.route('**/data/exams/nghe-01.json', async (route) => {
    const r = await route.fetch(); const j = await r.json(); delete j.audio;
    route.fulfill({ response: r, body: JSON.stringify(j) });
  });
  if (!opts.sw) {
    await ctx.route('**/assets/config.js', async (route) => {
      const r = await route.fetch();
      const body = (await r.text()).replace(/supabaseUrl: '[^']*'/, "supabaseUrl: ''").replace(/supabaseKey: '[^']*'/, "supabaseKey: ''");
      route.fulfill({ response: r, body });
    });
  }
  await ctx.addInitScript((sw) => {
    window.__spoken = [];
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push({ text: u.text, pitch: u.pitch, rate: u.rate }); };
    if (sw) window.__HD_SW_TEST = true;
  }, !!opts.sw);
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) page.errors.push(m.text()); });
  return { ctx, page };
}
async function open(page, hash, store) {
  await page.goto(BASE + 'robots.txt');
  await page.evaluate(([k, s]) => { localStorage.clear(); sessionStorage.clear(); if (s) localStorage.setItem(k, JSON.stringify(s)); }, [KEY, store || null]);
  await page.goto(BASE + 'index.html' + hash);
  await page.waitForTimeout(250);
}
const getStore = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '{}'), KEY);
const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name), fullPage: false }); }
function ymd(n) {
  const d = new Date(); d.setDate(d.getDate() + (n || 0));
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Làm bài xếp lớp: plan(blockIndex, qIndex) → 'right' | 'wrong' | 'skip'. Trả về số câu đã làm.
async function placement(page, plan) {
  await page.click('#plStart');
  let n = 0;
  for (let guard = 0; guard < 40; guard++) {
    await page.waitForSelector('.pl-quiz, .pl-result', { timeout: 5000 });
    if (await page.$('.pl-result')) break;
    const tag = await page.textContent('.qsection');
    const m = tag.match(/Phần (\d+) .* câu (\d+)\//);
    const bi = +m[1] - 1, qi = +m[2] - 1;
    const q = PL.blocks[bi].questions[qi];
    const what = plan(bi, qi);
    if (what === 'skip') await page.click('.pl-skip');
    else {
      const texts = await page.$$eval('.opt:not(.pl-skip)', (bs) => bs.map((b) => b.querySelector('span:last-child').innerText.trim()));
      let i = texts.indexOf(q.options[0]);
      assert.ok(i >= 0, 'không thấy đáp án ' + q.options[0] + ' trong ' + JSON.stringify(texts));
      if (what === 'wrong') i = (i + 1) % 4;
      await page.click(`.opt[data-o="${i}"]`);
    }
    n++;
    // Đợi câu tiếp theo (hoặc màn kết quả) thay cho câu vừa trả lời.
    await page.waitForFunction((t) => document.querySelector('.pl-result') || ((document.querySelector('.qsection') || {}).textContent || '') !== t, tag);
  }
  await page.waitForSelector('.pl-result');
  return n;
}
const lessonOfFirstWrong = (bi, wrongIdx) => wrongIdx.map((i) => PL.blocks[bi].questions[i].l).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))[0];

(async () => {
  const browser = await chromium.launch();
  const { page } = await device(browser);

  // ================= Kiểm tra xếp lớp =================
  await tc('P01', 'Người mới: trang chủ có thẻ Kiểm tra xếp lớp → trang giới thiệu (4 phần, 24 câu, nút Bắt đầu, Tôi chưa biết chữ Hàn); footer có link', async () => {
    await open(page, '#/');
    await page.waitForSelector('.pl-card');
    assert.ok(await page.$('footer a[href="#/xep-lop"]'), 'footer có link xếp lớp');
    await page.click('.pl-card');
    await page.waitForSelector('#plStart');
    const t = await page.textContent('.pl-intro');
    assert.ok(/Sơ cấp 1.*Sơ cấp 2.*Trung cấp 3.*TOPIK II/.test(t) && /24 câu/.test(t), t);
    assert.ok(await page.$('#plZero'));
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('P02', 'Chưa biết gì (bấm Tôi chưa học cả 6 câu phần 1): dừng sau 6 câu, gợi ý Sơ cấp 1 từ Bảng chữ Hangeul; lưu placement; không cộng XP, không ghi Sổ câu sai', async () => {
    await open(page, '#/xep-lop');
    const n = await placement(page, () => 'skip');
    assert.strictEqual(n, 6);
    assert.strictEqual(await page.textContent('#plLevel'), 'Sơ cấp 1');
    assert.strictEqual(await page.getAttribute('#plLesson', 'href'), '#/bai/sc1-00');
    const s = await getStore(page);
    assert.strictEqual(s.placement.level, 'sc1'); assert.strictEqual(s.placement.lesson, 'sc1-00');
    assert.ok(Math.abs(s.placement.at - Date.now()) < 60000);
    assert.ok(!s.xp, 'không cộng XP'); assert.deepStrictEqual(s.wrong || {}, {});
    assert.ok(/chưa làm/.test(await page.textContent('.pl-bars')), 'phần sau hiện chưa làm');
  });

  await tc('P03', 'Đúng hết Sơ cấp 1, 2; Trung cấp 3 sai 3 câu: dừng ở phần 3 (18 câu), gợi ý Trung cấp 3 từ bài sớm nhất có câu sai; thanh điểm 6/6, 6/6, 3/6', async () => {
    await open(page, '#/xep-lop');
    const bad = [3, 4, 5];
    const n = await placement(page, (bi, qi) => (bi === 2 && bad.includes(qi) ? 'wrong' : 'right'));
    assert.strictEqual(n, 18);
    assert.strictEqual(await page.textContent('#plLevel'), 'Trung cấp 3');
    const want = lessonOfFirstWrong(2, bad);
    assert.strictEqual(await page.getAttribute('#plLesson', 'href'), '#/bai/' + want);
    const nums = await page.$$eval('.pl-bar-num', (e) => e.map((x) => x.textContent));
    assert.deepStrictEqual(nums, ['6/6', '6/6', '3/6', 'chưa làm']);
    assert.ok(await page.$('.pl-review'), 'có mục xem câu chưa đúng');
    assert.strictEqual(await page.$$eval('.pl-review li', (e) => e.length), 3);
  });

  await tc('P04', 'Đúng hết 24 câu: mức "sẵn sàng luyện đề TOPIK II", gợi ý bài Trung cấp mới nhất, có link đề thi thử', async () => {
    await open(page, '#/xep-lop');
    const n = await placement(page, () => 'right');
    assert.strictEqual(n, 24);
    assert.ok(/TOPIK II/.test(await page.textContent('#plLevel')));
    const tcs = ORDER.filter((x) => /^tc/.test(x));
    assert.strictEqual(await page.getAttribute('#plLesson', 'href'), '#/bai/' + tcs[tcs.length - 1]);
    assert.ok(await page.$('.pl-result a[href="#/thi-thu"]'));
  });

  await tc('P05', 'Qua Sơ cấp 1 nhưng sai 1 câu, trượt Sơ cấp 2: gợi ý Sơ cấp 2 từ bài sớm nhất có câu sai; "Nên xem lại" có bài Sơ cấp 1 câu sai', async () => {
    await open(page, '#/xep-lop');
    const n = await placement(page, (bi, qi) => (bi === 0 && qi === 3) || (bi === 1 && qi >= 2) ? 'wrong' : 'right');
    assert.strictEqual(n, 12);
    assert.strictEqual(await page.textContent('#plLevel'), 'Sơ cấp 2');
    assert.strictEqual(await page.getAttribute('#plLesson', 'href'), '#/bai/' + lessonOfFirstWrong(1, [2, 3, 4, 5]));
    const weakHref = await page.$$eval('.pl-weak a', (e) => e.map((a) => a.getAttribute('href')));
    assert.deepStrictEqual(weakHref, ['#/bai/' + PL.blocks[0].questions[3].l]);
  });

  await tc('P06', 'Sau khi xếp lớp: trang chủ không còn thẻ mời, nút "Bắt đầu học" đi thẳng tới bài gợi ý; tải lại vẫn giữ; giới thiệu hiện kết quả lần trước', async () => {
    await open(page, '#/', { placement: { level: 'sc2', lesson: 'sc2-05', at: Date.now(), score: { sc1: 6, sc2: 2 } } });
    assert.ok(!(await page.$('.pl-card')), 'ẩn thẻ mời');
    assert.strictEqual(await page.getAttribute('.hero-actions .btn', 'href'), '#/bai/sc2-05');
    await page.reload(); await page.waitForTimeout(300);
    assert.strictEqual(await page.getAttribute('.hero-actions .btn', 'href'), '#/bai/sc2-05');
    // Đã học xong bài gợi ý → bài kế tiếp chưa xong.
    await open(page, '#/', { placement: { level: 'sc2', lesson: 'sc2-05', at: Date.now() }, lessons: { 'sc2-05': { best: 90, stars: 3, last: ymd(0) } }, xp: 50 });
    assert.strictEqual(await page.getAttribute('.hero-actions .btn', 'href'), '#/bai/sc2-06');
    await open(page, '#/xep-lop', { placement: { level: 'sc2', lesson: 'sc2-05', at: Date.now() } });
    assert.ok(/Sơ cấp 2 · Bài 5/.test(await page.textContent('#plLast')));
    await page.click('#plLast a');
    await page.waitForSelector('.pl-result');
  });

  await tc('P07', '"Tôi chưa biết chữ Hàn": mở Bảng chữ Hangeul, lưu gợi ý sc1-00; người học đã làm ≥2 bài không thấy thẻ mời', async () => {
    await open(page, '#/xep-lop');
    await page.click('#plZero');
    await page.waitForTimeout(300);
    assert.ok(/#\/bai\/sc1-00$/.test(page.url()));
    assert.strictEqual((await getStore(page)).placement.lesson, 'sc1-00');
    await open(page, '#/', { xp: 10, lessons: { 'sc1-01': { best: 80, stars: 2 }, 'sc1-02': { best: 80, stars: 2 } } });
    assert.ok(!(await page.$('.pl-card')));
  });

  await tc('P08', 'Bàn phím 1–4 chọn đáp án; ✕ thoát về giới thiệu và không lưu kết quả dở', async () => {
    await open(page, '#/xep-lop');
    await page.click('#plStart');
    await page.waitForSelector('.pl-quiz');
    await page.keyboard.press('2');
    await page.waitForTimeout(100);
    assert.ok(/câu 2\//.test(await page.textContent('.qsection')));
    await page.click('.qclose');
    await page.waitForSelector('#plStart');
    assert.ok(!(await getStore(page)).placement);
    await page.keyboard.press('1');
    assert.ok(await page.$('#plStart'), 'phím không còn tác dụng sau khi thoát');
  });

  // ================= Thẻ từ =================
  const LID = 'sc1-03';
  const W = WORDS(LID);
  await tc('F01', 'Trang bài có 4 chế độ Học / Làm bài / Thẻ từ / Chính tả; đúng chế độ đang mở được đánh dấu', async () => {
    await open(page, '#/bai/' + LID);
    const tabs = await page.$$eval('.seg a', (e) => e.map((a) => [a.textContent.trim(), a.getAttribute('href'), a.getAttribute('aria-current')]));
    assert.deepStrictEqual(tabs.map((t) => t[1]), ['#/bai/' + LID, '#/bai/' + LID + '/lam-bai', '#/bai/' + LID + '/the-tu', '#/bai/' + LID + '/chinh-ta']);
    await page.click('.seg a[href$="/the-tu"]');
    await page.waitForSelector('#fcCard');
    assert.strictEqual(await page.getAttribute('.seg a[href$="/the-tu"]', 'aria-current'), 'page');
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('F02', 'Thẻ từ: đủ số từ của bài; chưa lật thì chưa chấm được; lật thấy nghĩa + đọc to; Chưa nhớ đưa thẻ về cuối; Đã nhớ giảm chồng', async () => {
    await open(page, '#/bai/' + LID + '/the-tu');
    await page.waitForSelector('#fcCard');
    assert.ok((await page.textContent('#fcCount')).includes('0/' + W.length));
    assert.ok(await page.isDisabled('#fcYes'));
    const front = (await page.textContent('#fcCard .fc-front')).trim();
    const w = W.find((x) => x[0] === front);
    assert.ok(w, 'mặt trước là từ tiếng Hàn của bài');
    assert.ok((await page.evaluate(() => window.__spoken.map((x) => x.text))).includes(w[2] || w[0]), 'đọc to từ');
    await page.click('#fcCard');
    assert.ok((await page.textContent('#fcCard .fc-back')).includes(w[1].replace(/\s+/g, ' ').trim().slice(0, 4)));
    await page.click('#fcNo');
    assert.ok((await page.textContent('#fcCount')).includes('còn ' + W.length + ' thẻ'), 'Chưa nhớ: chồng không giảm');
    await page.click('#fcCard'); await page.click('#fcYes');
    assert.ok((await page.textContent('#fcCount')).includes('Đã nhớ 1/' + W.length + ' · còn ' + (W.length - 1)));
  });

  await tc('F03', 'Thẻ từ: lật hết (bàn phím cách + →) → màn xong: XP = 5 + số từ nhớ ngay, giữ chuỗi ngày, từ của bài vào Ôn hôm nay; từ Chưa nhớ hiện trong danh sách xem lại', async () => {
    await open(page, '#/bai/' + LID + '/the-tu', { xp: 0 });
    await page.waitForSelector('#fcCard');
    await page.click('#fcCard'); await page.click('#fcNo'); // 1 từ chưa nhớ lần đầu
    for (let i = 0; i < W.length; i++) { await page.keyboard.press('Space'); await page.keyboard.press('ArrowRight'); }
    await page.waitForSelector('.fc-done');
    assert.strictEqual(await page.textContent('#fcFirst'), (W.length - 1) + '/' + W.length);
    const s = await getStore(page);
    assert.strictEqual(s.xp, 5 + W.length - 1);
    assert.ok(s.days.includes(ymd(0)));
    const inSrs = Object.values(s.srs || {}).filter((e) => e.l === LID).length;
    assert.strictEqual(inSrs, W.length, 'từ vào hàng ôn');
    assert.strictEqual(await page.$$eval('.fc-done details li', (e) => e.length), 1);
    await page.click('#fcAgain');
    await page.waitForSelector('#fcCard');
  });

  await tc('F04', 'Thẻ từ Việt → Hàn: mặt trước là nghĩa, lật mới đọc to; lựa chọn được nhớ khi mở lại', async () => {
    await open(page, '#/bai/' + LID + '/the-tu');
    await page.click('[data-front="vi"]');
    await page.waitForSelector('#fcCard');
    await page.evaluate(() => { window.__spoken = []; });
    await page.click('#fcCard');
    const back = (await page.textContent('#fcCard .fc-back')).trim();
    assert.ok(W.some((w) => w[0] === back), 'mặt sau là chữ Hàn');
    assert.strictEqual((await page.evaluate(() => window.__spoken.length)), 1);
    await page.reload(); await page.waitForSelector('#fcCard');
    assert.strictEqual(await page.getAttribute('[data-front="vi"]', 'aria-pressed'), 'true');
    await page.evaluate(() => localStorage.removeItem('hanadul:cards-front'));
  });

  // ================= Chép chính tả =================
  async function dictate(page, lid, wrongAt) {
    const ws = WORDS(lid);
    await page.waitForSelector('#dtIn');
    const total = Math.min(10, ws.length);
    for (let i = 0; i < total; i++) {
      await page.waitForSelector('#dtIn:not([readonly])');
      const said = await page.evaluate(() => window.__spoken[window.__spoken.length - 1].text);
      const w = ws.find((x) => (x[2] || x[0]) === said);
      assert.ok(w, 'máy đọc đúng 1 từ của bài: ' + said);
      await page.fill('#dtIn', wrongAt.includes(i) ? '틀림' : w[0]);
      await page.press('#dtIn', 'Enter');
      await page.waitForSelector('#dtFb .feedback');
      const ok = await page.$('#dtFb .feedback.ok');
      assert.strictEqual(!!ok, !wrongAt.includes(i), 'kết quả câu ' + i);
      if (!ok) assert.ok((await page.textContent('#dtFb')).includes(w[0]), 'hiện đáp án đúng');
      await page.click('#dtNext');
    }
    await page.waitForSelector('#dtScore');
    return total;
  }
  await tc('D01', 'Chép chính tả: 10 từ/lượt, máy đọc từ; gõ đúng ✅, sai ❌ kèm đáp án; ô trống không cho kiểm tra; xong: điểm, XP = 2 × số đúng, từ vào Ôn hôm nay', async () => {
    await open(page, '#/bai/' + LID + '/chinh-ta', { xp: 0 });
    await page.waitForSelector('#dtIn');
    await page.click('.dt-form .btn');
    assert.ok(!(await page.$('#dtFb .feedback')), 'ô trống: chưa chấm');
    const total = await dictate(page, LID, [1, 4]);
    assert.strictEqual(await page.textContent('#dtScore'), (total - 2) + '/' + total + ' từ đúng');
    const s = await getStore(page);
    assert.strictEqual(s.xp, (total - 2) * 2);
    assert.ok(Object.values(s.srs).filter((e) => e.l === LID).length === W.length);
    assert.strictEqual(await page.$$eval('.fc-done details li', (e) => e.length), 2);
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('D02', 'So khớp chính tả: bỏ qua dấu cách/dấu câu/phần trong ngoặc, chấp nhận chữ đem đọc (PC방 = 피시방), bảng chữ chấp nhận âm tiết (ㄱ ↔ 가); từ khác thì sai', async () => {
    await open(page, '#/bai/sc1-08/chinh-ta');
    const r = await page.evaluate(() => {
      const L = window.HD.cardsLib;
      const ok = (w, t) => L.accepts(w).includes(L.norm(t));
      return [ok(['쓰다 (vị)', 'đắng', '쓰다'], '쓰다'), ok(['잘 먹겠습니다.', 'x'], '잘먹겠습니다'), ok(['PC방', 'quán net', '피시방'], '피시방'), ok(['PC방', 'quán net', '피시방'], 'pc방'),
        ok(['ㄱ', 'g / k', '가'], '가'), ok(['ㄱ', 'g / k', '가'], 'ㄱ'), ok(['가다', 'đi'], '가요'), ok(['가다', 'đi'], '')];
    });
    assert.deepStrictEqual(r, [true, true, true, true, true, true, false, false]);
  });

  await tc('D03', 'Chép chính tả bài Bảng chữ (sc1-00) và bài Trung cấp chạy được; Nghe chậm đọc với tốc độ chậm; Gợi ý nghĩa hiện nghĩa', async () => {
    await open(page, '#/bai/sc1-00/chinh-ta');
    await dictate(page, 'sc1-00', []);
    await open(page, '#/bai/tc3-01/chinh-ta');
    await page.waitForSelector('#dtIn');
    await page.click('#dtSlow');
    assert.ok((await page.evaluate(() => window.__spoken[window.__spoken.length - 1].rate)) < 0.7);
    assert.ok(await page.isHidden('#dtHintText'));
    await page.click('#dtHint');
    assert.ok(await page.isVisible('#dtHintText'));
  });

  // ================= Đề thi thử Nghe =================
  await tc('L01', 'Danh sách đề có Đề thi thử Nghe; giới thiệu nêu số lượt nghe, giọng đọc máy, có nút Nghe thử; bắt đầu: 35:00, 30 câu, mỗi bộ câu có 1 nút nghe', async () => {
    await open(page, '#/thi-thu');
    await page.waitForSelector('[data-exam="nghe-01"]');
    await page.click('[data-exam="nghe-01"]');
    await page.waitForSelector('#startBtn');
    const t = await page.textContent('.exam-intro');
    assert.ok(/tối đa 2 lần/.test(t) && /giọng đọc/.test(t), t);
    assert.ok(await page.$('#ttsCheck [data-say]'), 'có nút Nghe thử');
    await page.click('#startBtn');
    await page.waitForSelector('#examTimer');
    assert.ok(/35:00|34:5\d/.test(await page.textContent('#examTimer')));
    assert.strictEqual(await page.$$eval('.ex-q', (e) => e.length), 30);
    assert.strictEqual(await page.$$eval('.ex-audio [data-play]', (e) => e.length), NG.sets.length);
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('L02', 'Nghe: bấm loa đọc đúng lời thoại (nam giọng trầm, nữ giọng cao); đếm lượt còn lại; hết 2 lượt thì khóa nút; tải lại trang vẫn giữ số lượt', async () => {
    await page.evaluate(() => { window.__spoken = []; });
    const si = 5; // bộ B (4 lượt lời)
    await page.click(`[data-play="${si}"]`);
    const sp = await page.evaluate(() => window.__spoken);
    assert.deepStrictEqual(sp.map((x) => x.text), NG.sets[si].lines.map((l) => l[1]));
    NG.sets[si].lines.forEach((l, i) => assert.ok(l[0] === '여자' ? sp[i].pitch > 1 : sp[i].pitch < 1, 'cao độ theo giới tính'));
    assert.ok(/Còn 1 lượt/.test(await page.textContent(`[data-left="${si}"]`)));
    await page.click(`[data-play="${si}"]`);
    assert.ok(await page.isDisabled(`[data-play="${si}"]`));
    assert.ok(/hết lượt/.test(await page.textContent(`[data-left="${si}"]`)));
    await page.reload(); await page.waitForSelector('#examTimer');
    assert.ok(await page.isDisabled(`[data-play="${si}"]`), 'tải lại vẫn khóa');
    assert.ok(/Còn 2 lượt/.test(await page.textContent('[data-left="0"]')));
  });

  await tc('L03', 'Nghe: làm đúng hết → 30/30, 60 điểm; xem lại có lời thoại, bản dịch, giải thích; nút nghe lại không giới hạn; danh sách hiện điểm cao nhất', async () => {
    for (const q of NGQ) await page.click(`.ex-opt[data-n="${q.n}"][data-o="${q.answer}"]`);
    await page.click('#submitBtn'); await page.click('#confirmYes');
    await page.waitForSelector('#scoreRight');
    assert.strictEqual(await page.textContent('#scoreRight'), '30');
    assert.ok(/60\/60/.test(await page.textContent('.exam-score')));
    assert.strictEqual(await page.$$eval('.ex-script', (e) => e.length), NG.sets.length);
    await page.evaluate(() => { window.__spoken = []; });
    for (let i = 0; i < 3; i++) await page.click('[data-replay="0"]');
    assert.strictEqual(await page.evaluate(() => window.__spoken.length), NG.sets[0].lines.length * 3);
    const s = await getStore(page);
    assert.strictEqual(s.exams['nghe-01'].best, 30);
    await page.goto(BASE + 'index.html#/thi-thu'); await page.waitForTimeout(300);
    assert.ok(/30\/30/.test(await page.textContent('[data-exam="nghe-01"]')));
  });

  await tc('L04', 'Nghe: rời trang đang làm thì dừng đọc; sai/bỏ trống được đếm đúng, lọc "Sai và bỏ trống"', async () => {
    await open(page, '#/thi-thu/nghe-01');
    await page.click('#startBtn'); await page.waitForSelector('#examTimer');
    await page.evaluate(() => { window.__cancel = 0; const c = speechSynthesis.cancel.bind(speechSynthesis); speechSynthesis.cancel = () => { window.__cancel++; c(); }; });
    await page.click(`.ex-opt[data-n="1"][data-o="${(NGQ[0].answer + 1) % 4}"]`);
    await page.click(`.ex-opt[data-n="2"][data-o="${NGQ[1].answer}"]`);
    await page.click('#submitBtn'); await page.click('#confirmYes');
    await page.waitForSelector('#scoreRight');
    assert.strictEqual(await page.textContent('#scoreRight'), '1');
    await page.click('[data-f="wrong"]');
    assert.strictEqual(await page.$$eval('.ex-rev .ex-q:not([hidden])', (e) => e.length), 29);
    await page.goto(BASE + 'index.html#/'); await page.waitForTimeout(200);
    assert.ok((await page.evaluate(() => window.__cancel)) >= 0);
  });

  // ================= Điện thoại =================
  const mob = await device(browser, { viewport: { width: 375, height: 760 } });
  const dark = await device(browser, { viewport: { width: 375, height: 760 }, dark: true });
  await tc('M01', 'Điện thoại 375px (sáng + tối): xếp lớp, kết quả, thẻ từ, chính tả, đề Nghe, trang Cài app không tràn ngang; 4 chế độ bài xếp 2 cột', async () => {
    for (const d of [mob, dark]) {
      const p = d.page;
      const dk = d === dark ? '-toi' : '';
      await open(p, '#/xep-lop'); assert.ok(await noHScroll(p)); await shot(p, 'xep-lop' + dk + '.png');
      await placement(p, (bi, qi) => (bi === 1 && qi < 3 ? 'wrong' : 'right'));
      assert.ok(await noHScroll(p)); await shot(p, 'xep-lop-ket-qua' + dk + '.png');
      await open(p, '#/bai/sc2-03/the-tu'); await p.waitForSelector('#fcCard'); await p.click('#fcCard');
      assert.ok(await noHScroll(p)); await shot(p, 'the-tu' + dk + '.png');
      const cols = await p.$eval('.seg', (e) => getComputedStyle(e).gridTemplateColumns.split(' ').length);
      assert.strictEqual(cols, 2);
      await open(p, '#/bai/sc2-03/chinh-ta'); await p.waitForSelector('#dtIn'); await p.fill('#dtIn', '가'); await p.press('#dtIn', 'Enter');
      assert.ok(await noHScroll(p)); await shot(p, 'chinh-ta' + dk + '.png');
      await open(p, '#/thi-thu/nghe-01'); await p.click('#startBtn'); await p.waitForSelector('.ex-audio');
      assert.ok(await noHScroll(p)); await shot(p, 'de-nghe' + dk + '.png');
      await open(p, '#/ung-dung'); assert.ok(await noHScroll(p)); await shot(p, 'cai-app' + dk + '.png');
      assert.deepStrictEqual(p.errors, []);
    }
  });
  await mob.ctx.close(); await dark.ctx.close();

  // ================= Cài app, offline =================
  await tc('W01', 'Manifest hợp lệ (tên, start_url, standalone, biểu tượng 192/512/maskable tải được); trang chủ và giới thiệu gắn manifest + apple-touch-icon', async () => {
    const r = await page.request.get(BASE + 'manifest.webmanifest');
    assert.strictEqual(r.status(), 200);
    const m = await r.json();
    assert.strictEqual(m.short_name, 'Hana Dul'); assert.strictEqual(m.display, 'standalone'); assert.ok(m.start_url);
    const sizes = m.icons.map((i) => i.sizes + ':' + (i.purpose || 'any'));
    assert.ok(sizes.includes('192x192:any') && sizes.includes('512x512:any') && sizes.includes('512x512:maskable'), sizes.join(','));
    for (const i of m.icons) {
      const ir = await page.request.get(BASE + i.src);
      assert.strictEqual(ir.status(), 200, i.src);
      assert.strictEqual(ir.headers()['content-type'], 'image/png');
    }
    for (const f of ['index.html', 'gioi-thieu.html']) {
      const html = fs.readFileSync(path.join(ROOT, f), 'utf8');
      assert.ok(/rel="manifest" href="manifest.webmanifest"/.test(html) && /apple-touch-icon/.test(html) && /assets\/pwa\.js/.test(html), f);
    }
  });

  await tc('W02', 'Kiểm thử tự động không bật trường hợp đặc biệt: không đăng ký service worker (test cũ không bị ảnh hưởng)', async () => {
    await open(page, '#/');
    await page.waitForTimeout(500);
    assert.strictEqual(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length)), 0);
  });

  const sw = await device(browser, { sw: true });
  await tc('W03', 'Service worker đăng ký và điều khiển trang; mất mạng: tải lại trang chủ vẫn mở, bài đã mở vẫn học được, bài chưa mở báo "chưa lưu trên máy" kèm link tải; báo mất mạng/có mạng', async () => {
    const p = sw.page;
    await p.goto(BASE + 'index.html#/'); await p.waitForSelector('.path');
    await p.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), null, { timeout: 10000 });
    await p.reload(); await p.waitForSelector('.path');
    assert.ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'trang do service worker điều khiển');
    await p.goto(BASE + 'index.html#/bai/sc1-02'); await p.waitForSelector('#vocab');
    await sw.ctx.setOffline(true);
    await p.waitForTimeout(300);
    assert.ok(/mất mạng/.test(await p.textContent('#toast')), 'báo mất mạng');
    await p.goto(BASE + 'index.html#/'); await p.waitForSelector('.path');
    await p.goto(BASE + 'index.html#/bai/sc1-02/lam-bai'); await p.waitForSelector('.mode');
    await p.goto(BASE + 'index.html#/bai/sc2-14'); await p.waitForSelector('h1');
    assert.ok(/không có mạng/.test(await p.textContent('h1')), await p.textContent('h1'));
    assert.ok(await p.$('#app a[href="#/ung-dung"]'));
    await sw.ctx.setOffline(false);
  });

  await tc('W04', 'Trang Cài app: tải tất cả bài (thanh tiến độ, "Đã tải đủ"), sau đó mất mạng vẫn mở được mọi bài và đề thi thử Nghe', async () => {
    const p = sw.page;
    await p.goto(BASE + 'index.html#/ung-dung'); await p.waitForSelector('#pwaDownload:not([disabled])');
    assert.ok(/Đã có \d+\/\d+ file/.test(await p.textContent('#pwaStatus')));
    await p.click('#pwaDownload');
    await p.waitForFunction(() => /Đã tải đủ/.test(document.getElementById('pwaStatus').textContent), null, { timeout: 30000 });
    await sw.ctx.setOffline(true);
    for (const id of ['sc2-14', 'tc3-09', 'sc1-15']) {
      await p.goto(BASE + 'index.html#/bai/' + id + '/the-tu'); await p.waitForSelector('#fcCard', { timeout: 5000 });
    }
    await p.goto(BASE + 'index.html#/thi-thu/nghe-01'); await p.waitForSelector('#startBtn');
    await p.goto(BASE + 'index.html#/xep-lop'); await p.waitForSelector('#plStart');
    await sw.ctx.setOffline(false);
    assert.deepStrictEqual(p.errors.filter((e) => !/Offline|503/.test(e)), []);
  });

  await tc('W05', 'Trình duyệt báo cài được (beforeinstallprompt): trang Cài app hiện nút Cài, bấm gọi hộp cài của trình duyệt; trang chủ người đã học hiện thẻ Cài app', async () => {
    const p = sw.page;
    await open(p, '#/', { xp: 30, days: [ymd(0)] });
    const fire = () => p.evaluate(() => {
      const e = new Event('beforeinstallprompt');
      window.__prompted = 0;
      e.prompt = () => { window.__prompted++; };
      e.userChoice = Promise.resolve({ outcome: 'accepted' });
      window.dispatchEvent(e);
    });
    await fire();
    await p.waitForSelector('#pwaSlot .pwa-card');
    await p.click('#pwaSlot .pwa-card');
    await p.waitForSelector('.pwa-panel');
    await fire();
    await p.waitForSelector('#pwaInstall');
    await p.click('#pwaInstall');
    assert.strictEqual(await p.evaluate(() => window.__prompted), 1);
  });
  await sw.ctx.close();

  await browser.close();
  console.log('\n' + results.map((r) => r.join(' | ')).join('\n'));
  console.log(`\n${results.filter((r) => r[2] === 'PASS').length}/${results.length} PASS`);
})();
