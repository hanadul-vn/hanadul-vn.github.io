// Test âm thanh thu sẵn cho đề thi thử Nghe (giọng Google Chirp 3 HD): assets/exam.js phát file ex.audio,
// thiếu file thì quay về giọng trình duyệt; trang Cài app tải cả file âm thanh; tools/tts/gen_audio.py + tools/check_data.py.
// Chạy: python3 -m http.server 8765 (ở thư mục gốc repo), rồi node tests/e2e_tts.js   (ONLY=A01,A02 chạy riêng)
// Không gọi Google: file âm thanh được giả lập (nội dung "FILE:<tên>"), Audio.play được thay bằng hàm ghi lại file đã phát.
'use strict';
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const BASE = process.env.BASE || 'http://localhost:8765/';
const ROOT = path.resolve(__dirname, '..');
const NG = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/exams/nghe-01.json'), 'utf8'));
const NGQ = NG.sets.flatMap((s) => s.questions);
const FILES = NG.sets.map((_, i) => String(i + 1).padStart(2, '0') + '-test.mp3');
const AUDIO = { dir: 'data/audio/nghe-01', by: 'test', sample: 'thu-test.mp3', files: FILES };

// MP3 im lặng hợp lệ cho từng tên file, tên ghi trong thẻ ID3 (title=FILE:<tên>) để biết file nào được phát.
const MP3DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-mp3-'));
function mp3(name) {
  const f = path.join(MP3DIR, name);
  if (!fs.existsSync(f)) execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', '0.3', '-metadata', 'title=FILE:' + name, '-codec:a', 'libmp3lame', '-b:a', '32k', f]);
  return fs.readFileSync(f);
}
const results = [];
async function tc(id, name, fn) {
  if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) return;
  try { await fn(); results.push([id, name, 'PASS']); console.log('PASS', id, name); }
  catch (e) { results.push([id, name, 'FAIL: ' + e.message.split('\n')[0]]); console.log('FAIL', id, name, '\n  ', e.stack.split('\n').slice(0, 3).join('\n   ')); process.exitCode = 1; }
}
// missing: tên file trả 404. Ghi lại: window.__played (nội dung file đã phát), __paused, __spoken (giọng trình duyệt), __audioReq (file đã tải).
async function device(browser, missing) {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await require('./stub_third_party')(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/supabase\.co\//, (r) => r.abort());
  await ctx.route('**/data/exams/nghe-01.json', async (route) => {
    const r = await route.fetch(); const j = await r.json(); j.audio = AUDIO;
    route.fulfill({ response: r, body: JSON.stringify(j) });
  });
  const req = [];
  await ctx.route('**/data/audio/nghe-01/*', (route) => {
    const name = route.request().url().split('/').pop();
    req.push(name);
    if ((missing || []).includes(name)) return route.fulfill({ status: 404, body: 'not found' });
    route.fulfill({ status: 200, contentType: 'audio/mpeg', body: mp3(name) });
  });
  await ctx.addInitScript(() => {
    window.__spoken = []; window.__played = []; window.__paused = 0;
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push({ text: u.text, pitch: u.pitch }); };
    HTMLMediaElement.prototype.play = function () {
      const el = this;
      return fetch(el.src).then((r) => {
        if (!r.ok) { el.dispatchEvent(new Event('error')); return; }
        return r.text().then((t) => { window.__played.push((t.match(/FILE:[\w.-]+\.mp3/) || ['?'])[0]); });
      }, () => { el.dispatchEvent(new Event('error')); });
    };
    HTMLMediaElement.prototype.pause = function () { window.__paused++; };
  });
  const page = await ctx.newPage();
  page.req = req;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::/.test(m.text())) page.errors.push(m.text()); });
  return { ctx, page };
}
async function open(page, hash) {
  await page.goto(BASE + 'robots.txt');
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(BASE + 'index.html' + hash);
  await page.waitForTimeout(250);
}
const played = (page) => page.evaluate(() => window.__played.slice());
const waitPlayed = (page, n) => page.waitForFunction((k) => window.__played.length >= k || window.__spoken.length > 0, n, { timeout: 3000 }).catch(() => {});

(async () => {
  const browser = await chromium.launch();
  const { ctx, page } = await device(browser, ['05-test.mp3']);

  await tc('A01', 'Giới thiệu đề Nghe có âm thanh: nêu giọng đọc AI thu sẵn (không còn hướng dẫn cài giọng máy); Nghe thử phát file mẫu, không dùng giọng trình duyệt', async () => {
    await open(page, '#/thi-thu/nghe-01');
    await page.waitForSelector('#startBtn');
    const t = await page.textContent('.exam-intro');
    assert.ok(/giọng đọc AI tự nhiên thu sẵn/.test(t) && /tối đa 2 lần/.test(t), t);
    assert.ok(!/Chuyển văn bản thành giọng nói/.test(t), 'không còn hướng dẫn cài giọng máy');
    await page.click('#ttsCheck [data-sample]');
    await waitPlayed(page, 1);
    assert.deepStrictEqual(await played(page), ['FILE:thu-test.mp3']);
    assert.strictEqual(await page.evaluate(() => window.__spoken.length), 0);
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('A02', 'Làm bài: tải trước mọi file; bấm loa bộ 6 phát đúng file 06; đếm lượt; hết 2 lượt khóa nút; không gọi giọng trình duyệt', async () => {
    await page.click('#startBtn'); await page.waitForSelector('#examTimer');
    await page.waitForTimeout(400);
    FILES.forEach((f) => assert.ok(page.req.includes(f), 'đã tải trước ' + f));
    await page.evaluate(() => { window.__played = []; });
    await page.click('[data-play="5"]'); await waitPlayed(page, 1);
    assert.deepStrictEqual(await played(page), ['FILE:06-test.mp3']);
    assert.ok(/Còn 1 lượt/.test(await page.textContent('[data-left="5"]')));
    await page.click('[data-play="5"]'); await waitPlayed(page, 2);
    assert.deepStrictEqual(await played(page), ['FILE:06-test.mp3', 'FILE:06-test.mp3']);
    assert.ok(await page.isDisabled('[data-play="5"]'));
    assert.strictEqual(await page.evaluate(() => window.__spoken.length), 0);
  });

  await tc('A03', 'Thiếu file bộ 5 (404): bấm loa quay về giọng trình duyệt, đọc đúng lời thoại, nam/nữ khác cao độ; vẫn trừ lượt', async () => {
    await page.evaluate(() => { window.__played = []; window.__spoken = []; });
    await page.click('[data-play="4"]');
    await page.waitForFunction(() => window.__spoken.length > 0, null, { timeout: 3000 });
    const sp = await page.evaluate(() => window.__spoken);
    assert.deepStrictEqual(sp.map((x) => x.text), NG.sets[4].lines.map((l) => l[1]));
    NG.sets[4].lines.forEach((l, i) => assert.ok(l[0] === '여자' ? sp[i].pitch > 1 : sp[i].pitch < 1, 'cao độ theo giới tính'));
    assert.deepStrictEqual(await played(page), []);
    assert.ok(/Còn 1 lượt/.test(await page.textContent('[data-left="4"]')));
  });

  await tc('A04', 'Rời trang đang làm thì dừng âm thanh (pause); nộp bài → xem lại: nghe lại không giới hạn đúng file', async () => {
    await page.evaluate(() => { window.__played = []; window.__spoken = []; });
    await page.click('[data-play="0"]'); await waitPlayed(page, 1);
    assert.deepStrictEqual(await played(page), ['FILE:01-test.mp3']);
    const before = await page.evaluate(() => window.__paused);
    for (const q of NGQ) await page.click(`.ex-opt[data-n="${q.n}"][data-o="${q.answer}"]`);
    await page.click('#submitBtn'); await page.click('#confirmYes');
    await page.waitForSelector('#scoreRight');
    assert.ok((await page.evaluate(() => window.__paused)) > before, 'đã dừng âm thanh khi rời trang làm bài');
    assert.strictEqual(await page.textContent('#scoreRight'), '30');
    await page.evaluate(() => { window.__played = []; window.__spoken = []; });
    for (let i = 0; i < 3; i++) { await page.click('[data-replay="2"]'); await waitPlayed(page, i + 1); }
    assert.deepStrictEqual(await played(page), ['FILE:03-test.mp3', 'FILE:03-test.mp3', 'FILE:03-test.mp3']);
    assert.deepStrictEqual(page.errors, []);
  });

  await tc('A05', 'Trang Cài app: danh sách tải offline có đủ file âm thanh đề Nghe + file Nghe thử', async () => {
    await open(page, '#/ung-dung');
    const urls = await page.evaluate(() => HD.pwa.offlineList().then((l) => l.urls));
    FILES.concat(['thu-test.mp3']).forEach((f) => assert.ok(urls.includes('data/audio/nghe-01/' + f), f));
    assert.ok(urls.includes('data/exams/nghe-01.json'));
  });
  await ctx.close();

  await tc('A06', 'Đề Nghe chưa có âm thanh (không có trường audio): vẫn dùng giọng trình duyệt như cũ', async () => {
    const c = await browser.newContext();
    await require('./stub_third_party')(c);
    await c.route(/supabase\.co\/|fonts\./, (r) => r.abort());
    await c.route('**/data/exams/nghe-01.json', async (route) => {
      const r = await route.fetch(); const j = await r.json(); delete j.audio; route.fulfill({ response: r, body: JSON.stringify(j) });
    });
    await c.addInitScript(() => { window.__spoken = []; if (window.speechSynthesis) window.speechSynthesis.speak = (u) => { window.__spoken.push(u.text); }; });
    const p = await c.newPage();
    await open(p, '#/thi-thu/nghe-01'); await p.waitForSelector('#startBtn');
    assert.ok(/giọng đọc có sẵn của trình duyệt/.test(await p.textContent('.exam-intro')));
    assert.ok(await p.$('#ttsCheck [data-say]'));
    await p.click('#startBtn'); await p.waitForSelector('#examTimer');
    await p.click('[data-play="0"]');
    assert.deepStrictEqual(await p.evaluate(() => window.__spoken), NG.sets[0].lines.map((l) => l[1]));
    await c.close();
  });
  await browser.close();

  await tc('A07', 'gen_audio.py --fake trên bản sao repo: tạo 24 file + file Nghe thử, check_data OK; sửa lời thoại 1 bộ → check_data báo lỗi, chạy lại chỉ tạo 1 file, file cũ bị xóa; --dry-run đếm ký tự; thiếu key thì dừng', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-tts-'));
    try {
      for (const d of ['data', 'tools']) fs.cpSync(path.join(ROOT, d), path.join(tmp, d), { recursive: true });
      fs.rmSync(path.join(tmp, 'data/audio'), { recursive: true, force: true });
      const ex = path.join(tmp, 'data/exams/nghe-01.json');
      const j0 = JSON.parse(fs.readFileSync(ex, 'utf8')); delete j0.audio; fs.writeFileSync(ex, JSON.stringify(j0, null, 1) + '\n');
      const py = (args, env) => spawnSync('python3', [path.join(tmp, 'tools/tts/gen_audio.py'), ...args], { encoding: 'utf8', env: Object.assign({}, process.env, { GOOGLE_TTS_API_KEY: '' }, env || {}) });
      const check = () => spawnSync('python3', [path.join(tmp, 'tools/check_data.py')], { encoding: 'utf8' });
      let r = py([]);
      assert.notStrictEqual(r.status, 0); assert.ok(/Thiếu GOOGLE_TTS_API_KEY/.test(r.stderr + r.stdout));
      r = py(['--dry-run']);
      assert.strictEqual(r.status, 0, r.stderr);
      const chars = NG.sets.reduce((a, s) => a + s.lines.reduce((b, l) => b + l[1].length, 0), 0) + '안녕하세요. 듣기 시험을 시작하겠습니다.'.length;
      assert.ok(r.stdout.includes('sẽ gửi Google: ' + chars), r.stdout);
      r = py(['--fake']);
      assert.strictEqual(r.status, 0, r.stderr);
      const j = JSON.parse(fs.readFileSync(ex, 'utf8'));
      const dir = path.join(tmp, 'data/audio/nghe-01');
      assert.strictEqual(j.audio.files.length, NG.sets.length);
      assert.strictEqual(fs.readdirSync(dir).length, NG.sets.length + 1);
      assert.ok(/giọng đọc AI/.test(j.note) && !/giọng đọc máy của trình duyệt/.test(j.note));
      const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(dir, j.audio.files[0])], { encoding: 'utf8' });
      assert.ok(+probe > 1, 'file MP3 đọc được, dài ' + probe);
      r = check(); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      // Sửa lời thoại bộ 3 → file cũ hết khớp.
      j.sets[2].lines[0][1] += ' 정말요?';
      fs.writeFileSync(ex, JSON.stringify(j, null, 1) + '\n');
      r = check(); assert.notStrictEqual(r.status, 0); assert.ok(/không khớp lời thoại/.test(r.stdout + r.stderr), r.stdout);
      const old3 = j.audio.files[2];
      r = py(['--fake']);
      assert.ok(/tạo 1 file/.test(r.stdout) && /xóa file cũ/.test(r.stdout), r.stdout);
      assert.ok(!fs.existsSync(path.join(dir, old3)));
      r = check(); assert.strictEqual(r.status, 0, r.stdout + r.stderr);
      // File thừa trong thư mục âm thanh bị báo lỗi.
      fs.writeFileSync(path.join(dir, 'la.mp3'), 'x');
      r = check(); assert.ok(/file thừa/.test(r.stdout + r.stderr));
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  fs.rmSync(MP3DIR, { recursive: true, force: true });
  console.log('\n' + results.map((r) => r.join(' | ')).join('\n'));
  console.log(`\n${results.filter((r) => r[2] === 'PASS').length}/${results.length} PASS`);
})();
