// Test chuyển tên miền hanadul-vn.github.io → hanadul.app (assets/move.js).
// Không cần máy chủ: Playwright giả lập cả 2 tên miền bằng file trong repo.
// Chạy: node tests/e2e_move.js   (ONLY=M01,M03 để chạy riêng case)
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OLD = 'https://hanadul-vn.github.io';
const NEW = 'https://hanadul.app';
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.xml': 'application/xml' };
const results = [];
async function tc(id, name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) return;
  try { await fn(); results.push([id, name, 'PASS']); console.log('PASS', id, name); }
  catch (e) { results.push([id, name, 'FAIL: ' + e.message.split('\n')[0]]); console.log('FAIL', id, name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n   ')); process.exitCode = 1; }
}

function serveFile(urlStr) {
  const u = new URL(urlStr);
  let p = decodeURIComponent(u.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    return { status: 404, contentType: TYPES['.html'], body: fs.readFileSync(path.join(ROOT, '404.html')) };
  }
  let body = fs.readFileSync(f);
  if (p === '/assets/config.js') body = String(body).replace(/supabaseUrl: '[^']*'/, "supabaseUrl: ''").replace(/supabaseKey: '[^']*'/, "supabaseKey: ''");
  return { status: 200, contentType: TYPES[path.extname(f)] || 'application/octet-stream', body };
}

// newUp=false: hanadul.app chưa chạy (lỗi mạng).
async function device(browser, { newUp = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await require('./stub_third_party')(ctx);
  await ctx.route(/^https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com|.*supabase\.co)\//, (r) => r.abort());
  await ctx.route(OLD + '/**', (r) => r.fulfill(serveFile(r.request().url())));
  await ctx.route(NEW + '/**', (r) => (newUp ? r.fulfill(serveFile(r.request().url())) : r.abort('connectionrefused')));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_|net::/.test(m.text())) page.errors.push('console: ' + m.text()); });
  return { ctx, page };
}
// Ghi localStorage cho 1 tên miền (mở robots.txt của tên miền đó, không chạy move.js).
async function seed(page, origin, data) {
  await page.goto(origin + '/robots.txt');
  await page.evaluate((d) => { localStorage.clear(); Object.entries(d).forEach(([k, v]) => localStorage.setItem(k, v)); }, data);
}
async function dump(page, origin) {
  await page.goto(origin + '/robots.txt');
  return page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
}
async function waitNew(page) {
  await page.waitForURL((u) => u.origin === NEW, { timeout: 8000 });
  await page.waitForLoadState('load');
}

const today = new Date().toISOString().slice(0, 10);
const PROGRESS = {
  lessons: { 'sc1-01': { best: 95, stars: 3, plays: 2, last: today }, 'sc2-03': { best: 70, stars: 2, plays: 1, last: today } },
  xp: 321, days: [today], last: 'sc2-03', lastAt: Date.now(),
  wrong: { 'sc2-03|q1': { lid: 'sc2-03', q: 'Câu “có dấu” 한국어', n: 1, ts: Date.now() } },
  writing: { 'sc2-03': 'Tôi học tiếng Hàn 매일 공부해요 ✍️' }, writingAt: { 'sc2-03': Date.now() }
};

(async () => {
  const browser = await chromium.launch();

  await tc('M01', 'Khách có tiến độ mở địa chỉ cũ #/bai/sc1-01: sang hanadul.app cùng trang, tiến độ + đăng ký email sang đủ, phiên đăng nhập không sang, thanh địa chỉ sạch', async () => {
    const { ctx, page } = await device(browser);
    await seed(page, OLD, { 'hanadul:v2': JSON.stringify(PROGRESS), 'hanadul:signup': 'done', 'hanadul:auth': '{"token":"bí mật"}', 'khac:x': '1' });
    await page.goto(OLD + '/#/bai/sc1-01');
    await waitNew(page);
    await page.waitForSelector('.lesson-hero');
    assert.strictEqual(page.url(), NEW + '/#/bai/sc1-01');
    const ls = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));
    assert.deepStrictEqual(JSON.parse(ls['hanadul:v2']).writing, PROGRESS.writing);
    assert.strictEqual(JSON.parse(ls['hanadul:v2']).xp, 321);
    assert.strictEqual(ls['hanadul:signup'], 'done');
    assert.ok(!('hanadul:auth' in ls), 'phiên đăng nhập bị mang sang');
    assert.ok(!('khac:x' in ls), 'khóa không phải hanadul bị mang sang');
    assert.ok((await page.textContent('#stats')).includes('321'), 'thanh thành tích không hiện 321 XP');
    assert.ok(!(await page.evaluate(() => location.href)).includes('hd-move'));
    assert.deepStrictEqual(page.errors, []);
    const old = await dump(page, OLD);
    assert.ok(old['hanadul:moved'], 'địa chỉ cũ chưa đánh dấu đã chuyển');
    assert.ok(old['hanadul:v2'], 'địa chỉ cũ phải giữ bản sao lưu');
    await ctx.close();
  });

  await tc('M02', 'Khách mới (không có dữ liệu) mở địa chỉ cũ: sang hanadul.app đúng trang, không có hd-move, không tạo dữ liệu thừa', async () => {
    const { ctx, page } = await device(browser);
    await page.goto(OLD + '/');
    await waitNew(page);
    await page.waitForSelector('.hero');
    assert.strictEqual(page.url(), NEW + '/');
    await page.goto(OLD + '/#/bai/sc2-01');
    await waitNew(page);
    assert.strictEqual(page.url(), NEW + '/#/bai/sc2-01');
    const old = await dump(page, OLD);
    assert.ok(!old['hanadul:moved'], 'không có dữ liệu thì không cần đánh dấu');
    await ctx.close();
  });

  await tc('M03', 'Quay lại địa chỉ cũ lần 2 (bookmark): vẫn chuyển sang nhưng không gửi lại dữ liệu, XP không bị cộng đôi', async () => {
    const { ctx, page } = await device(browser);
    await seed(page, OLD, { 'hanadul:v2': JSON.stringify(PROGRESS) });
    await page.goto(OLD + '/'); await waitNew(page);
    await page.goto(OLD + '/#/'); await waitNew(page);
    assert.strictEqual(page.url(), NEW + '/#/');
    const ls = await dump(page, NEW);
    assert.strictEqual(JSON.parse(ls['hanadul:v2']).xp, 321);
    await ctx.close();
  });

  await tc('M04', 'hanadul.app đã có tiến độ khác: gộp hai bên (bài của cả hai, XP cộng, câu tự viết đủ), giữ chủ tài khoản ở bên mới', async () => {
    const { ctx, page } = await device(browser);
    const here = { lessons: { 'tc3-01': { best: 80, stars: 2, plays: 1, last: today } }, xp: 50, days: [today], last: 'tc3-01', lastAt: 1, wrong: {}, writing: { 'tc3-01': '새 집' }, writingAt: { 'tc3-01': 1 }, owner: 'user-new', xpSynced: 50 };
    await seed(page, NEW, { 'hanadul:v2': JSON.stringify(here), 'hanadul:signup': 'cu' });
    await seed(page, OLD, { 'hanadul:v2': JSON.stringify(PROGRESS), 'hanadul:signup': 'done' });
    await page.goto(OLD + '/'); await waitNew(page);
    const ls = await dump(page, NEW);
    const s = JSON.parse(ls['hanadul:v2']);
    assert.deepStrictEqual(Object.keys(s.lessons).sort(), ['sc1-01', 'sc2-03', 'tc3-01']);
    assert.strictEqual(s.xp, 371);
    assert.deepStrictEqual(Object.keys(s.writing).sort(), ['sc2-03', 'tc3-01']);
    assert.strictEqual(s.owner, 'user-new');
    assert.strictEqual(s.xpSynced, 50);
    assert.strictEqual(ls['hanadul:signup'], 'cu', 'khóa khác đã có ở bên mới thì giữ nguyên');
    await ctx.close();
  });

  await tc('M05', 'Link giả mạo mở thẳng hanadul.app/#hd-move=… (không đi từ địa chỉ cũ): không nhận dữ liệu, xóa phần # lạ, về đúng trang', async () => {
    const { ctx, page } = await device(browser);
    const evil = Buffer.from(JSON.stringify({ 'hanadul:v2': JSON.stringify({ xp: 999999 }) })).toString('base64url');
    await page.goto(NEW + '/#hd-move=' + evil + '&h=' + encodeURIComponent('#/bai/sc1-02'));
    await page.waitForSelector('.lesson-hero');
    assert.strictEqual(page.url(), NEW + '/#/bai/sc1-02');
    const v = await page.evaluate(() => localStorage.getItem('hanadul:v2'));
    assert.ok(!v || JSON.parse(v).xp !== 999999, 'đã nhận dữ liệu giả');
    await ctx.close();
  });

  await tc('M06', 'hanadul.app chưa chạy (lỗi mạng): ở lại địa chỉ cũ, trang hiện bình thường, học được, không đánh dấu đã chuyển', async () => {
    const { ctx, page } = await device(browser, { newUp: false });
    await seed(page, OLD, { 'hanadul:v2': JSON.stringify(PROGRESS) });
    await page.goto(OLD + '/#/');
    await page.waitForSelector('.hero');
    await page.waitForTimeout(800);
    assert.strictEqual(new URL(page.url()).origin, OLD);
    assert.strictEqual(await page.evaluate(() => getComputedStyle(document.documentElement).visibility), 'visible');
    assert.ok((await page.textContent('#stats')).includes('321'));
    assert.ok(!(await page.evaluate(() => localStorage.getItem('hanadul:moved'))));
    assert.deepStrictEqual(page.errors, []);
    await ctx.close();
  });

  await tc('M07', 'Dữ liệu chuyển nhà không lọt vào Google Analytics (dataLayer không chứa hd-move)', async () => {
    const { ctx, page } = await device(browser);
    await seed(page, OLD, { 'hanadul:v2': JSON.stringify(PROGRESS) });
    await page.goto(OLD + '/gioi-thieu.html'); await waitNew(page);
    assert.strictEqual(page.url(), NEW + '/gioi-thieu.html');
    const dl = await page.evaluate(() => JSON.stringify((window.dataLayer || []).map((a) => Array.from(a))) + location.href);
    assert.ok(dl.includes('config'), 'GA chưa khởi tạo');
    assert.ok(!dl.includes('hd-move'), 'hd-move lọt vào GA');
    await ctx.close();
  });

  await tc('M08', 'Trang con và trang 404 ở địa chỉ cũ: sang đúng đường dẫn trên hanadul.app, mang theo tiến độ', async () => {
    const { ctx, page } = await device(browser);
    await seed(page, OLD, { 'hanadul:v2': JSON.stringify(PROGRESS) });
    await page.goto(OLD + '/bai-cu-khong-con'); await waitNew(page);
    assert.ok(page.url().startsWith(NEW + '/bai-cu-khong-con'), page.url());
    const ls = await dump(page, NEW);
    assert.strictEqual(JSON.parse(ls['hanadul:v2']).xp, 321);
    await page.goto(OLD + '/chinh-sach-bao-mat.html'); await waitNew(page);
    assert.strictEqual(page.url(), NEW + '/chinh-sach-bao-mat.html');
    await ctx.close();
  });

  await tc('M09', 'Tiến độ lớn (~400 KB câu tự viết) vẫn chuyển nguyên vẹn', async () => {
    const { ctx, page } = await device(browser);
    const big = Object.assign({}, PROGRESS, { writing: {}, writingAt: {} });
    for (let i = 0; i < 400; i++) { big.writing['b' + i] = ('한국어 공부 tiếng Hàn ' + i + ' ').repeat(40); big.writingAt['b' + i] = i; }
    const raw = JSON.stringify(big);
    await seed(page, OLD, { 'hanadul:v2': raw });
    await page.goto(OLD + '/'); await waitNew(page);
    const ls = await dump(page, NEW);
    assert.deepStrictEqual(JSON.parse(ls['hanadul:v2']).writing, big.writing);
    await ctx.close();
    return raw.length;
  });

  await tc('M10', 'Trang Quyền riêng tư: ghi Brevo, team@hanadul.app (mailto), mục Liên hệ, ngày cập nhật 23/11/2026, đánh số mục 1–8 liên tục', async () => {
    const { ctx, page } = await device(browser);
    await page.goto(NEW + '/chinh-sach-bao-mat.html');
    const t = await page.textContent('main');
    assert.ok(/Brevo/.test(t) && /team@hanadul\.app/.test(t) && /23\/11\/2026/.test(t));
    assert.ok(await page.$('a[href="mailto:team@hanadul.app"]'));
    const h2 = await page.$$eval('main h2', (a) => a.map((e) => parseInt(e.textContent, 10)));
    assert.deepStrictEqual(h2, [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.ok((await page.getAttribute('link[rel=canonical]', 'href')) === NEW + '/chinh-sach-bao-mat.html');
    await ctx.close();
  });

  await tc('M11', 'Địa chỉ chuẩn: canonical/og:url/sitemap/robots dùng hanadul.app, không còn hanadul-vn.github.io (trừ link Góp ý GitHub)', async () => {
    for (const f of ['index.html', 'gioi-thieu.html', 'chinh-sach-bao-mat.html', 'chung-nhan.html', 'sitemap.xml', 'robots.txt']) {
      const s = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/github\.com\/hanadul-vn\/hanadul-vn\.github\.io/g, '').replace('địa chỉ cũ <b>hanadul-vn.github.io</b>', '');
      assert.ok(!s.includes('hanadul-vn.github.io'), f + ' còn địa chỉ cũ');
    }
    assert.ok(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').includes('<link rel="canonical" href="https://hanadul.app/">'));
    assert.ok(!fs.existsSync(path.join(ROOT, 'CNAME')), 'không được có file CNAME (GitHub sẽ chuyển hướng ở máy chủ, mất tiến độ)');
  });

  await tc('M12', 'Trang xác minh chứng nhận ở địa chỉ cũ (?ma=…): sang hanadul.app giữ mã; bài thi thử đang làm dở và kết quả thi thử sang đủ', async () => {
    const { ctx, page } = await device(browser);
    const run = JSON.stringify({ id: 'doc-01', startedAt: Date.now(), deadline: Date.now() + 3600e3, answers: { 1: 2, 7: 0 } });
    const prog = Object.assign({}, PROGRESS, { exams: { 'doc-01': { best: 60, last: { score: 60, at: Date.now() } } } });
    await seed(page, OLD, { 'hanadul:v2': JSON.stringify(prog), 'hanadul:exam-run': run });
    await page.goto(OLD + '/chung-nhan.html?ma=HD-ABCD-1234'); await waitNew(page);
    assert.strictEqual(page.url(), NEW + '/chung-nhan.html?ma=HD-ABCD-1234');
    const ls = await dump(page, NEW);
    assert.strictEqual(ls['hanadul:exam-run'], run);
    assert.deepStrictEqual(JSON.parse(ls['hanadul:v2']).exams, prog.exams);
    await ctx.close();
  });

  await browser.close();
  console.log('\n' + results.filter((r) => r[2] === 'PASS').length + '/' + results.length + ' PASS');
})();
