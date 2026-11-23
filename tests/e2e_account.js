// Test giao diện tài khoản + đồng bộ, chạy thư viện Supabase thật trên một "server Supabase giả" (Playwright route).
// Chạy: python3 -m http.server 8765 (ở thư mục gốc repo), rồi node tests/e2e_account.js
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');

const BASE = process.env.BASE || 'http://localhost:8765/';
const SB = 'https://test-hanadul.supabase.co';
const PUB_KEY = 'sb_publishable_test_123';

// ---------- server Supabase giả ----------
const srv = {
  users: {},      // id -> user
  rows: {},       // user_id -> {data, version}
  failNext: 0,    // số request REST tiếp theo trả 500
  bumpBeforePatch: 0, // giả lập máy khác ghi chen giữa lúc đọc và ghi
  calls: [],
  profiles: {},   // user_id -> display_name
  profileFail: 0  // số lần đọc profiles tiếp theo trả 500
};
function mkUser(id, email, provider, name) {
  srv.users[id] = { id, email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider }, user_metadata: name ? { full_name: name } : {}, created_at: '2026-11-21T00:00:00Z' };
  return srv.users[id];
}
function session(u) {
  return { access_token: 'tok-' + u.id, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'ref-' + u.id, user: u };
}
const UA = '11111111-1111-4111-8111-111111111111';
const UB = '22222222-2222-4222-8222-222222222222';

async function handle(route) {
  const req = route.request();
  const u = new URL(req.url());
  const p = u.pathname;
  const method = req.method();
  const auth = (req.headers()['authorization'] || '').replace(/^Bearer /, '');
  const me = auth.startsWith('tok-') ? srv.users[auth.slice(4)] : null;
  const json = (status, body, headers) => route.fulfill({ status, contentType: 'application/json', headers: Object.assign({ 'access-control-allow-origin': '*' }, headers || {}), body: body === undefined ? '' : JSON.stringify(body) });
  srv.calls.push(method + ' ' + p + u.search);
  if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });

  if (p === '/auth/v1/otp') return json(200, {});
  if (p === '/auth/v1/verify') {
    const b = JSON.parse(req.postData() || '{}');
    if (b.token !== '123456') return json(403, { code: 403, error_code: 'otp_expired', msg: 'Token has expired or is invalid' });
    const u2 = srv.users[UA] || mkUser(UA, b.email, 'email');
    return json(200, session(u2));
  }
  if (p === '/auth/v1/authorize') {
    const to = u.searchParams.get('redirect_to');
    const loc = u.searchParams.get('test_error') ? to + '?error=access_denied&error_description=Ban+da+huy' : to + '?code=gcode';
    return route.fulfill({ status: 302, headers: { location: loc } });
  }
  if (p === '/auth/v1/token') {
    const gt = u.searchParams.get('grant_type');
    if (gt === 'pkce') return json(200, session(srv.users[srv.googleAs || UA] || mkUser(UA, 'a@x.vn', 'google', 'An Nguyen')));
    if (gt === 'refresh_token') { const id = JSON.parse(req.postData()).refresh_token.slice(4); return json(200, session(srv.users[id])); }
  }
  if (p === '/auth/v1/user') return me ? json(200, me) : json(401, { msg: 'no' });
  if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });

  if (p.startsWith('/rest/v1/')) {
    if (srv.failNext > 0) { srv.failNext--; return json(500, { message: 'server down' }); }
    if (!me) return json(401, { message: 'JWT required' });
    if (p === '/rest/v1/profiles') {
      if (method === 'GET' && srv.profileFail > 0) { srv.profileFail--; return json(500, { message: 'profiles down' }); }
      const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
      if (method === 'GET') {
        const eq = (u.searchParams.get('user_id') || '').replace(/^eq\./, '');
        const rows = eq === me.id && srv.profiles[me.id] ? [{ display_name: srv.profiles[me.id] }] : [];
        if (single) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', message: '0 rows' });
        return json(200, rows);
      }
      if (method === 'POST') {
        const b = JSON.parse(req.postData()); const row = Array.isArray(b) ? b[0] : b;
        if (row.user_id !== me.id) return json(403, { code: '42501', message: 'RLS' });
        const n = String(row.display_name || '');
        if (n.trim().length < 2 || n.trim().length > 40 || /[<>{}\\]/.test(n)) return json(400, { code: '23514', message: 'new row violates check constraint "profiles_name_len"' });
        srv.profiles[me.id] = n;
        return json(201, [{ display_name: n }]);
      }
    }
    if (p === '/rest/v1/rpc/delete_my_account') {
      delete srv.rows[me.id]; delete srv.users[me.id]; delete srv.profiles[me.id];
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    }
    if (p !== '/rest/v1/progress') return json(404, {});
    const eqUser = (u.searchParams.get('user_id') || '').replace(/^eq\./, '');
    const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] || '');
    if (method === 'GET') {
      // RLS: chỉ thấy dòng của mình
      const rows = eqUser === me.id && srv.rows[me.id] ? [Object.assign({}, srv.rows[me.id])] : [];
      if (single) return rows.length ? json(200, rows[0]) : json(406, { code: 'PGRST116', details: 'The result contains 0 rows', message: 'JSON object requested, multiple (or no) rows returned' });
      return json(200, rows);
    }
    if (method === 'POST') {
      const b = JSON.parse(req.postData());
      const row = Array.isArray(b) ? b[0] : b;
      if (row.user_id !== me.id) return json(403, { code: '42501', message: 'RLS' });
      if (srv.rows[me.id]) return json(409, { code: '23505', message: 'duplicate key' });
      srv.rows[me.id] = { data: row.data, version: row.version };
      return json(201, [{ version: row.version }]);
    }
    if (method === 'PATCH') {
      const b = JSON.parse(req.postData());
      const ver = Number((u.searchParams.get('version') || '').replace(/^eq\./, ''));
      if (srv.bumpBeforePatch > 0 && srv.rows[me.id]) {
        srv.bumpBeforePatch--;
        const r = srv.rows[me.id];
        r.data = Object.assign({}, r.data, { xp: (r.data.xp || 0) + 7 }); // máy khác vừa kiếm thêm 7 XP
        r.version++;
      }
      const r = srv.rows[me.id];
      if (eqUser !== me.id || !r || r.version !== ver) return json(200, []);
      r.data = b.data; r.version = b.version;
      return json(200, [{ version: r.version }]);
    }
  }
  return json(404, { message: 'not mocked ' + p });
}

// ---------- tiện ích ----------
const results = [];
async function tc(id, name, fn) {
  try { await fn(); results.push([id, name, 'PASS']); console.log('PASS', id, name); }
  catch (e) { results.push([id, name, 'FAIL: ' + e.message.split('\n')[0]]); console.log('FAIL', id, name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n   ')); process.exitCode = 1; }
}
async function newDevice(browser, opts) {
  opts = opts || {};
  const ctx = await browser.newContext({ viewport: opts.viewport || { width: 1100, height: 900 } });
  await require('./stub_third_party')(ctx);
  const errors = [];
  const sdkLoads = [];
  await ctx.route(SB + '/**', handle);
  await ctx.route('**/assets/config.js', async (route) => {
    const r = await route.fetch();
    let body = await r.text();
    // Config thật có thể đã điền khóa: test luôn tự đặt lại (bật = server giả, tắt = để trống).
    const on = opts.key !== undefined || opts.on;
    body = body.replace(/supabaseUrl: '[^']*'/, "supabaseUrl: '" + (on ? SB : '') + "'").replace(/supabaseKey: '[^']*'/, "supabaseKey: '" + (on ? opts.key || PUB_KEY : '') + "'");
    route.fulfill({ response: r, body });
  });
  // Chỉ trong test: lộ vị trí đáp án đúng để bot làm bài đúng/sai theo ý.
  await ctx.route('**/assets/app.js', async (route) => {
    const r = await route.fetch();
    const body = (await r.text()).replace('\n      state = null;\n', '\n      state = null; window.__curIdx = q.options.indexOf(q.answer);\n');
    route.fulfill({ response: r, body });
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('request', (r) => { if (/vendor\/supabase/.test(r.url())) sdkLoads.push(r.url()); });
  page.on('dialog', (d) => { errors.push('dialog: ' + d.message()); d.dismiss(); });
  return { ctx, page, errors, sdkLoads };
}
const store = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('hanadul:v2') || 'null'));
async function waitSynced(page) {
  await page.waitForFunction(() => { const d = document.querySelector('#acct .sync-dot'); return d && d.classList.contains('ok'); }, null, { timeout: 15000 });
  await page.waitForTimeout(200);
}
(async () => {
  const browser = await chromium.launch();

  // ===== N1: config trống =====
  await tc('N1', 'Config trống: không nút đăng nhập, không tải SDK, #/tai-khoan báo chưa mở', async () => {
    const d = await newDevice(browser, {});
    await d.page.goto(BASE);
    await d.page.waitForSelector('.path .node');
    assert.ok(await d.page.locator('#acct').isHidden());
    await d.page.goto(BASE + '#/tai-khoan');
    await d.page.waitForSelector('text=chưa mở đăng nhập');
    assert.strictEqual(d.sdkLoads.length, 0, 'SDK bị tải');
    assert.deepStrictEqual(d.errors, []);
    await d.ctx.close();
  });

  await tc('N3', 'Dán nhầm secret key: tắt tài khoản, báo lỗi console, không tải SDK', async () => {
    const d = await newDevice(browser, { key: 'sb_secret_abc' });
    await d.page.goto(BASE);
    await d.page.waitForSelector('.path .node');
    assert.ok(await d.page.locator('#acct').isHidden());
    assert.strictEqual(d.sdkLoads.length, 0);
    assert.ok(d.errors.some((e) => /khóa BÍ MẬT/.test(e)), 'không có cảnh báo');
    await d.ctx.close();
  });

  // ===== Máy 1: khách học rồi đăng nhập email =====
  const d1 = await newDevice(browser, { on: true });
  await tc('N2', 'Config có: hiện nút Đăng nhập, tải SDK, không lỗi console', async () => {
    await d1.page.goto(BASE);
    await d1.page.waitForSelector('#acct .acct-btn');
    assert.ok(/Đăng nhập/.test(await d1.page.textContent('#acct')));
    assert.strictEqual(d1.sdkLoads.length, 1);
    await d1.page.goto(BASE + '#/tai-khoan');
    await d1.page.waitForSelector('#emailForm');
    assert.strictEqual(await d1.page.locator('#namePanel').count(), 0, 'khách thấy ô tên hiển thị');
    assert.deepStrictEqual(d1.errors, []);
  });

  await tc('N4', 'Khách làm bài: có XP, Sổ câu sai; trang chủ hiện thẻ mời lưu vào tài khoản', async () => {
    await answerQuiz(d1.page, 'sc1-01', 2);
    const s = await store(d1.page);
    assert.ok(s.xp > 0 && s.lessons['sc1-01'], 'chưa có tiến độ');
    assert.ok(Object.keys(s.wrong).length >= 1, 'chưa có câu sai');
    assert.ok(!s.owner, 'khách không có owner');
    await d1.page.goto(BASE + '#/');
    await d1.page.waitForSelector('.acct-card');
  });

  let guest;
  await tc('N5', 'Đăng nhập email: báo lỗi email sai/mã sai, mã đúng thì vào, tiến độ khách gộp lên tài khoản', async () => {
    guest = await store(d1.page);
    await d1.page.click('.acct-card');
    await d1.page.waitForSelector('#emailForm');
    assert.ok(await d1.page.locator('text=sẽ được gộp vào tài khoản').count());
    await d1.page.fill('#acctEmail', 'abc');
    await d1.page.click('#emailForm button');
    await d1.page.waitForSelector('.form-msg.bad');
    await d1.page.fill('#acctEmail', 'a@x.vn');
    await d1.page.click('#emailForm button');
    await d1.page.waitForSelector('#codeForm');
    await d1.page.fill('#otp', '000000');
    await d1.page.click('#codeForm button');
    await d1.page.waitForSelector('text=Mã không đúng');
    await d1.page.fill('#otp', '123456');
    await d1.page.click('#codeForm button');
    await d1.page.waitForSelector('#logoutBtn');
    await waitSynced(d1.page);
    const row = srv.rows[UA];
    assert.ok(row, 'server chưa có dòng');
    assert.strictEqual(row.data.xp, guest.xp);
    assert.strictEqual(row.data.lessons['sc1-01'].best, guest.lessons['sc1-01'].best);
    assert.deepStrictEqual(Object.keys(row.data.wrong).sort(), Object.keys(guest.wrong).sort());
    const s = await store(d1.page);
    assert.strictEqual(s.owner, UA);
    assert.strictEqual(s.xpSynced, guest.xp);
    assert.ok(!('owner' in row.data) && !('xpSynced' in row.data), 'trường chỉ-trên-máy bị đẩy lên server');
    // Mã sai làm trình duyệt in "Failed to load resource: 403" — đó là lỗi mạng cố ý, không phải lỗi code.
    assert.deepStrictEqual(d1.errors.filter((e) => !/Failed to load resource.*403/.test(e)), []);
  });

  // ===== Máy 2: đăng nhập Google, nhận tiến độ =====
  const d2 = await newDevice(browser, { on: true });
  await tc('N6', 'Máy 2 đăng nhập Google (PKCE): nhận đủ tiến độ, URL sạch ?code', async () => {
    await d2.page.goto(BASE + '#/tai-khoan');
    await d2.page.waitForSelector('#googleBtn');
    await d2.page.click('#googleBtn');
    await d2.page.waitForSelector('#acct .avatar', { timeout: 15000 });
    await waitSynced(d2.page);
    assert.ok(!/code=/.test(d2.page.url()), 'URL còn code: ' + d2.page.url());
    assert.ok(/#\/tai-khoan$/.test(d2.page.url()), 'không quay lại trang tài khoản: ' + d2.page.url());
    await d2.page.waitForSelector('#logoutBtn');
    const s = await store(d2.page);
    assert.strictEqual(s.xp, guest.xp);
    assert.strictEqual(s.lessons['sc1-01'].stars, guest.lessons['sc1-01'].stars);
    await d2.page.goto(BASE + '#/');
    await d2.page.waitForSelector('.continue.book');
    assert.ok(!(await d2.page.locator('.acct-card').count()), 'đã đăng nhập vẫn mời đăng nhập');
    assert.deepStrictEqual(d2.errors, []);
  });

  await tc('N15', 'Tên hiển thị: chưa lưu thì gợi ý tên Google; không có khung gói/Pro nào', async () => {
    await d2.page.goto(BASE + '#/tai-khoan');
    await d2.page.evaluate(() => { const k = 'hanadul:auth'; const v = JSON.parse(localStorage.getItem(k)); v.user.user_metadata = { full_name: 'An Nguyen' }; localStorage.setItem(k, JSON.stringify(v)); });
    await d2.page.reload();
    await d2.page.waitForSelector('#displayName');
    assert.strictEqual(await d2.page.inputValue('#displayName'), 'An Nguyen');
    assert.ok((await d2.page.textContent('#namePanel')).includes('chưa lưu tên'));
    assert.ok(!/\bPro\b|trả phí|nâng cấp/i.test(await d2.page.textContent('#app')), 'trang tài khoản nói tới trả phí');
    assert.deepStrictEqual(d2.errors, []);
  });

  await tc('N16', 'Tên hiển thị: chặn tên 1 ký tự và có < >, không gọi server; tên đúng lưu lên server, tải lại vẫn còn', async () => {
    const before = srv.calls.filter((c) => /profiles/.test(c) && /^POST/.test(c)).length;
    await d2.page.fill('#displayName', 'a');
    await d2.page.click('#nameForm button');
    await d2.page.waitForSelector('.name-panel .form-msg.bad');
    assert.ok(/ít nhất 2/.test(await d2.page.textContent('.name-panel .form-msg')));
    await d2.page.fill('#displayName', '<b>An</b>');
    await d2.page.click('#nameForm button');
    await d2.page.waitForSelector('text=không được có các ký tự');
    assert.strictEqual(srv.calls.filter((c) => /profiles/.test(c) && /^POST/.test(c)).length, before, 'tên sai vẫn gửi server');
    await d2.page.fill('#displayName', '  Nguyễn   Văn An  ');
    await d2.page.click('#nameForm button');
    await d2.page.waitForSelector('text=Đã lưu tên');
    assert.strictEqual(srv.profiles[UA], 'Nguyễn Văn An');
    await d2.page.reload();
    await d2.page.waitForSelector('#displayName');
    assert.strictEqual(await d2.page.inputValue('#displayName'), 'Nguyễn Văn An');
    assert.strictEqual(await d2.page.evaluate(() => window.HD.displayName()), 'Nguyễn Văn An');
  });

  await tc('N17', 'Đọc tên hiển thị lỗi: báo chưa tải được, phần còn lại của trang vẫn dùng được; Thử lại thì hiện tên', async () => {
    srv.profileFail = 1;
    await d2.page.reload();
    await d2.page.waitForSelector('#nameRetry');
    assert.ok(await d2.page.locator('#logoutBtn').count(), 'trang tài khoản vỡ');
    await d2.page.click('#nameRetry');
    await d2.page.waitForSelector('#displayName');
    assert.strictEqual(await d2.page.inputValue('#displayName'), 'Nguyễn Văn An');
    assert.ok(!d2.errors.some((e) => /pageerror/.test(e)), d2.errors.join(' | '));
    d2.errors.length = 0;
  });

  await tc('N7', 'Học song song 2 máy: XP cộng đủ, sổ câu sai gỡ trên máy này thì máy kia gỡ theo', async () => {
    const before = srv.rows[UA].data.xp;
    const gain2 = await answerQuiz(d2.page, 'sc1-02', 0);
    await waitSynced(d2.page);
    const gain1 = await answerQuiz(d1.page, 'sc1-03', 0);
    await waitSynced(d1.page);
    assert.ok(gain1 > 0 && gain2 > 0);
    // máy 2 đồng bộ lại
    await d2.page.goto(BASE + '#/tai-khoan');
    await d2.page.click('#syncBtn');
    await waitSynced(d2.page);
    const s2 = await store(d2.page);
    assert.strictEqual(srv.rows[UA].data.xp, before + gain1 + gain2);
    assert.strictEqual(s2.xp, before + gain1 + gain2);
    assert.ok(s2.lessons['sc1-02'] && s2.lessons['sc1-03']);
    // gỡ hết sổ câu sai trên máy 2 (ôn đúng 2 lượt)
    for (let k = 0; k < 2; k++) {
      await d2.page.goto(BASE + '#/so-cau-sai');
      await d2.page.reload();
      await d2.page.waitForSelector('#startReview');
      await d2.page.click('#startReview');
      await finishQuizCorrect(d2.page);
    }
    await waitSynced(d2.page);
    assert.strictEqual(Object.keys((await store(d2.page)).wrong).length, 0);
    await d1.page.goto(BASE + '#/tai-khoan');
    await d1.page.click('#syncBtn');
    await waitSynced(d1.page);
    assert.strictEqual(Object.keys((await store(d1.page)).wrong).length, 0, 'máy 1 vẫn còn câu đã gỡ');
    await d1.page.goto(BASE + '#/');
    assert.ok(!(await d1.page.locator('.continue.book').count()));
  });

  await tc('N8', 'Máy khác ghi chen (lệch version): tự thử lại, không mất XP của bên nào', async () => {
    const before = srv.rows[UA].data.xp;
    srv.bumpBeforePatch = 1;
    await answerQuiz(d1.page, 'sc1-04', 0);
    await waitSynced(d1.page);
    const row = srv.rows[UA];
    const local = await store(d1.page);
    assert.strictEqual(row.data.xp, local.xp);
    assert.ok(row.data.xp > before + 7, 'mất XP của máy khác (+7) hoặc của máy này');
  });

  await tc('N11', 'Server lỗi: chấm đỏ + thông báo, tiến độ vẫn trên máy; có mạng lại thì đồng bộ', async () => {
    srv.failNext = 1;
    await d1.page.goto(BASE + '#/tai-khoan');
    await d1.page.click('#syncBtn');
    await d1.page.waitForSelector('#acct .sync-dot.bad');
    await d1.page.waitForSelector('text=Chưa đồng bộ được');
    assert.ok((await store(d1.page)).xp > 0);
    await d1.page.click('#syncBtn');
    await waitSynced(d1.page);
    d1.errors.length = 0; // lỗi 500 cố ý in ra console mạng
  });

  await tc('N9', 'Đăng xuất: xóa tiến độ trên máy, server còn nguyên; đăng nhập lại có lại', async () => {
    const xp = srv.rows[UA].data.xp;
    await d1.page.goto(BASE + '#/tai-khoan');
    await d1.page.click('#logoutBtn');
    await d1.page.waitForSelector('#emailForm');
    assert.strictEqual(await store(d1.page), null);
    assert.ok(/Đăng nhập/.test(await d1.page.textContent('#acct')));
    assert.strictEqual(await d1.page.evaluate(() => window.HD.displayName()), '', 'đăng xuất còn giữ tên');
    assert.strictEqual(await d1.page.locator('#namePanel').count(), 0);
    assert.strictEqual(srv.rows[UA].data.xp, xp);
    await d1.page.goto(BASE + '#/');
    await d1.page.waitForSelector('.path .node');
    assert.ok((await d1.page.textContent('#stats')).includes('⭐ 0'));
    await d1.page.goto(BASE + '#/tai-khoan');
    await d1.page.click('#googleBtn');
    await d1.page.waitForSelector('#acct .avatar', { timeout: 15000 });
    await waitSynced(d1.page);
    assert.strictEqual((await store(d1.page)).xp, xp);
  });

  await tc('N10', 'Máy còn dữ liệu của tài khoản A mà tài khoản B đăng nhập: không trộn dữ liệu A sang B', async () => {
    const d3 = await newDevice(browser, { on: true });
    await d3.page.goto(BASE);
    await d3.page.evaluate((ua) => localStorage.setItem('hanadul:v2', JSON.stringify({ owner: ua, xp: 999, xpSynced: 999, lessons: { x: { best: 100, stars: 3 } }, days: [] })), UA);
    mkUser(UB, 'b@x.vn', 'google', 'Binh');
    srv.googleAs = UB;
    await d3.page.goto(BASE + '#/tai-khoan');
    await d3.page.reload();
    await d3.page.click('#googleBtn');
    await d3.page.waitForSelector('#acct .avatar', { timeout: 15000 });
    await waitSynced(d3.page);
    assert.ok(!srv.rows[UB] || !srv.rows[UB].data.lessons.x, 'dữ liệu A lẫn sang B');
    assert.ok(!srv.rows[UB] || (srv.rows[UB].data.xp || 0) === 0);
    const s = await store(d3.page);
    assert.strictEqual(s.owner, UB);
    srv.googleAs = UA;
    await d3.ctx.close();
  });

  await tc('N12', 'Xóa tài khoản: phải xác nhận; xóa xong server không còn dữ liệu, máy sạch', async () => {
    await d2.page.goto(BASE + '#/tai-khoan');
    await d2.page.reload();
    await d2.page.waitForSelector('#logoutBtn');
    await d2.page.click('.danger-zone summary');
    await d2.page.click('#deleteBtn');
    await d2.page.waitForSelector('#deleteNo');
    await d2.page.click('#deleteNo');
    assert.ok(srv.rows[UA], 'chưa xác nhận đã xóa');
    await d2.page.click('.danger-zone summary').catch(() => {});
    if (!(await d2.page.locator('#deleteBtn').isVisible())) await d2.page.click('.danger-zone summary');
    await d2.page.click('#deleteBtn');
    await d2.page.click('#deleteYes');
    await d2.page.waitForSelector('text=Đã xóa tài khoản');
    assert.ok(!srv.rows[UA] && !srv.users[UA]);
    assert.ok(!srv.profiles[UA], 'tên còn trên server');
    assert.strictEqual(await store(d2.page), null);
    assert.deepStrictEqual(d2.errors.filter((e) => !/40[13]|Failed to load resource/.test(e)), []);
  });

  await tc('N14', 'Google trả lỗi (người dùng hủy): báo lỗi ở trang tài khoản, URL sạch', async () => {
    const d4 = await newDevice(browser, { on: true });
    await d4.page.goto(BASE + '?error=access_denied&error_description=Ban+da+huy#/');
    await d4.page.waitForSelector('text=Đăng nhập chưa thành công');
    assert.ok(!/error=/.test(d4.page.url()));
    await d4.ctx.close();
  });

  await tc('N13', 'Điện thoại 360px: thanh trên không tràn ngang khi đăng nhập/chưa đăng nhập; trang tài khoản vừa màn', async () => {
    for (const on of [false, true]) {
      const d = await newDevice(browser, { on: true, viewport: { width: 360, height: 760 } });
      await d.page.goto(BASE + '#/tai-khoan');
      await d.page.waitForSelector('#emailForm');
      if (on) {
        await d.page.evaluate(() => localStorage.setItem('hanadul:v2', JSON.stringify({ xp: 12345, days: ['2026-11-21'], wrong: { a: { item: { q: 'x', answer: 'y', lid: 'sc1-01', kind: 'vocab', options: [] }, n: 1, ok: 0, ts: 1 } } })));
        await d.page.click('#googleBtn');
        await d.page.waitForSelector('#acct .avatar', { timeout: 15000 });
        await waitSynced(d.page);
      }
      const over = await d.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(over <= 0, 'tràn ngang ' + over + 'px');
      const bar = await d.page.evaluate(() => { const r = document.querySelector('#acct').getBoundingClientRect(); return r.right; });
      assert.ok(bar <= 360, 'nút tài khoản ra ngoài màn: ' + bar);
      if (on) await d.page.waitForSelector('#displayName');
      await d.page.screenshot({ path: process.env.SHOTS + '/tai-khoan-dien-thoai-' + (on ? 'da-dang-nhap' : 'chua-dang-nhap') + '.png', fullPage: true });
      await d.ctx.close();
    }
  });

  await d1.ctx.close(); await d2.ctx.close();
  await browser.close();
  console.log('\n' + results.filter((r) => r[2] === 'PASS').length + '/' + results.length + ' PASS');
  require('fs').writeFileSync(process.env.SHOTS + '/e2e_account.json', JSON.stringify(results, null, 1));
})();

// Làm hết bài Luyện nhanh: `wrongN` câu đầu cố ý chọn sai, còn lại chọn đúng.
async function answerQuiz(page, lessonId, wrongN) {
  await page.goto(BASE + '#/bai/' + lessonId + '/lam-bai');
  await page.reload();
  await page.click('.mode[data-mode="quick"]');
  await finishQuizCorrect(page, wrongN);
  // XP vừa nhận, đọc trên màn kết quả ("+120")
  return Number((await page.textContent('.rbox.xp b')).replace('+', ''));
}
async function finishQuizCorrect(page, wrongN) {
  let wrongLeft = wrongN || 0;
  for (let i = 0; i < 300; i++) {
    await page.waitForSelector('.opt, .result-grid');
    if (await page.locator('.result-grid').count()) return;
    const right = await page.evaluate(() => window.__curIdx);
    const n = await page.locator('.opt').count();
    const retry = await page.locator('.retry-tag').filter({ hasText: 'Làm lại' }).count();
    const idx = wrongLeft > 0 && !retry ? (right + 1) % n : right;
    await page.click('.opt[data-o="' + idx + '"]');
    if (idx !== right) wrongLeft--;
    await page.click('#next');
  }
  throw new Error('bài không kết thúc');
}
