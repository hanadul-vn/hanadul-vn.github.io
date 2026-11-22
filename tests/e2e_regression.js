// Test hồi quy phần cũ (học, làm bài, Sổ câu sai, luyện viết, trang giới thiệu) sau khi thêm tài khoản.
// Chạy: python3 -m http.server 8765 (ở thư mục gốc repo), rồi node tests/e2e_regression.js
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');

const BASE = process.env.BASE || 'http://localhost:8765/';
const SB = 'https://test-hanadul.supabase.co';
const results = [];
async function tc(id, name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) return;
  try { await fn(); results.push([id, name, 'PASS']); console.log('PASS', id, name); }
  catch (e) { results.push([id, name, 'FAIL: ' + e.message.split('\n')[0]]); console.log('FAIL', id, name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n   ')); process.exitCode = 1; }
}
async function device(browser, acctOn, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1100, height: 900 } });
  await require('./stub_third_party')(ctx);
  const net = [];
  await ctx.route(SB + '/**', (r) => { net.push(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{}' }); });
  await ctx.route('**/assets/config.js', async (route) => {
    const r = await route.fetch();
    let body = await r.text();
    // Config thật có thể đã điền khóa: test luôn tự đặt lại (bật = server giả, tắt = để trống).
    body = body.replace(/supabaseUrl: '[^']*'/, "supabaseUrl: '" + (acctOn ? SB : '') + "'").replace(/supabaseKey: '[^']*'/, "supabaseKey: '" + (acctOn ? 'sb_publishable_x' : '') + "'");
    route.fulfill({ response: r, body });
  });
  await ctx.route('**/assets/app.js', async (route) => {
    const r = await route.fetch();
    route.fulfill({ response: r, body: (await r.text()).replace('\n      state = null;\n', '\n      state = null; window.__curIdx = q.options.indexOf(q.answer);\n') });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  return { ctx, page, errors, net };
}
async function finishQuiz(page, wrongN, useKeys) {
  let wrongLeft = wrongN || 0;
  for (let i = 0; i < 400; i++) {
    await page.waitForSelector('.opt, .result-grid');
    if (await page.locator('.result-grid').count()) return;
    const right = await page.evaluate(() => window.__curIdx);
    const n = await page.locator('.opt').count();
    const retry = await page.locator('.retry-tag').filter({ hasText: 'Làm lại' }).count();
    const idx = wrongLeft > 0 && !retry ? (right + 1) % n : right;
    if (useKeys) { await page.keyboard.press(String(idx + 1)); await page.waitForSelector('#next'); await page.keyboard.press('Enter'); }
    else { await page.click('.opt[data-o="' + idx + '"]'); await page.click('#next'); }
    if (idx !== right) wrongLeft--;
  }
  throw new Error('bài không kết thúc');
}
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('hanadul:v2') || 'null'));

(async () => {
  const browser = await chromium.launch();
  const index = JSON.parse(fs.readFileSync('data/index.json', 'utf8'));
  const ids = index.levels.flatMap((l) => l.lessons.map((x) => x.id));

  for (const acctOn of [false, true]) {
    const tag = acctOn ? ' [config tài khoản BẬT, chưa đăng nhập]' : ' [config trống]';
    const d = await device(browser, acctOn);
    const p = d.page;

    await tc(acctOn ? 'R2b' : 'R2', 'Mọi bài: trang học có thẻ từ, Luyện nhanh làm hết, lưu sao/XP, nút bài tiếp' + tag, async () => {
      for (const id of ids) {
        await p.goto(BASE + '#/bai/' + id);
        await p.reload();
        await p.waitForSelector('.wcard');
        await p.goto(BASE + '#/bai/' + id + '/lam-bai');
        await p.reload();
        await p.click('.mode[data-mode="quick"]');
        await finishQuiz(p, 0);
        const s = await store(p);
        assert.ok(s.lessons[id] && s.lessons[id].best === 100 && s.lessons[id].stars === 3, id + ' không lưu kết quả');
      }
      await p.goto(BASE + '#/');
      await p.waitForSelector('.path .node.done');
      assert.strictEqual(await p.locator('.path .node.done').count(), ids.length);
    });

    await tc(acctOn ? 'R3b' : 'R3', 'Ôn đầy đủ + Sổ câu sai: sai vào sổ, ôn đúng 2 lần thì ra khỏi sổ' + tag, async () => {
      await p.goto(BASE + '#/bai/sc1-05/lam-bai');
      await p.reload();
      await p.click('.mode[data-mode="full"]');
      await finishQuiz(p, 3);
      let s = await store(p);
      assert.strictEqual(Object.keys(s.wrong).length, 3);
      assert.ok(Object.values(s.wrong).every((e) => e.ts > 0));
      for (let k = 0; k < 2; k++) {
        await p.goto(BASE + '#/so-cau-sai');
        await p.reload();
        await p.click('#startReview');
        await finishQuiz(p, 0);
      }
      s = await store(p);
      assert.strictEqual(Object.keys(s.wrong).length, 0);
      assert.strictEqual(Object.keys(s.wrongDel).length, 3);
      await p.goto(BASE + '#/so-cau-sai');
      await p.reload(); // hash không đổi sau lượt ôn nên phải tải lại (như trước đây)
      await p.waitForSelector('text=Sổ đang trống');
    });

    await tc(acctOn ? 'R4b' : 'R4', 'Luyện viết tự lưu, tải lại vẫn còn; nút xem câu mẫu' + tag, async () => {
      await p.goto(BASE + '#/bai/sc1-03');
      await p.reload();
      await p.fill('#wtext', '저는 학생이에요.');
      await p.waitForSelector('text=Đã lưu trên máy');
      await p.reload();
      assert.strictEqual(await p.inputValue('#wtext'), '저는 학생이에요.');
      await p.click('#wshow');
      assert.ok(await p.locator('#wsamples').isVisible());
      assert.ok((await store(p)).writingAt['sc1-03'] > 0);
    });

    await tc(acctOn ? 'R6b' : 'R6', 'Làm bài bằng phím 1–4 + Enter; thanh trên hiện chuỗi ngày và XP' + tag, async () => {
      await p.goto(BASE + '#/bai/sc1-00/lam-bai');
      await p.reload();
      await p.click('.mode[data-mode="quick"]');
      await finishQuiz(p, 0, true);
      const st = await p.textContent('#stats');
      const s = await store(p);
      assert.ok(st.includes('🔥 1') && st.includes('⭐ ' + s.xp), st);
    });

    await tc(acctOn ? 'R9b' : 'R9', 'Không lỗi console; chưa đăng nhập thì không gọi dữ liệu lên server' + tag, async () => {
      assert.deepStrictEqual(d.errors, []);
      assert.ok(!d.net.some((u) => /rest\/v1/.test(u)), 'gọi REST khi chưa đăng nhập');
    });
    await d.ctx.close();
  }

  await tc('R7', 'Dữ liệu cũ trong máy (trước khi có tài khoản: không có ts, wrongDel, writingAt) vẫn chạy', async () => {
    const d = await device(browser, false);
    await d.page.goto(BASE);
    await d.page.evaluate(() => {
      // cùng cách tính mã câu như app.js (qid)
      const it = { lid: 'sc1-01', kind: 'vocab', q: 'Nghĩa của 학생 là gì?', options: ['học sinh', 'giáo viên', 'bác sĩ', 'ca sĩ'], answer: 'học sinh', explain: '학생 = học sinh' };
      const str = it.lid + '|' + it.kind + '||' + it.q + '|' + it.answer;
      let h = 5381;
      for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
      window.__qid = h.toString(36);
      localStorage.setItem('hanadul:v2', JSON.stringify({
      lessons: { 'sc1-01': { best: 80, stars: 2, last: '2026-11-20' } }, xp: 90, days: ['2026-11-20'], last: 'sc1-01',
      wrong: { [window.__qid]: { item: it, n: 1, ok: 0, t: '2026-11-20' } },
      writing: { 'sc1-01': '안녕하세요' }
    }));
    });
    const qidv = await d.page.evaluate(() => window.__qid);
    await d.page.reload();
    await d.page.waitForSelector('.continue.book');
    assert.ok((await d.page.textContent('#stats')).includes('⭐ 90'));
    await d.page.goto(BASE + '#/so-cau-sai');
    await d.page.click('#startReview');
    await finishQuiz(d.page, 0);
    const s = await store(d.page);
    assert.strictEqual(s.wrong[qidv].ok, 1);
    await d.page.goto(BASE + '#/bai/sc1-01');
    assert.strictEqual(await d.page.inputValue('#wtext'), '안녕하세요');
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('R5', 'Trang giới thiệu + Quyền riêng tư: tải không lỗi; câu hỏi "lưu ở đâu" đổi theo config', async () => {
    for (const on of [false, true]) {
      const d = await device(browser, on);
      await d.page.goto(BASE + 'gioi-thieu.html');
      await d.page.waitForSelector('h1');
      const offVisible = await d.page.locator('[data-acct="off"]').evaluate((e) => !e.hidden);
      const onVisible = await d.page.locator('[data-acct="on"]').evaluate((e) => !e.hidden);
      assert.strictEqual(offVisible, !on);
      assert.strictEqual(onVisible, on);
      await d.page.goto(BASE + 'chinh-sach-bao-mat.html');
      await d.page.waitForSelector('text=Tài khoản (không bắt buộc)');
      const over = await d.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0);
      assert.deepStrictEqual(d.errors, []);
      await d.ctx.close();
    }
  });

  await tc('R8', 'Điện thoại 360px: trang chủ, trang học, làm bài không tràn ngang (config bật)', async () => {
    const d = await device(browser, true, { width: 360, height: 760 });
    for (const h of ['#/', '#/bai/sc1-02', '#/bai/sc1-02/lam-bai', '#/so-cau-sai', '#/tai-khoan']) {
      await d.page.goto(BASE + h);
      await d.page.reload();
      await d.page.waitForTimeout(500);
      const over = await d.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, h + ' tràn ' + over);
    }
    await d.ctx.close();
  });

  await browser.close();
  console.log('\n' + results.filter((r) => r[2] === 'PASS').length + '/' + results.length + ' PASS');
  if (process.env.SHOTS) fs.writeFileSync(process.env.SHOTS + '/e2e_regression.json', JSON.stringify(results, null, 1));
})();
