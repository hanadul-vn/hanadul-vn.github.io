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
const DOC = IDX.exams.filter((e) => e.part !== 'viet');
const VID = 'viet-01';
const VQ = EX[VID].sets.flatMap((st) => st.questions);
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

  await tc('E14', 'Mọi đề Đọc trong danh sách: làm đúng hết được trọn điểm (đáp án trong dữ liệu khớp giao diện); danh sách hiện điểm cao nhất', async () => {
    for (const e of DOC) {
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
    for (const e of DOC) assert.ok((await p.textContent('.exam-item[data-exam="' + e.id + '"]')).includes('Cao nhất ' + e.count + '/' + e.count), e.id);
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

  // ---------- phần Viết (câu 51–54) ----------
  const v = await device(browser);
  const vp = v.page;
  const ko = (n) => '가나다라마 바사아자차 '.repeat(Math.ceil(n / 11)).slice(0, n);
  const vstore = async () => (await store(vp)).exams[VID];

  await tc('V1', 'Viết: trang giới thiệu nêu cách tự chấm; bắt đầu có 4 ô ㉠㉡ + 2 ô viết bài, đếm chữ, đồng hồ 50:00', async () => {
    await vp.goto(BASE + '#/thi-thu');
    await vp.waitForSelector('.exam-item[data-exam="' + VID + '"]');
    assert.ok((await vp.textContent('.exam-item[data-exam="' + VID + '"]')).includes('Chưa làm'));
    assert.ok(!(await vp.textContent('#app')).includes('sẽ có sớm'));
    await vp.goto(BASE + '#/thi-thu/' + VID);
    await vp.waitForSelector('#startBtn');
    const intro = await vp.textContent('.exam-intro');
    assert.ok(intro.includes('50 phút') && intro.includes('tự chấm') && intro.includes('100 điểm'), intro);
    await vp.click('#startBtn');
    await vp.waitForSelector('#examTimer');
    assert.strictEqual(await timerSecs(vp), 50 * 60);
    assert.strictEqual(await vp.locator('.wr-in').count(), 4);
    assert.strictEqual(await vp.locator('.wr-ta').count(), 2);
    assert.strictEqual(await vp.locator('.ex-opt').count(), 0);
    assert.ok((await vp.textContent('#examCount')).includes('0/4'));
    assert.ok((await vp.textContent('#cnt-53')).includes('200–300'));
    assert.ok((await vp.textContent('#cnt-54')).includes('600–700'));
  });

  await tc('V2', 'Viết: gõ tới đâu lưu tới đó; bộ đếm chữ đỏ khi thiếu, xanh khi đủ (không tính xuống dòng); bảng câu đánh dấu câu đã viết', async () => {
    await vp.fill('[data-key="51-㉠"]', '꼭 와 주세요.');
    await vp.fill('[data-key="51-㉡"]', '전화해 줘');
    await vp.fill('[data-key="53"]', ko(150));
    assert.ok(!(await vp.getAttribute('#cnt-53', 'class')).includes('ok'));
    assert.ok((await vp.textContent('#cnt-53')).startsWith('150'));
    await vp.fill('[data-key="53"]', ko(100) + '\n\n' + ko(110));
    assert.ok((await vp.textContent('#cnt-53')).startsWith('210'), await vp.textContent('#cnt-53'));
    assert.ok((await vp.getAttribute('#cnt-53', 'class')).includes('ok'));
    assert.ok((await vp.textContent('#examCount')).includes('2/4'));
    assert.ok(await vp.locator('[data-jump="51"].on').count());
    assert.ok(await vp.locator('[data-jump="53"].on').count());
    assert.ok(!(await vp.locator('[data-jump="52"].on').count()));
    const r = await run(vp);
    assert.strictEqual(r.texts['51-㉠'], '꼭 와 주세요.');
    assert.strictEqual(r.texts['53'].length, 212);
  });

  await tc('V3', 'Viết: tải lại trang giữa chừng không mất chữ, đồng hồ vẫn chạy tiếp', async () => {
    await vp.clock.fastForward(5 * 60 * 1000);
    await vp.reload();
    await vp.waitForSelector('#examTimer');
    assert.strictEqual(await vp.inputValue('[data-key="51-㉡"]'), '전화해 줘');
    assert.ok((await vp.inputValue('[data-key="53"]')).includes('\n\n'));
    const t = await timerSecs(vp);
    assert.ok(t <= 45 * 60 && t > 44 * 60, 'giờ ' + t);
    assert.ok((await vp.textContent('#examCount')).includes('2/4'));
  });

  await tc('V4', 'Viết: nộp bài → ô khớp đáp án mẫu tự được điểm, còn lại chờ tự chấm; câu bỏ trống 0 điểm; +20 XP; bài đang làm bị xóa', async () => {
    const xp0 = (await store(vp)).xp || 0;
    await vp.click('#submitBtn');
    assert.ok((await vp.textContent('#confirmBox')).includes('Còn 2 câu chưa viết'));
    await vp.click('#confirmYes');
    await vp.waitForSelector('#scoreTotal');
    assert.strictEqual(await vp.textContent('#scoreTotal'), '5');
    assert.ok((await vp.textContent('#pendingMsg')).includes('Còn 4 mục'));
    assert.ok((await vp.textContent('[data-item="51-㉠"]')).includes('Khớp đáp án mẫu'));
    assert.strictEqual(await vp.locator('[data-item="51-㉡"] .sg').count(), 3);
    assert.ok((await vp.textContent('#r-52')).includes('Bỏ trống'));
    assert.ok((await vp.textContent('#r-54')).includes('chưa viết câu này'));
    assert.strictEqual(await vp.locator('#r-54 .sg').count(), 0);
    assert.ok((await vp.textContent('#r-53 .wr-mine')).length >= 210);
    assert.ok(await vp.locator('#r-53 details.wr-sample').count());
    const s = await store(vp);
    assert.strictEqual(s.xp - xp0, 20);
    assert.strictEqual(s.exams[VID].last, 5);
    assert.strictEqual(s.exams[VID].texts['51-㉠'], '꼭 와 주세요.');
    assert.ok(s.exams[VID].secs >= 300 && s.exams[VID].secs < 320, 'secs ' + s.exams[VID].secs);
    assert.strictEqual(await run(vp), null);
    assert.deepStrictEqual(v.errors, []);
  });

  await tc('V5', 'Viết: tự chấm theo mức → điểm câu, tổng, "đã chấm xong" cập nhật ngay; tải lại vẫn giữ; bấm lại để bỏ; danh sách hiện điểm cao nhất', async () => {
    await vp.click('[data-k="51-㉡"][data-v="0.6"]');
    assert.strictEqual(await vp.textContent('#scoreTotal'), '8');
    assert.strictEqual(await vp.textContent('[data-qpts="51"]'), '8');
    await vp.click('[data-k="53-0"][data-v="1"]');
    await vp.click('[data-k="53-1"][data-v="0.6"]');
    await vp.click('[data-k="53-2"][data-v="0.25"]');
    assert.strictEqual(await vp.textContent('[data-qpts="53"]'), '15');
    assert.strictEqual(await vp.textContent('#scoreTotal'), '23');
    assert.ok((await vp.textContent('#pendingMsg')).includes('Đã chấm xong'));
    await vp.reload();
    await vp.waitForSelector('#scoreTotal');
    assert.strictEqual(await vp.textContent('#scoreTotal'), '23');
    assert.strictEqual(await vp.getAttribute('[data-k="53-1"][data-v="0.6"]', 'aria-pressed'), 'true');
    await vp.click('[data-k="53-2"][data-v="0.25"]');
    assert.strictEqual(await vp.textContent('#scoreTotal'), '19');
    assert.ok((await vp.textContent('#pendingMsg')).includes('Còn 1 mục'));
    const e = await vstore();
    assert.strictEqual(e.last, 19);
    assert.strictEqual(e.best, 19);
    assert.strictEqual(e.self['51-㉡'], 0.6);
    assert.ok(e.gat > e.at);
    await vp.click('[data-k="53-2"][data-v="0.25"]');
    await vp.goto(BASE + '#/thi-thu');
    await vp.waitForSelector('.exam-item');
    assert.ok((await vp.textContent('.exam-item[data-exam="' + VID + '"]')).includes('Cao nhất 23/100'));
    await vp.goto(BASE + '#/thi-thu/' + VID);
    await vp.waitForSelector('#startBtn');
    assert.ok((await vp.textContent('.exam-intro')).includes('23/100'));
  });

  await tc('V6', 'Viết: hết giờ tự nộp với chữ đang gõ dở; điểm cao nhất lần trước được giữ', async () => {
    await vp.click('#startBtn');
    await vp.waitForSelector('#examTimer');
    assert.strictEqual(await vp.inputValue('[data-key="53"]'), '');
    await vp.fill('[data-key="54"]', ko(80));
    await vp.clock.fastForward(50 * 60 * 1000 + 2000);
    await vp.waitForSelector('#timeUpMsg');
    assert.strictEqual(await vp.textContent('#scoreTotal'), '0');
    assert.ok((await vp.textContent('#pendingMsg')).includes('Còn 3 mục'));
    const e = await vstore();
    assert.strictEqual(e.texts['54'], ko(80));
    assert.strictEqual(e.n, 2);
    assert.strictEqual(e.best, 23);
    assert.strictEqual(e.secs, 50 * 60);
    assert.strictEqual(await run(vp), null);
  });

  await tc('V7', 'Viết: điền đúng đáp án mẫu (khác dấu cách, dấu câu) ở cả 4 ô → 20/20 điểm tự động; bài mẫu 53–54 đúng độ dài', async () => {
    await vp.goto(BASE + '#/thi-thu/' + VID);
    await vp.click('#startBtn');
    await vp.waitForSelector('#examTimer');
    for (const q of VQ.filter((x) => x.kind === 'fill')) {
      for (const [i, b] of q.blanks.entries()) {
        const a = b.answers[i % b.answers.length];
        await vp.fill('[data-key="' + q.n + '-' + b.mark + '"]', i ? a.replace(/ /g, '  ') + '.' : a);
      }
    }
    await vp.click('#submitBtn2'); await vp.click('#confirmYes');
    await vp.waitForSelector('#scoreTotal');
    assert.strictEqual(await vp.textContent('#scoreTotal'), '20');
    assert.strictEqual(await vp.locator('.wr-auto').count(), 4);
    for (const q of VQ.filter((x) => x.kind !== 'fill')) {
      const c = q.sample.replace(/[\r\n]/g, '').length;
      assert.ok(c >= q.minChars && c <= q.maxChars, q.n + ': ' + c);
      assert.ok((await vp.textContent('#r-' + q.n + ' .wr-sample summary')).includes(c + ' ký tự'));
    }
    assert.deepStrictEqual(v.errors, []);
  });
  await v.ctx.close();

  await tc('V8', 'Viết trên điện thoại 375px (sáng + tối): làm bài, kết quả, tự chấm không tràn ngang', async () => {
    for (const dark of [false, true]) {
      const m = await device(browser, { viewport: { width: 375, height: 760 }, dark });
      const mp = m.page;
      await mp.goto(BASE + '#/thi-thu/' + VID);
      await mp.click('#startBtn');
      await mp.waitForSelector('#examTimer');
      await mp.fill('[data-key="51-㉠"]', '꼭 와 주세요');
      await mp.fill('[data-key="53"]', VQ[2].sample);
      await noOverflow(mp, 'làm bài viết');
      await mp.locator('#q-53').scrollIntoViewIfNeeded();
      await mp.screenshot({ path: SHOTS + '/thi-thu-viet-dien-thoai' + (dark ? '-toi' : '') + '.png' });
      await mp.click('#submitBtn'); await mp.click('#confirmYes');
      await mp.waitForSelector('#scoreTotal');
      await mp.click('[data-k="53-0"][data-v="1"]');
      await noOverflow(mp, 'kết quả viết');
      await mp.locator('#r-53').scrollIntoViewIfNeeded();
      await mp.screenshot({ path: SHOTS + '/thi-thu-viet-tu-cham-dien-thoai' + (dark ? '-toi' : '') + '.png' });
      assert.deepStrictEqual(m.errors, []);
      await m.ctx.close();
    }
  });

  await browser.close();
  console.log('\n' + results.filter((r) => r[2] === 'PASS').length + '/' + results.length + ' PASS');
  fs.writeFileSync(SHOTS + '/e2e_exam.json', JSON.stringify(results, null, 1));
})();
