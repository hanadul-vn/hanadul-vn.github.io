// Test đề thi thử (assets/exam.js): làm bài có tính giờ, tải lại trang, nộp bài, hết giờ tự nộp, xem lại.
// Chạy: python3 -m http.server 8765 (ở thư mục gốc repo), rồi SHOTS=/tmp node tests/e2e_exam.js   (ONLY=E1,E2 chạy riêng)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE || 'http://localhost:8765/';
const SHOTS = process.env.SHOTS || '/tmp';
const ROOT = path.resolve(__dirname, '..');
const IDX = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/exams/index.json'), 'utf8'));
const EX = {};
IDX.exams.forEach((e) => { EX[e.id] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/exams', e.id + '.json'), 'utf8')); });
const ID = 'doc-01';
const QS = EX[ID].sets.flatMap((s) => s.questions);
const T0 = new Date('2026-11-23T08:00:00+07:00');

const results = [];
async function tc(id, name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) return;
  try { await fn(); results.push([id, name, 'PASS']); console.log('PASS', id, name); }
  catch (e) { results.push([id, name, 'FAIL: ' + e.message.split('\n')[0]]); console.log('FAIL', id, name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n   ')); process.exitCode = 1; }
}
async function device(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  await require('./stub_third_party')(ctx);
  const net = [];
  // Không đăng nhập: không được gọi Supabase.
  await ctx.route(/supabase\.co\//, (r) => { net.push(r.request().url()); r.abort(); });
  await ctx.route('**/assets/config.js', async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace(/supabaseUrl: '[^']*'/, "supabaseUrl: ''").replace(/supabaseKey: '[^']*'/, "supabaseKey: ''");
    route.fulfill({ response: r, body });
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: T0 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  return { ctx, page, errors, net };
}
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('hanadul:v2') || '{}'));
const run = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('hanadul:exam-run') || 'null'));
const timerSecs = async (page) => {
  const t = (await page.textContent('#examTimer')).replace(/[^0-9:]/g, '');
  const [m, s] = t.split(':').map(Number);
  return m * 60 + s;
};
async function pick(page, n, o) { await page.click('.ex-opt[data-n="' + n + '"][data-o="' + o + '"]'); }
// Chọn đáp án o cho câu n (nếu đang chọn sẵn thì giữ nguyên, không bấm để khỏi bỏ chọn).
async function choose(page, n, o) {
  if (await page.locator('.ex-opt[data-n="' + n + '"][data-o="' + o + '"].on').count()) return;
  await pick(page, n, o);
}
async function start(page) {
  await page.goto(BASE + '#/thi-thu/' + ID);
  await page.click('#startBtn');
  await page.waitForSelector('#examTimer');
}
async function noOverflow(page, label) {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(over <= 0, label + ': tràn ngang ' + over + 'px');
}

(async () => {
  const browser = await chromium.launch();
  const d = await device(browser);
  const p = d.page;

  await tc('E1', 'Trang chủ có thẻ Đề thi thử → danh sách đề, đề chưa làm; không cần đăng nhập, không lỗi console', async () => {
    await p.goto(BASE);
    await p.waitForSelector('.continue.exam-card');
    await p.click('.continue.exam-card');
    await p.waitForSelector('.exam-item');
    assert.strictEqual(await p.locator('.exam-item').count(), IDX.exams.length);
    assert.ok((await p.textContent('.exam-item[data-exam="' + ID + '"]')).includes('Chưa làm'));
    assert.ok((await p.textContent('#app')).includes('không phải đề thi chính thức'));
    assert.deepStrictEqual(d.errors, []);
    assert.deepStrictEqual(d.net, []);
  });

  await tc('E2', 'Bắt đầu: đồng hồ 70:00, đủ 50 câu × 4 lựa chọn, có lời dẫn [1~2], [3~4]…, có Bảng câu hỏi', async () => {
    await p.click('.exam-item[data-exam="' + ID + '"]');
    await p.waitForSelector('.exam-rules');
    assert.ok((await p.textContent('.exam-rules')).includes('70 phút'));
    await p.click('#startBtn');
    await p.waitForSelector('#examTimer');
    assert.strictEqual(await timerSecs(p), 70 * 60);
    assert.strictEqual(await p.locator('.ex-q').count(), 50);
    assert.strictEqual(await p.locator('.ex-opt').count(), 200);
    const inst = await p.locator('.ex-inst').allTextContents();
    assert.ok(inst[0].startsWith('[1~2]') && inst[1].startsWith('[3~4]'), inst.slice(0, 2).join(' | '));
    assert.ok(inst.some((t) => t.startsWith('[48~50]')) && inst.some((t) => t.startsWith('[19~20]')) && inst.some((t) => t.startsWith('[5~8]')), 'lời dẫn nhóm sai: ' + inst.map((t) => t.split(']')[0]).join(','));
    assert.strictEqual(await p.locator('[data-jump]').count(), 50);
    assert.ok((await p.textContent('#examCount')).includes('0/50'));
    assert.ok(/^⏱/.test(await p.title()));
  });

  await tc('E3', 'Chọn đáp án: đánh dấu, đếm Đã làm, Bảng câu hỏi đổi màu; bấm lại thì bỏ chọn; đổi đáp án giữ 1 lựa chọn', async () => {
    await pick(p, 1, 0); await pick(p, 2, 1); await pick(p, 3, 1);
    assert.ok((await p.textContent('#examCount')).includes('3/50'));
    assert.strictEqual(await p.getAttribute('.ex-opt[data-n="1"][data-o="0"]', 'aria-checked'), 'true');
    assert.ok(await p.locator('[data-jump="2"].on').count());
    await pick(p, 3, 1); // bỏ chọn
    assert.ok((await p.textContent('#examCount')).includes('2/50'));
    await pick(p, 2, 2); // đổi đáp án
    assert.strictEqual(await p.locator('.ex-opt[data-n="2"].on').count(), 1);
    const r = await run(p);
    assert.deepStrictEqual(r.answers, { 1: 0, 2: 2 });
  });

  await tc('E4', 'Qua 10 phút rồi tải lại trang: đồng hồ chạy tiếp (~60:00), đáp án còn nguyên', async () => {
    await p.clock.fastForward(10 * 60000);
    await p.reload();
    await p.waitForSelector('#examTimer');
    const t = await timerSecs(p);
    assert.ok(t <= 60 * 60 && t >= 59 * 60, 'đồng hồ ' + t);
    assert.ok(await p.locator('.ex-opt[data-n="1"][data-o="0"].on').count(), 'mất đáp án câu 1');
    assert.ok((await p.textContent('#examCount')).includes('2/50'));
  });

  await tc('E5', 'Rời trang khi đang làm: trang chủ mời làm tiếp (còn thời gian), danh sách báo Đang làm dở, giới thiệu đề có nút Làm tiếp', async () => {
    await p.goto(BASE + '#/');
    await p.waitForSelector('.exam-card.doing');
    assert.ok((await p.textContent('.exam-card.doing')).includes('còn'));
    await p.goto(BASE + '#/thi-thu');
    await p.waitForSelector('.exam-item .tag.doing');
    await p.goto(BASE + '#/thi-thu/' + ID);
    await p.waitForSelector('#resumeBtn');
    await p.click('#resumeBtn');
    await p.waitForSelector('#examTimer');
    assert.ok((await p.textContent('#examCount')).includes('2/50'));
  });

  let right = 0;
  await tc('E6', 'Nộp bài còn câu trống: hỏi xác nhận (báo số câu trống), Làm tiếp thì đóng; Nộp thì ra đúng số câu đúng, điểm, XP, lưu tiến độ', async () => {
    // Câu 1–30: chọn đúng; 31–40: chọn sai; 41–50: bỏ trống.
    for (const q of QS) {
      if (q.n <= 30) await choose(p, q.n, q.answer);
      else if (q.n <= 40) await choose(p, q.n, (q.answer + 1) % 4);
    }
    right = 30;
    const before = await store(p);
    await p.click('#submitBtn');
    await p.waitForSelector('#confirmBox:not([hidden])');
    assert.ok((await p.textContent('#confirmBox')).includes('Còn 10 câu chưa làm'));
    await p.click('#confirmNo');
    assert.ok(await p.locator('#confirmBox').isHidden());
    await p.click('#submitBtn');
    await p.click('#confirmYes');
    await p.waitForSelector('#scoreRight');
    assert.strictEqual(Number(await p.textContent('#scoreRight')), right);
    const txt = await p.textContent('.exam-score');
    assert.ok(txt.includes('60/100'), 'điểm sai: ' + txt);
    assert.ok(txt.includes('+60'), 'thiếu XP vừa nhận');
    const s = await store(p);
    assert.strictEqual(s.xp, (before.xp || 0) + 60);
    assert.ok(s.days.includes('2026-11-23'), 'chưa ghi ngày học');
    const e = s.exams[ID];
    assert.strictEqual(e.best, 30); assert.strictEqual(e.last, 30); assert.strictEqual(e.n, 1);
    assert.strictEqual(e.ans.length, 50);
    assert.strictEqual(e.ans.slice(40), '----------');
    assert.ok(e.secs >= 600 && e.secs < 4200, 'thời gian làm ' + e.secs);
    assert.strictEqual(await run(p), null, 'chưa xóa bài đang làm');
    assert.ok(!(await p.locator('#timeUpMsg').count()), 'nộp tay mà báo hết giờ');
  });

  await tc('E7', 'Xem lại: câu đúng/sai/bỏ trống đánh dấu đúng, đáp án đúng tô xanh, có giải thích và bản dịch; lọc chỉ câu sai', async () => {
    assert.strictEqual(await p.locator('.ex-rev .ex-q.right').count(), 30);
    assert.strictEqual(await p.locator('.ex-rev .ex-q.wrong').count(), 10);
    assert.strictEqual(await p.locator('.ex-rev .ex-q.blank').count(), 10);
    assert.strictEqual(await p.locator('.ex-rev .ex-opt.correct').count(), 50);
    assert.strictEqual(await p.locator('.ex-rev .ex-opt.chosen').count(), 10);
    assert.strictEqual(await p.locator('.ex-explain').count(), 50);
    assert.ok(await p.locator('.ex-vi').count() >= 30);
    await p.click('[data-f="wrong"]');
    assert.strictEqual(await p.locator('.ex-rev .ex-q:visible').count(), 20);
    await p.click('[data-f="all"]');
    assert.strictEqual(await p.locator('.ex-rev .ex-q:visible').count(), 50);
    // Tải lại trang kết quả: vẫn xem lại được, không còn hiện XP "+60" (chỉ hiện ngay sau khi nộp)
    await p.reload();
    await p.waitForSelector('#scoreRight');
    assert.ok(!(await p.textContent('.exam-score')).includes('+60'));
    assert.deepStrictEqual(d.errors, []);
  });

  await tc('E8', 'Hết giờ khi đang mở bài: tự nộp, báo hết giờ, thời gian làm = 70 phút', async () => {
    await start(p);
    await pick(p, 1, QS[0].answer); await pick(p, 2, QS[1].answer);
    await p.clock.fastForward(69 * 60000 + 50000);
    assert.ok(await p.locator('#examTimer.warn').count(), 'sắp hết giờ chưa đổi màu');
    await p.clock.fastForward(15000);
    await p.waitForSelector('#timeUpMsg', { timeout: 5000 });
    assert.strictEqual(Number(await p.textContent('#scoreRight')), 2);
    const e = (await store(p)).exams[ID];
    assert.strictEqual(e.secs, 4200);
    assert.strictEqual(e.best, 30, 'điểm cao nhất bị hạ');
    assert.strictEqual(e.last, 2); assert.strictEqual(e.n, 2);
  });

  await tc('E9', 'Đóng tab rồi quay lại sau khi hết giờ: mở đề là tự nộp, không cho làm tiếp', async () => {
    await start(p);
    await pick(p, 5, QS[4].answer);
    await p.goto(BASE + '#/');
    await p.clock.fastForward(71 * 60000);
    await p.reload();
    await p.waitForSelector('.exam-card');
    assert.ok(!(await p.locator('.exam-card.doing').count()), 'hết giờ vẫn mời làm tiếp');
    await p.goto(BASE + '#/thi-thu/' + ID);
    await p.waitForSelector('#timeUpMsg');
    assert.strictEqual(Number(await p.textContent('#scoreRight')), 1);
    assert.strictEqual((await store(p)).exams[ID].n, 3);
  });

  await tc('E10', 'Đang làm dở đề khác: trang giới thiệu cảnh báo, có Làm tiếp đề kia và Bỏ đề kia', async () => {
    await p.goto(BASE + '#/thi-thu/doc-02');
    await p.click('#startBtn');
    await p.waitForSelector('#examTimer');
    await p.goto(BASE + '#/thi-thu/' + ID);
    await p.waitForSelector('#otherRun');
    assert.ok(await p.locator('a[href="#/thi-thu/doc-02/lam"]').count());
    await p.click('#startBtn');
    await p.waitForSelector('#examTimer');
    assert.strictEqual((await run(p)).id, ID);
    await p.evaluate(() => localStorage.removeItem('hanadul:exam-run'));
  });

  await tc('E14', 'Mọi đề trong danh sách: làm đúng hết được trọn điểm (đáp án trong dữ liệu khớp giao diện); danh sách hiện điểm cao nhất', async () => {
    for (const e of IDX.exams) {
      await p.goto(BASE + '#/thi-thu/' + e.id);
      await p.click('#startBtn');
      await p.waitForSelector('#examTimer');
      for (const q of EX[e.id].sets.flatMap((st) => st.questions)) await choose(p, q.n, q.answer);
      assert.ok((await p.textContent('#examCount')).includes(e.count + '/' + e.count));
      await p.click('#submitBtn2');
      assert.ok((await p.textContent('#confirmBox')).includes('đã làm hết'));
      await p.click('#confirmYes');
      await p.waitForSelector('#scoreRight');
      assert.strictEqual(Number(await p.textContent('#scoreRight')), e.count, e.id);
      assert.strictEqual(await p.locator('.ex-rev .ex-q.right').count(), e.count);
    }
    await p.goto(BASE + '#/thi-thu');
    await p.waitForSelector('.exam-item');
    for (const e of IDX.exams) assert.ok((await p.textContent('.exam-item[data-exam="' + e.id + '"]')).includes('Cao nhất ' + e.count + '/' + e.count), e.id);
  });

  await tc('E11', 'Đề không tồn tại / mã lạ: báo không tải được, có link về danh sách, không lỗi JS', async () => {
    await p.goto(BASE + '#/thi-thu/khong-co');
    await p.waitForSelector('text=Không tải được đề thi');
    await p.goto(BASE + '#/thi-thu/..%2Fx');
    await p.waitForSelector('text=Không tải được đề thi');
    assert.ok(!d.errors.some((e) => /pageerror/.test(e)), d.errors.join(' | '));
  });

  await tc('E12', 'Trang chủ, bài học, Sổ câu sai vẫn bình thường sau khi làm đề (tiến độ cũ không mất)', async () => {
    await p.goto(BASE + '#/');
    await p.waitForSelector('.path .node');
    await p.goto(BASE + '#/bai/sc1-01');
    await p.waitForSelector('.seg');
    const s = await store(p);
    assert.ok(s.xp >= 60 && s.exams[ID]);
  });
  await d.ctx.close();

  await tc('E13', 'Điện thoại 375px (sáng + tối): danh sách, làm bài, kết quả không tràn ngang; thanh giờ luôn thấy khi cuộn', async () => {
    for (const dark of [false, true]) {
      const m = await device(browser, { viewport: { width: 375, height: 760 }, dark });
      const mp = m.page;
      await mp.goto(BASE + '#/thi-thu');
      await mp.waitForSelector('.exam-item');
      await noOverflow(mp, 'danh sách');
      await start(mp);
      await noOverflow(mp, 'làm bài');
      await mp.locator('#q-25').scrollIntoViewIfNeeded();
      const top = await mp.evaluate(() => document.querySelector('.exam-bar').getBoundingClientRect().top);
      assert.ok(top >= -1 && top <= 1, 'thanh giờ không dính trên cùng: ' + top);
      for (const q of QS.slice(0, 12)) await pick(mp, q.n, q.n % 3 ? q.answer : (q.answer + 1) % 4);
      await mp.evaluate(() => window.scrollTo(0, 0));
      await mp.screenshot({ path: SHOTS + '/thi-thu-lam-bai-dien-thoai' + (dark ? '-toi' : '') + '.png' });
      await mp.click('#submitBtn'); await mp.click('#confirmYes');
      await mp.waitForSelector('#scoreRight');
      await noOverflow(mp, 'kết quả');
      await mp.screenshot({ path: SHOTS + '/thi-thu-ket-qua-dien-thoai' + (dark ? '-toi' : '') + '.png', fullPage: false });
      assert.deepStrictEqual(m.errors, []);
      await m.ctx.close();
    }
  });

  await browser.close();
  console.log('\n' + results.filter((r) => r[2] === 'PASS').length + '/' + results.length + ' PASS');
  fs.writeFileSync(SHOTS + '/e2e_exam.json', JSON.stringify(results, null, 1));
})();
