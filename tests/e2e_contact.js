// Test GA4 + form Formspree (đăng ký nhận bài mới, cảm nhận) với cấu hình thật trong assets/config.js.
// Dịch vụ ngoài được giả lập: không gửi số liệu/email thật.
// Chạy: python3 -m http.server 8765 (ở thư mục gốc repo), rồi node tests/e2e_contact.js
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');

const BASE = process.env.BASE || 'http://localhost:8765/';
const GA = 'G-KV20QCEH0G';
const FORM = 'https://formspree.io/f/mljbpgrp';
const results = [];
async function tc(id, name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) return;
  try { await fn(); results.push([id, name, 'PASS']); console.log('PASS', id, name); }
  catch (e) { results.push([id, name, 'FAIL: ' + e.message.split('\n')[0]]); console.log('FAIL', id, name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n   ')); process.exitCode = 1; }
}

// opts: formStatus (mã trả về của Formspree giả), blockGA (giả lập trình chặn quảng cáo), viewport, dark
async function device(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 900 }, colorScheme: opts.dark ? 'dark' : 'light' });
  const posts = [];
  const gaScripts = [];
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await ctx.route(/googletagmanager\.com\//, (r) => {
    gaScripts.push(r.request().url());
    if (opts.blockGA) return r.abort('blockedbyclient');
    r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* gtag giả */' });
  });
  await ctx.route(/formspree\.io\//, (r) => {
    const req = r.request();
    posts.push({ url: req.url(), method: req.method(), body: req.postData() || '' });
    const st = opts.formStatus || 200;
    r.fulfill({ status: st, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: st === 200 ? '{"ok":true}' : '{"error":"x"}' });
  });
  // Lộ đáp án đúng cho script làm bài (giống tests/e2e_regression.js).
  await ctx.route('**/assets/app.js', async (route) => {
    const r = await route.fetch();
    route.fulfill({ response: r, body: (await r.text()).replace('\n      state = null;\n', '\n      state = null; window.__curIdx = q.options.indexOf(q.answer);\n') });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (opts.blockGA && /ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(m.text())) return; // lỗi tải GA do trình chặn: chấp nhận
    if (opts.formStatus && opts.formStatus >= 400 && /Failed to load resource/.test(m.text())) return; // 500 giả lập
    errors.push(m.text());
  });
  return { ctx, page, errors, posts, gaScripts };
}
const events = (page) => page.evaluate(() => (window.dataLayer || []).filter((a) => a[0] === 'event').map((a) => Object.assign({ name: a[1] }, a[2])));
const field = (body, name) => { const m = body.match(new RegExp('name="' + name + '"\\r\\n\\r\\n([^\\r]*)')); return m ? m[1] : null; };

async function finishQuiz(page) {
  for (let i = 0; i < 400; i++) {
    await page.waitForSelector('.opt, .result-grid');
    if (await page.locator('.result-grid').count()) return;
    const idx = await page.evaluate(() => window.__curIdx);
    await page.click('.opt[data-o="' + idx + '"]');
    await page.click('#next');
  }
  throw new Error('không làm xong bài');
}

(async () => {
  const browser = await chromium.launch();

  await tc('C1', 'GA4: cả 3 trang tải gtag với đúng mã ' + GA + ' và gọi config', async () => {
    const d = await device(browser);
    for (const [path, spa] of [['', true], ['gioi-thieu.html', false], ['chinh-sach-bao-mat.html', false]]) {
      d.gaScripts.length = 0;
      await d.page.goto(BASE + path);
      await d.page.waitForTimeout(500);
      assert.ok(d.gaScripts.some((u) => u.includes('id=' + GA)), path + ': không tải gtag');
      const cfg = await d.page.evaluate(() => (window.dataLayer || []).filter((a) => a[0] === 'config').map((a) => [a[1], a[2]]));
      assert.strictEqual(cfg.length, 1, path);
      assert.strictEqual(cfg[0][0], GA);
      assert.strictEqual(cfg[0][1].send_page_view, !spa, path + ': send_page_view');
    }
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('C2', 'Trang học: mỗi màn ghi đúng 1 page_view với đường dẫn riêng (/ , /bai/sc1-01, /bai/sc1-01/lam-bai)', async () => {
    const d = await device(browser);
    await d.page.goto(BASE + '#/');
    await d.page.waitForSelector('.path');
    await d.page.waitForTimeout(600);
    await d.page.goto(BASE + '#/bai/sc1-01');
    await d.page.waitForSelector('.wcard');
    await d.page.waitForTimeout(600);
    await d.page.goto(BASE + '#/bai/sc1-01/lam-bai');
    await d.page.waitForSelector('.mode');
    await d.page.waitForTimeout(600);
    const pv = (await events(d.page)).filter((e) => e.name === 'page_view').map((e) => e.page_path);
    assert.deepStrictEqual(pv, ['/', '/bai/sc1-01', '/bai/sc1-01/lam-bai']);
    const last = (await events(d.page)).filter((e) => e.name === 'page_view').pop();
    assert.ok(/Làm bài/.test(last.page_title), 'page_title: ' + last.page_title);
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('C3', 'Làm bài: ghi quiz_start (mode) và quiz_complete (lesson_id, score=100, mode)', async () => {
    const d = await device(browser);
    await d.page.goto(BASE + '#/bai/sc1-02/lam-bai');
    await d.page.click('.mode[data-mode=quick]');
    await finishQuiz(d.page);
    const ev = await events(d.page);
    const st = ev.find((e) => e.name === 'quiz_start');
    const done = ev.find((e) => e.name === 'quiz_complete');
    assert.deepStrictEqual([st.lesson_id, st.mode], ['sc1-02', 'quick']);
    assert.deepStrictEqual([done.lesson_id, done.mode, done.score], ['sc1-02', 'quick', 100]);
    assert.ok(done.questions > 0);
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('C4', 'Trang giới thiệu: hiện khối đăng ký, form email, form cảm nhận, nút "Nhận báo bài mới"; ẩn nút Zalo/Facebook (chưa có link)', async () => {
    const d = await device(browser);
    await d.page.goto(BASE + 'gioi-thieu.html');
    await d.page.waitForTimeout(400);
    assert.ok(await d.page.isVisible('#dang-ky'));
    assert.ok(await d.page.isVisible('#dang-ky .signup-form'));
    assert.ok(await d.page.isVisible('.feedback-form'));
    assert.ok(await d.page.isVisible('.hero-actions a[href="#dang-ky"]'));
    assert.ok(await d.page.isHidden('#dang-ky [data-channel=zalo]'));
    assert.ok(await d.page.isHidden('#dang-ky [data-channel=facebook]'));
    // Ô bẫy bot: người thật không thấy (đẩy ra ngoài màn hình, trong suốt), không tab tới được.
    const hp = await d.page.$eval('#dang-ky .hp', (el) => { const r = el.getBoundingClientRect(); return { right: r.right, op: getComputedStyle(el).opacity, tab: el.tabIndex }; });
    assert.ok(hp.right <= 0 && hp.op === '0' && hp.tab === -1, 'ô bẫy bot lộ ra: ' + JSON.stringify(hp));
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('C5', 'Đăng ký: email sai/để trống báo lỗi, không gửi gì đi', async () => {
    const d = await device(browser);
    await d.page.goto(BASE + 'gioi-thieu.html');
    for (const v of ['', 'abc', 'a@b', 'a b@c.com']) {
      await d.page.fill('#em-landing', v);
      await d.page.click('#dang-ky button[type=submit]');
      assert.strictEqual(await d.page.textContent('#dang-ky .form-msg'), 'Email chưa đúng, bạn kiểm tra lại nhé.', v);
    }
    assert.strictEqual(d.posts.length, 0);
    await d.ctx.close();
  });

  await tc('C6', 'Đăng ký hợp lệ: POST đúng endpoint Formspree, đủ trường; báo thành công; ghi sign_up; trang chủ ẩn thẻ đăng ký sau đó', async () => {
    const d = await device(browser);
    await d.page.goto(BASE + 'gioi-thieu.html');
    await d.page.fill('#em-landing', '  hoc.vien@example.com ');
    await d.page.click('#dang-ky button[type=submit]');
    await d.page.waitForSelector('#dang-ky .form-done');
    assert.strictEqual(d.posts.length, 1);
    const p = d.posts[0];
    assert.strictEqual(p.url, FORM);
    assert.strictEqual(p.method, 'POST');
    assert.strictEqual(field(p.body, 'email'), 'hoc.vien@example.com');
    assert.strictEqual(field(p.body, 'kind'), 'dang-ky');
    assert.strictEqual(field(p.body, 'source'), 'landing');
    assert.strictEqual(field(p.body, '_subject'), 'Hana Dul: đăng ký nhận bài mới');
    const su = (await events(d.page)).find((e) => e.name === 'sign_up');
    assert.deepStrictEqual([su.method, su.source], ['email', 'landing']);
    assert.strictEqual(await d.page.evaluate(() => localStorage.getItem('hanadul:signup')), '1');
    await d.page.goto(BASE + '#/');
    await d.page.waitForSelector('.path');
    assert.strictEqual(await d.page.locator('.signup-card').count(), 0);
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('C7', 'Chống bot: ô bẫy bị điền thì không gửi', async () => {
    const d = await device(browser);
    await d.page.goto(BASE + 'gioi-thieu.html');
    await d.page.fill('#em-landing', 'bot@example.com');
    await d.page.evaluate(() => { document.querySelector('#dang-ky .hp').value = 'spam'; });
    await d.page.click('#dang-ky button[type=submit]');
    await d.page.waitForTimeout(300);
    assert.strictEqual(d.posts.length, 0);
    await d.ctx.close();
  });

  await tc('C8', 'Cảm nhận: dưới 10 ký tự báo lỗi; hợp lệ thì gửi message/name/email/publish, báo cảm ơn, ghi feedback_sent', async () => {
    const d = await device(browser);
    await d.page.goto(BASE + 'gioi-thieu.html');
    await d.page.fill('.feedback-form textarea', 'ngắn');
    await d.page.click('.feedback-form button[type=submit]');
    assert.ok((await d.page.textContent('.feedback-form .form-msg')).includes('ít nhất 10 ký tự'));
    assert.strictEqual(d.posts.length, 0);
    await d.page.fill('.feedback-form [name=name]', 'Lan');
    await d.page.fill('.feedback-form [name=email]', 'lan@example.com');
    await d.page.fill('.feedback-form textarea', 'Bài học dễ hiểu, phần nghe rất hay.');
    await d.page.check('.feedback-form [name=publish]');
    await d.page.click('.feedback-form button[type=submit]');
    await d.page.waitForSelector('.feedback-form .form-done');
    const b = d.posts[0].body;
    assert.strictEqual(d.posts[0].url, FORM);
    assert.deepStrictEqual([field(b, 'kind'), field(b, 'name'), field(b, 'email'), field(b, 'publish'), field(b, 'message')],
      ['cam-nhan', 'Lan', 'lan@example.com', 'có', 'Bài học dễ hiểu, phần nghe rất hay.']);
    assert.ok((await events(d.page)).some((e) => e.name === 'feedback_sent' && e.publish === 'có'));
    assert.strictEqual(await d.page.evaluate(() => localStorage.getItem('hanadul:signup')), null, 'gửi cảm nhận không được tính là đăng ký');
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('C9', 'Formspree lỗi 500: báo "chưa gửi được", nút bấm lại được, không đánh dấu đã đăng ký, không ghi sign_up', async () => {
    const d = await device(browser, { formStatus: 500 });
    await d.page.goto(BASE + 'gioi-thieu.html');
    await d.page.fill('#em-landing', 'a@example.com');
    await d.page.click('#dang-ky button[type=submit]');
    await d.page.waitForFunction(() => /Chưa gửi được/.test(document.querySelector('#dang-ky .form-msg').textContent));
    assert.ok(await d.page.isEnabled('#dang-ky button[type=submit]'));
    assert.strictEqual(await d.page.evaluate(() => localStorage.getItem('hanadul:signup')), null);
    assert.ok(!(await events(d.page)).some((e) => e.name === 'sign_up'));
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('C10', 'Trang học: thẻ đăng ký ở trang chủ và màn kết quả; gửi từ trang chủ ghi source=trang-chu', async () => {
    const d = await device(browser);
    await d.page.goto(BASE + '#/bai/sc1-03/lam-bai');
    await d.page.click('.mode[data-mode=quick]');
    await finishQuiz(d.page);
    assert.strictEqual(await d.page.locator('.signup-card.compact form[data-source=ket-qua]').count(), 1);
    await d.page.goto(BASE + '#/');
    await d.page.waitForSelector('.signup-card form[data-source=trang-chu]');
    await d.page.fill('#em-trang-chu', 'b@example.com');
    await d.page.click('.signup-card button[type=submit]');
    await d.page.waitForSelector('.signup-card .form-done');
    assert.strictEqual(field(d.posts[0].body, 'source'), 'trang-chu');
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('C11', 'Người dùng chặn GA (adblock): trang chủ, học, làm bài, form vẫn chạy, không lỗi JS', async () => {
    const d = await device(browser, { blockGA: true });
    await d.page.goto(BASE + '#/');
    await d.page.waitForSelector('.path');
    await d.page.goto(BASE + '#/bai/sc1-01/lam-bai');
    await d.page.click('.mode[data-mode=quick]');
    await finishQuiz(d.page);
    await d.page.goto(BASE + 'gioi-thieu.html');
    await d.page.fill('#em-landing', 'c@example.com');
    await d.page.click('#dang-ky button[type=submit]');
    await d.page.waitForSelector('#dang-ky .form-done');
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('C12', 'Điện thoại 375px (sáng + tối): trang giới thiệu và trang chủ có form mà không tràn ngang', async () => {
    for (const dark of [false, true]) {
      const d = await device(browser, { viewport: { width: 375, height: 760 }, dark });
      for (const url of ['gioi-thieu.html', '#/']) {
        await d.page.goto(BASE + url);
        await d.page.waitForTimeout(500);
        assert.ok(await d.page.locator('.signup-form').first().isVisible(), url);
        assert.ok(!(await d.page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), url + ' tràn ngang');
      }
      if (process.env.SHOTS) await d.page.screenshot({ path: process.env.SHOTS + '/contact-home-' + (dark ? 'toi' : 'sang') + '.png', fullPage: true });
      assert.deepStrictEqual(d.errors, []);
      await d.ctx.close();
    }
  });

  await tc('C13', 'Quyền riêng tư nêu rõ dùng Google Analytics và Formspree', async () => {
    const d = await device(browser);
    await d.page.goto(BASE + 'chinh-sach-bao-mat.html');
    const t = await d.page.textContent('main');
    assert.ok(t.includes('Hana Dul dùng Google Analytics'));
    assert.ok(t.includes('Formspree'));
    await d.ctx.close();
  });

  await browser.close();
  const pass = results.filter((r) => r[2] === 'PASS').length;
  console.log('\n' + pass + '/' + results.length + ' PASS');
})();
