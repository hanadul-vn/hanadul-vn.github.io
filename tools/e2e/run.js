// Kiểm thử đầu-cuối (Playwright) cho web Hana Dul.
// Chạy: python3 -m http.server 8765 (ở thư mục gốc repo) rồi node tools/e2e/run.js
// Kết quả: in PASS/FAIL từng case, ghi tools/e2e/ket-qua.json, thoát mã 1 nếu có case FAIL.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
const LESSONS = idx.levels.flatMap((lv) => lv.lessons);
const DATA = {};
LESSONS.forEach((l) => { DATA[l.id] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/lessons', l.id + '.json'), 'utf8')); });
const NEW = ['tc3-07', 'tc3-08', 'tc3-09'];
const SC2 = idx.levels.find((lv) => lv.id === 'sc2').lessons.map((l) => l.id);
const TC3 = idx.levels.find((lv) => lv.id === 'tc3').lessons.map((l) => l.id);
const TOTAL = LESSONS.length; // 16 bài Sơ cấp 1 (gồm Hangeul) + 15 bài Sơ cấp 2 + 9 bài Trung cấp 3
const LVNAME = { sc1: 'Sơ cấp 1', sc2: 'Sơ cấp 2', tc3: 'Trung cấp 3' };
const lname = (id) => LVNAME[id.slice(0, 3)] + ' Bài ' + (+id.slice(-2));
const TOPIK_TAGS = ['Điền vào chỗ trống', 'Nghĩa gần nhất', 'Đọc thông báo', 'Sắp xếp câu', 'Đọc đoạn văn', 'Nghe hội thoại'];
const OLD = LESSONS.map((l) => l.id).filter((id) => !NEW.includes(id));

// ---- đáp án đúng, tra từ dữ liệu ----
const norm = (s) => String(s || '').replace(/__/g, '').replace(/\s+/g, ' ').trim();
const ANS = {}; // khóa (câu hỏi hoặc câu nghe) -> tập đáp án đúng
const PAIRS = []; // [ko, vi, lid]
function addAns(k, a) { k = norm(k); (ANS[k] = ANS[k] || new Set()).add(norm(a)); }
Object.values(DATA).forEach((d) => {
  (d.vocab || []).forEach((g) => g.words.forEach((w) => PAIRS.push([norm(w[0]), norm(w[1])])));
  (d.grammar || []).forEach((g) => g.questions.forEach((q) => addAns(q.q, q.options[0])));
  (d.usage || []).forEach((q) => addAns(q.q, q.options[0]));
  (d.listening || []).forEach((q) => addAns(q.listen, q.options[0]));
  if (d.reading) d.reading.questions.forEach((q) => addAns(d.reading.passage + '|' + q.q, q.options[0]));
  (d.topik || []).forEach((q) => {
    if (q.lines) addAns(q.lines.map((l) => l[1]).join(' '), q.options[0]);
    else if (q.passage) addAns(q.passage + '|' + q.q, q.options[0]);
    else addAns(q.q, q.options[0]);
  });
});
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TEMPLATES = [];
function addTpl(tpl, side) {
  const ph = side === 'ko' ? '{ko}' : '{vi}';
  const [a, b] = tpl.split(ph);
  TEMPLATES.push({ re: new RegExp('^' + esc(norm(a)) + '\\s*(.+?)\\s*' + esc(norm(b)) + '$'), side });
}
addTpl('Nghĩa của {ko} là gì?', 'ko');
addTpl('“{vi}” trong tiếng Hàn là gì?', 'vi');
Object.values(DATA).forEach((d) => { const p = d.vocabPrompt || {}; if (p.koToVi) addTpl(p.koToVi, 'ko'); if (p.viToKo) addTpl(p.viToKo, 'vi'); });
function pickAnswer(info) {
  const opts = info.options.map(norm);
  const keys = [];
  if (info.listen) keys.push(info.listen);
  else if (info.passage) keys.push(info.passage + '|' + info.q);
  else keys.push(info.q);
  for (const k of keys) {
    const set = ANS[norm(k)];
    if (set) { const i = opts.findIndex((o) => set.has(o)); if (i >= 0) return i; }
  }
  // Câu từ vựng: tách đúng từ trong câu hỏi theo mẫu (Nghĩa của {ko} là gì? / “{vi}” trong tiếng Hàn là gì? / mẫu riêng của bài).
  const q = norm(info.q);
  for (const t of TEMPLATES) {
    const m = q.match(t.re);
    if (!m) continue;
    const key = norm(m[1]);
    const i = opts.findIndex((o) => PAIRS.some(([ko, vi]) => (t.side === 'ko' ? ko === key && vi === o : vi === key && ko === o)));
    if (i >= 0) return i;
  }
  return -1;
}

// ---- khung case ----
const results = [];
let current = null;
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null; // ví dụ ONLY='R01-04' để chạy lại riêng case lỗi
async function tc(id, title, fn) {
  if (ONLY && !ONLY.test(id)) return;
  current = { id, title, status: 'PASS', note: '' };
  try { const note = await fn(); if (note) current.note = String(note); }
  catch (e) { current.status = 'FAIL'; current.note = (e && e.message || String(e)).split('\n')[0]; }
  results.push(current);
  console.log(`${current.status}  ${id}  ${title}${current.note ? '  — ' + current.note : ''}`);
}
function assert(c, msg) { if (!c) throw new Error(msg); }

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 } }, opts));
  await require('../../tests/stub_third_party')(ctx);
  await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort()); // không gọi ra ngoài (GA, font)
  // Ghi lại các câu máy đọc (kèm cao độ giọng) để kiểm phần nghe hội thoại.
  await ctx.addInitScript(() => {
    window.__spoken = [];
    if (window.speechSynthesis) {
      window.speechSynthesis.speak = (u) => { window.__spoken.push({ text: u.text, pitch: u.pitch }); };
    }
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) page.errors.push('console: ' + m.text()); });
  return { ctx, page };
}
async function go(page, hash) {
  await page.goto(BASE + 'index.html' + hash);
  await page.reload(); // hash giữ nguyên giữa các lượt → nạp lại cho sạch
  await page.waitForTimeout(150);
}

// Làm một lượt bài. wrongIdx: các câu (thứ tự lần đầu) cố ý trả lời sai.
async function playQuiz(page, { wrong = [] } = {}) {
  let first = 0, steps = 0;
  const unknown = [];
  while (steps++ < 400) {
    if (await page.$('.result-grid')) break;
    await page.waitForSelector('.opt, .result-grid', { timeout: 5000 });
    if (await page.$('.result-grid')) break;
    const info = await page.evaluate(() => ({
      q: (document.querySelector('.qtext > span') || {}).innerText || '',
      listen: (document.querySelector('.listen-box .play') || { getAttribute: () => '' }).getAttribute('data-say') || '',
      passage: (document.querySelector('.passage') || {}).innerText || '',
      retry: !!document.querySelector('.retry-tag') && /Làm lại/.test(document.querySelector('.retry-tag').innerText),
      options: [...document.querySelectorAll('.opt')].map((b) => b.querySelector('span:last-child').innerText),
    }));
    let i = pickAnswer(info);
    if (i < 0) { unknown.push(info.q || info.listen); i = 0; }
    if (!info.retry) { if (wrong.includes(first)) i = (i + 1) % info.options.length; first++; }
    await page.click(`.opt[data-o="${i}"]`);
    await page.click('#next');
  }
  await page.waitForSelector('.result-grid', { timeout: 5000 });
  const res = await page.evaluate(() => ({
    acc: document.querySelector('.rbox.acc b').innerText,
    line: document.querySelector('.panel p.muted').innerText,
    stars: document.querySelectorAll('.result-stars .on, .result-stars .lit, .result-stars span.full').length,
    nextHref: (document.querySelector('.actions a.btn:not(.ghost)') || {}).getAttribute ? document.querySelector('.actions a.btn:not(.ghost)').getAttribute('href') : '',
    writing: !!document.getElementById('wtext'),
    fill: document.querySelectorAll('.fill-in').length,
  }));
  res.first = first; res.unknown = unknown;
  return res;
}
async function startMode(page, lid, mode) {
  await go(page, `#/bai/${lid}/lam-bai`);
  await page.waitForSelector(`.mode[data-mode="${mode}"]`);
  const label = await page.$eval(`.mode[data-mode="${mode}"] span:last-child`, (e) => e.innerText);
  const n = +label.match(/(\d+) câu/)[1];
  await page.click(`.mode[data-mode="${mode}"]`);
  return n;
}
async function noHScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

(async () => {
  const browser = await chromium.launch();
  const { ctx, page } = await newPage(browser);
  const { execSync } = require('child_process');

  // ================= PHẦN MỚI =================
  await tc('N01', 'Dữ liệu hợp lệ: tools/check_data.py chạy OK cho toàn bộ ' + TOTAL + ' bài', async () => {
    const out = execSync('python3 tools/check_data.py', { cwd: ROOT }).toString();
    assert(/\nOK\s*$/.test(out), 'check_data không OK');
    NEW.forEach((id) => assert(out.includes(id + ':'), 'thiếu ' + id));
  });

  await tc('N02', 'TC3 Bài 7–9 soạn đủ phần: ≥35 từ, ≥8 câu từ trong câu, 3–4 mẫu ngữ pháp ≥5 câu/mẫu, 5 câu nghe, đọc hiểu 2 câu, luyện viết; đủ 6 dạng TOPIK (điền 3, nghĩa gần 2, thông báo 1, sắp xếp 1, đoạn văn 1, hội thoại 2) và 2 bài viết điền ㉠㉡', async () => {
    const notes = [];
    NEW.forEach((id) => {
      const d = DATA[id];
      const nw = d.vocab.reduce((a, g) => a + g.words.length, 0);
      assert(nw >= 35, `${id}: ${nw} từ`);
      assert(d.usage.length >= 8, `${id}: usage ${d.usage.length}`);
      assert(d.grammar.length >= 3 && d.grammar.length <= 4, `${id}: ${d.grammar.length} mẫu`);
      d.grammar.forEach((g) => { assert(g.questions.length >= 5, `${id} ${g.pattern}: ${g.questions.length} câu`); assert(g.note.length && g.examples.length >= 3, `${id} ${g.pattern}: thiếu note/ví dụ`); });
      assert(d.listening.length === 5, `${id}: nghe ${d.listening.length}`);
      assert(d.reading && d.reading.questions.length === 2, `${id}: đọc hiểu`);
      assert(d.writing && d.writing.samples.length >= 3 && d.writing.tips, `${id}: luyện viết`);
      const cnt = {}; (d.topik || []).forEach((q) => { cnt[q.type] = (cnt[q.type] || 0) + 1; });
      const want = { blank: 3, similar: 2, notice: 1, order: 1, main: 1, dialog: 2 };
      Object.keys(want).forEach((t) => assert(cnt[t] === want[t], `${id}: TOPIK ${t} có ${cnt[t] || 0} câu, cần ${want[t]}`));
      assert(d.fillWriting && d.fillWriting.length === 2 && d.fillWriting.every((f) => f.blanks.length === 2), `${id}: viết điền ㉠㉡`);
      notes.push(`${id}: ${nw} từ, ${d.topik.length} câu TOPIK`);
    });
    return notes.join(', ');
  });

  await tc('N03', 'Từ vựng TC3 Bài 7–9 không lặp lại từ của Sơ cấp 1 (Hangeul + 15 bài), Sơ cấp 2 (15 bài), TC3 Bài 1–6 và không lặp giữa 3 bài mới', async () => {
    const old = new Set(OLD.flatMap((id) => (DATA[id].vocab || []).flatMap((g) => g.words.map((w) => norm(w[0])))));
    const seen = new Map(); const dup = [];
    NEW.forEach((id) => DATA[id].vocab.forEach((g) => g.words.forEach((w) => {
      const k = norm(w[0]);
      if (old.has(k)) dup.push(`${id}:${k} (bài cũ)`);
      if (seen.has(k)) dup.push(`${id}:${k} (trùng ${seen.get(k)})`);
      seen.set(k, id);
    })));
    assert(!dup.length, dup.join(', '));
    return `${seen.size} từ mới, 0 trùng`;
  });

  await tc('N04', 'Trong mỗi bài mới, nghĩa tiếng Việt không trùng nhau (đáp án nhiễu không bị trùng đáp án đúng)', async () => {
    NEW.forEach((id) => {
      const vis = DATA[id].vocab.flatMap((g) => g.words.map((w) => norm(w[1])));
      const d = vis.filter((v, i) => vis.indexOf(v) !== i);
      assert(!d.length, `${id}: ${d.join(', ')}`);
    });
  });

  await tc('N05', 'index.json: Sơ cấp 1 (0→15) và Sơ cấp 2 (1→15) giữ nguyên; thêm cấp Trung cấp 3 riêng (tc3, ghi cấp trong tên bài) gồm Bài 1→9, mỗi bài có tên, chữ Hàn, tóm tắt ngữ pháp, icon', async () => {
    assert(idx.levels.map((l) => l.id).join(',') === 'sc1,sc2,tc3', idx.levels.map((l) => l.id).join(','));
    const n1 = idx.levels[0].lessons.map((l) => l.no).join(',');
    assert(n1 === '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15', 'SC1 ' + n1);
    const n2 = idx.levels[1].lessons.map((l) => l.id + ':' + l.no).join(',');
    assert(n2 === 'sc2-01:1,sc2-02:2,sc2-03:3,sc2-04:4,sc2-05:5,sc2-06:6,sc2-07:7,sc2-08:8,sc2-09:9,sc2-10:10,sc2-11:11,sc2-12:12,sc2-13:13,sc2-14:14,sc2-15:15', 'SC2 ' + n2);
    const lv3 = idx.levels[2];
    assert(lv3.name === 'Trung cấp 3' && lv3.prefix === true, 'cấp TC3: ' + lv3.name);
    const n3 = lv3.lessons.map((l) => l.id + ':' + l.no).join(',');
    assert(n3 === 'tc3-01:1,tc3-02:2,tc3-03:3,tc3-04:4,tc3-05:5,tc3-06:6,tc3-07:7,tc3-08:8,tc3-09:9', 'TC3 ' + n3);
    NEW.forEach((id) => { const l = LESSONS.find((x) => x.id === id); assert(l.title && l.ko && l.summary && l.icon, id); });
  });

  await tc('N06', 'Trang chủ: đếm "' + TOTAL + ' bài học", hiện link Bài 1–9 Trung cấp 3', async () => {
    await go(page, '#/');
    await page.waitForSelector('.hero-facts');
    const facts = await page.$eval('.hero-facts', (e) => e.innerText);
    assert(new RegExp(TOTAL + '\\s*bài học').test(facts), facts);
    for (const id of TC3) assert(await page.$(`a[href="#/bai/${id}"]`), 'thiếu link ' + id);
  });

  await tc('N12', 'Lộ trình tách rõ 3 cấp: 3 khối riêng theo thứ tự Sơ cấp 1 → Sơ cấp 2 → Trung cấp 3, mỗi khối chỉ chứa bài của cấp đó, nhãn "Cấp 1/2/3", đếm x/16, x/15, x/9, ô "Bài tiếp theo" chỉ ở cuối Trung cấp 3', async () => {
    await go(page, '#/');
    await page.waitForSelector('.level');
    const lv = await page.$$eval('.level', (els) => els.map((e) => ({
      id: e.id, h2: e.querySelector('h2').innerText, badge: e.querySelector('.level-badge').innerText,
      prog: e.querySelector('.level-progress').innerText,
      links: [...e.querySelectorAll('a.node')].map((a) => a.getAttribute('href').replace('#/bai/', '')),
      soon: !!e.querySelector('.soon'),
    })));
    assert(lv.length === 3, lv.length + ' khối');
    assert(lv[0].id === 'lo-trinh-sc1' && lv[0].h2 === 'Sơ cấp 1' && /Cấp 1/.test(lv[0].badge), JSON.stringify(lv[0]).slice(0, 120));
    assert(lv[1].id === 'lo-trinh-sc2' && lv[1].h2 === 'Sơ cấp 2' && /Cấp 2/.test(lv[1].badge), JSON.stringify(lv[1]).slice(0, 120));
    assert(lv[2].id === 'lo-trinh-tc3' && lv[2].h2 === 'Trung cấp 3' && /Cấp 3/.test(lv[2].badge) && /Đang mở 9 bài/.test(lv[2].badge), JSON.stringify(lv[2]).slice(0, 160));
    assert(lv[0].links.length === 16 && lv[0].links.every((x) => x.startsWith('sc1-')), 'khối SC1: ' + lv[0].links.join(','));
    assert(lv[1].links.join(',') === SC2.join(',') && SC2.length === 15, 'khối SC2: ' + lv[1].links.join(','));
    assert(lv[2].links.join(',') === TC3.join(',') && TC3.length === 9, 'khối TC3: ' + lv[2].links.join(','));
    assert(/\/16 bài/.test(lv[0].prog) && /\/15 bài/.test(lv[1].prog) && /\/9 bài/.test(lv[2].prog), lv.map((x) => x.prog).join(' | '));
    assert(!lv[0].soon && !lv[1].soon && lv[2].soon, 'ô Bài tiếp theo sai chỗ');
    const ids = await page.$$eval('[id]', (els) => els.map((e) => e.id));
    assert(ids.filter((x) => x === 'lo-trinh').length === 1, 'id lo-trinh bị trùng');
  });

  // ---- Tab cấp độ (thay cho cuộn tới khối) ----
  const tabState = (page) => page.evaluate(() => ({
    sel: [...document.querySelectorAll('.level-jump [role="tab"]')].filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.dataset.level),
    active: [...document.querySelectorAll('.level-jump a.active')].map((t) => t.dataset.level),
    shown: [...document.querySelectorAll('section.level')].filter((s) => s.offsetParent !== null).map((s) => s.id),
    links: [...document.querySelectorAll('section.level')].filter((s) => s.offsetParent !== null).flatMap((s) => [...s.querySelectorAll('a.node')].map((a) => a.getAttribute('href').replace('#/bai/', ''))),
    y: window.scrollY, hash: location.hash,
  }));

  await tc('T01', 'Vào trang chủ: có thanh tab 3 cấp (role tablist), mặc định chọn và tô nổi tab Sơ cấp 1, chỉ hiện 16 bài Sơ cấp 1; Sơ cấp 2 và Trung cấp 3 bị ẩn', async () => {
    await go(page, '#/');
    await page.waitForSelector('.level-jump [role="tab"]');
    const chips = await page.$$eval('.level-jump a', (els) => els.map((a) => a.innerText.trim() + '|' + a.getAttribute('href')));
    assert(chips.length === 3 && /Sơ cấp 1\|#lo-trinh-sc1/.test(chips[0]) && /Sơ cấp 2\|#lo-trinh-sc2/.test(chips[1]) && /Trung cấp 3\|#lo-trinh-tc3/.test(chips[2]), chips.join(' / '));
    assert(await page.$('.level-jump[role="tablist"]'), 'thiếu role=tablist');
    const st = await tabState(page);
    assert(st.sel.join() === 'sc1' && st.active.join() === 'sc1', 'tab chọn: ' + st.sel + ' / ' + st.active);
    assert(st.shown.join() === 'lo-trinh-sc1', 'khối đang hiện: ' + st.shown);
    assert(st.links.length === 16 && st.links.every((x) => x.startsWith('sc1-')), 'bài đang hiện: ' + st.links.join(','));
    const bg = await page.$$eval('.level-jump a', (els) => els.map((a) => getComputedStyle(a).backgroundColor));
    assert(bg[0] !== bg[1] && bg[1] === bg[2], 'tab đang chọn không nổi bật: ' + bg.join(' | '));
  });

  await tc('T02', 'Bấm tab Sơ cấp 2 rồi Trung cấp 3: đổi highlight, thay danh sách đúng bài cấp đó, KHÔNG cuộn trang, không vẽ lại trang (hero giữ nguyên), hash đổi thành #lo-trinh-<cấp>', async () => {
    await go(page, '#/');
    await page.waitForSelector('.level-jump');
    await page.evaluate(() => { document.querySelector('.hero').dataset.mark = '1'; });
    const y0 = await page.evaluate(() => window.scrollY);
    await page.click('.level-jump a[href="#lo-trinh-sc2"]');
    await page.waitForTimeout(800);
    let st = await tabState(page);
    assert(st.sel.join() === 'sc2' && st.active.join() === 'sc2', 'tab chọn: ' + st.sel);
    assert(st.shown.join() === 'lo-trinh-sc2' && st.links.join(',') === SC2.join(','), 'SC2 hiện: ' + st.links.join(','));
    assert(st.y === y0, 'trang bị cuộn: ' + y0 + ' → ' + st.y);
    assert(st.hash === '#lo-trinh-sc2', 'hash ' + st.hash);
    await page.click('.level-jump a[href="#lo-trinh-tc3"]');
    await page.waitForTimeout(800);
    st = await tabState(page);
    assert(st.sel.join() === 'tc3' && st.shown.join() === 'lo-trinh-tc3' && st.links.join(',') === TC3.join(','), 'TC3: ' + JSON.stringify(st));
    assert(st.y === y0, 'trang bị cuộn: ' + y0 + ' → ' + st.y);
    assert(await page.$('.level-tc3 .soon'), 'thiếu ô "Bài tiếp theo" ở TC3');
    await page.click('.level-jump a[href="#lo-trinh-sc1"]');
    await page.waitForTimeout(500);
    st = await tabState(page);
    assert(st.sel.join() === 'sc1' && st.links.length === 16, 'quay lại SC1: ' + st.sel);
    assert(await page.$('.hero[data-mark="1"]'), 'trang bị vẽ lại khi đổi tab');
  });

  await tc('T03', 'Đổi tab không thêm bước vào lịch sử: SC1→SC2→TC3 rồi Back về đúng trang trước (không lùi từng tab)', async () => {
    await page.goto(BASE + 'index.html#/so-cau-sai'); await page.reload();
    await page.waitForTimeout(300);
    await page.goto(BASE + 'index.html#/'); await page.waitForSelector('.level-jump');
    await page.click('.level-jump a[href="#lo-trinh-sc2"]');
    await page.click('.level-jump a[href="#lo-trinh-tc3"]');
    await page.goBack(); await page.waitForTimeout(400);
    const h = await page.evaluate(() => location.hash);
    assert(h === '#/so-cau-sai', 'Back về ' + h);
  });

  await tc('T04', 'Giữ tab khi F5 và khi vào bài rồi bấm Back: đang ở tab Sơ cấp 2 → mở bài SC2 Bài 3 → Back vẫn là tab Sơ cấp 2; F5 vẫn tab Sơ cấp 2', async () => {
    await go(page, '#/');
    await page.waitForSelector('.level-jump');
    await page.click('.level-jump a[href="#lo-trinh-sc2"]');
    await page.click('a[href="#/bai/sc2-03"]');
    await page.waitForSelector('.lesson-hero');
    await page.goBack();
    await page.waitForSelector('.level-jump'); await page.waitForTimeout(300);
    let st = await tabState(page);
    assert(st.sel.join() === 'sc2' && st.shown.join() === 'lo-trinh-sc2', 'sau Back: ' + st.sel + ' ' + st.shown);
    const top = await page.$eval('#lo-trinh', (e) => e.getBoundingClientRect().top);
    assert(top > -10 && top < 200, 'sau Back thanh tab cách đỉnh ' + top + 'px');
    await page.reload(); await page.waitForSelector('.level-jump'); await page.waitForTimeout(300);
    st = await tabState(page);
    assert(st.sel.join() === 'sc2' && st.links.join(',') === SC2.join(','), 'sau F5: ' + st.sel);
  });

  await tc('T05', 'Mở thẳng link chia sẻ #lo-trinh-tc3 → tab Trung cấp 3 được chọn, thanh tab nằm đầu màn hình; hash lạ #lo-trinh-xyz → về mặc định Sơ cấp 1', async () => {
    await go(page, '#lo-trinh-tc3');
    await page.waitForSelector('.level-jump'); await page.waitForTimeout(400);
    let st = await tabState(page);
    assert(st.sel.join() === 'tc3' && st.shown.join() === 'lo-trinh-tc3', JSON.stringify(st).slice(0, 160));
    const top = await page.$eval('#lo-trinh', (e) => e.getBoundingClientRect().top);
    assert(top > -10 && top < 200, 'thanh tab cách đỉnh ' + top + 'px');
    await go(page, '#lo-trinh-xyz');
    await page.waitForSelector('.level-jump'); await page.waitForTimeout(300);
    st = await tabState(page);
    assert(st.sel.join() === 'sc1' && st.shown.join() === 'lo-trinh-sc1', 'hash lạ: ' + st.sel);
  });

  await tc('T06', 'Đường dẫn trang bài có link về đúng tab cấp (SC2 Bài 1 → "Sơ cấp 2" mở tab Sơ cấp 2); phím mũi tên trái/phải chuyển tab', async () => {
    await go(page, '#/bai/sc2-01');
    await page.waitForSelector('.crumbs a[href="#lo-trinh-sc2"]');
    await page.click('.crumbs a[href="#lo-trinh-sc2"]');
    await page.waitForSelector('.level-jump'); await page.waitForTimeout(300);
    let st = await tabState(page);
    assert(st.sel.join() === 'sc2', 'crumb mở tab ' + st.sel);
    await page.focus('.level-jump a[data-level="sc2"]');
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
    st = await tabState(page);
    assert(st.sel.join() === 'tc3', 'ArrowRight → ' + st.sel);
    await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
    st = await tabState(page);
    assert(st.sel.join() === 'sc1', 'ArrowRight vòng về → ' + st.sel);
    await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(200);
    st = await tabState(page);
    assert(st.sel.join() === 'tc3', 'ArrowLeft → ' + st.sel);
  });

  await tc('T07', 'Nút "Xem lộ trình" vẫn cuộn tới thanh tab (giữ hành vi cũ), tab đang chọn không đổi', async () => {
    await go(page, '#/');
    await page.waitForSelector('.hero-actions');
    await page.click('.hero-actions a[href="#lo-trinh"]');
    await page.waitForTimeout(1200);
    const y = await page.evaluate(() => window.scrollY);
    assert(y > 200, '"Xem lộ trình" không cuộn, scrollY=' + y);
    const st = await tabState(page);
    assert(st.sel.join() === 'sc1', 'tab ' + st.sel);
  });

  await tc('N14', 'Tên bài Trung cấp 3 và Sơ cấp 2 có ghi cấp (tiêu đề tab, đường dẫn) để không nhầm với bài cùng số; tên bài Sơ cấp 1 giữ nguyên', async () => {
    await go(page, '#/bai/tc3-01');
    await page.waitForSelector('.lesson-hero h1');
    assert((await page.title()) === 'Trung cấp 3 · Bài 1: Đời sống học đường – Hana Dul', await page.title());
    assert(/Trung cấp 3/.test(await page.$eval('.crumbs', (e) => e.innerText)), 'đường dẫn thiếu Trung cấp 3');
    await go(page, '#/bai/sc2-01');
    await page.waitForSelector('.lesson-hero h1');
    const t = await page.title();
    assert(t === 'Sơ cấp 2 · Bài 1: Gặp gỡ – Hana Dul', t);
    const crumbs = await page.$eval('.crumbs', (e) => e.innerText);
    assert(/Sơ cấp 2/.test(crumbs), crumbs);
    await go(page, '#/bai/sc1-01');
    await page.waitForSelector('.lesson-hero h1');
    assert((await page.title()) === 'Bài 1: Giới thiệu – Hana Dul', await page.title());
  });

  for (const id of NEW) {
    await tc(`N07-${id.slice(-2)}`, `Trang học ${lname(id)}: tiêu đề, đủ nhóm từ, ghi chú đủ các mẫu ngữ pháp, mục viết điền ㉠㉡ (4 ô), nút Làm bài, không lỗi JS`, async () => {
      page.errors = [];
      await go(page, `#/bai/${id}`);
      await page.waitForSelector('.lesson-hero h1');
      const d = DATA[id];
      const h1 = await page.$eval('.lesson-hero h1', (e) => e.innerText);
      assert(h1.includes(d.title), h1);
      const body = await page.evaluate(() => document.body.innerText);
      d.vocab.forEach((g) => assert(body.includes(g.group), 'thiếu nhóm ' + g.group));
      d.grammar.forEach((g) => assert(body.includes(g.title), 'thiếu mẫu ' + g.pattern));
      assert(body.includes('Viết điền ㉠, ㉡'), 'thiếu mục viết điền ㉠㉡');
      assert((await page.$$('.fill-in')).length === 4, 'cần 4 ô viết điền');
      assert(await page.$(`a[href="#/bai/${id}/lam-bai"]`), 'thiếu nút Làm bài');
      assert(!page.errors.length, page.errors.join('; '));
    });
  }

  for (const id of NEW) {
    await tc(`N08-${id.slice(-2)}`, `${lname(id)} – Ôn đầy đủ: làm hết (gồm 10 câu TOPIK), trả lời đúng hết → 100%, đúng số câu đã báo, có ô luyện viết + viết điền, nút bài tiếp theo đúng`, async () => {
      page.errors = [];
      const n = await startMode(page, id, 'full');
      const r = await playQuiz(page);
      assert(!r.unknown.length, 'không tra được đáp án: ' + r.unknown.slice(0, 2).join(' | '));
      assert(r.first === n, `làm ${r.first} câu, nút báo ${n}`);
      assert(r.acc === '100%', 'chính xác ' + r.acc);
      assert(r.writing, 'thiếu ô luyện viết');
      assert(r.fill === 4, 'màn kết quả cần 4 ô viết điền, có ' + r.fill);
      const i = LESSONS.findIndex((l) => l.id === id);
      const nx = LESSONS[i + 1];
      if (nx) assert(r.nextHref === `#/bai/${nx.id}`, 'nút tiếp theo ' + r.nextHref);
      else assert(r.nextHref === '#/', 'bài cuối phải về trang chủ, đang là ' + r.nextHref);
      assert(!page.errors.length, page.errors.join('; '));
      return `${n} câu`;
    });
  }

  for (const id of NEW) {
    await tc(`N09-${id.slice(-2)}`, `${lname(id)} – Luyện nhanh: số câu đúng như nút báo (10 từ + 3 câu từ trong câu + 2 câu/mẫu + 3 nghe + 2 đọc + 1 câu mỗi dạng TOPIK × 6)`, async () => {
      const n = await startMode(page, id, 'quick');
      const expect = 10 + 3 + 2 * DATA[id].grammar.length + 3 + 2 + 6;
      assert(n === expect, `nút báo ${n}, cần ${expect}`);
      const r = await playQuiz(page);
      assert(r.first === n && r.acc === '100%', `${r.first} câu, ${r.acc}`);
      return `${n} câu`;
    });
  }

  await tc('N10', 'TC3 Bài 8 – Ôn đầy đủ: gặp đủ 6 nhãn dạng TOPIK; câu nghe thường đọc đúng câu; hội thoại tự đọc ≥4 lượt với 2 giọng khác nhau, hiện lời thoại + bản dịch; sắp xếp câu hiện 4 dòng (가)(나)(다)(라); nghĩa gần nhất có gạch chân; thông báo/đoạn văn có bản dịch', async () => {
    const d = DATA['tc3-08'];
    await startMode(page, 'tc3-08', 'full');
    const tags = new Set(); let sawListen = false, sawDialog = false, sawOrder = false, sawU = false, sawNotice = false;
    for (let k = 0; k < 200 && !(await page.$('.result-grid')); k++) {
      await page.waitForSelector('.opt');
      await page.evaluate(() => { window.__spoken = []; });
      const tag = await page.$eval('.qsection', (e) => e.innerText);
      TOPIK_TAGS.forEach((t) => { if (tag.includes(t)) tags.add(t); });
      const info = await page.evaluate(() => ({ q: (document.querySelector('.qtext > span') || {}).innerText || '', listen: (document.querySelector('.listen-box .play') || { getAttribute: () => '' }).getAttribute('data-say') || '', passage: (document.querySelector('.passage') || {}).innerText || '', options: [...document.querySelectorAll('.opt')].map((b) => b.querySelector('span:last-child').innerText) }));
      const lines = await page.$eval('.listen-box .play', (e) => e.getAttribute('data-lines')).catch(() => null);
      if (tag.includes('Nghe hội thoại')) {
        sawDialog = true;
        assert(lines && JSON.parse(lines).length >= 4, 'nút loa thiếu lời thoại');
        await page.click('.listen-box .play');
        const sp = await page.evaluate(() => window.__spoken);
        assert(sp.length >= 4, 'chỉ đọc ' + sp.length + ' lượt');
        assert(new Set(sp.map((x) => x.pitch)).size === 2, 'không đổi giọng theo người nói');
      } else if (info.listen) { sawListen = true; assert(d.listening.some((l) => l.listen === info.listen), 'câu nghe lạ: ' + info.listen); }
      if (tag.includes('Sắp xếp câu')) { sawOrder = true; const ls = info.passage.split('\n').filter((x) => x.trim()); assert(ls.length === 4 && /^\(가\)/.test(ls[0]), 'đoạn sắp xếp: ' + ls.length + ' dòng'); }
      if (tag.includes('Nghĩa gần nhất')) { sawU = true; assert(await page.$('.qtext u'), 'thiếu gạch chân'); }
      await page.click(`.opt[data-o="${Math.max(0, pickAnswer(info))}"]`);
      if (tag.includes('Nghe hội thoại')) { assert(await page.$('.dialog-script'), 'không hiện lời thoại'); assert(await page.$('details.trans'), 'thiếu bản dịch hội thoại'); }
      if (tag.includes('Đọc thông báo') || tag.includes('Đọc đoạn văn') || tag.includes('Sắp xếp câu')) { sawNotice = true; assert(await page.$('details.trans'), 'thiếu bản dịch: ' + tag); }
      await page.click('#next');
    }
    assert(tags.size === 6, 'chỉ thấy nhãn: ' + [...tags].join(', '));
    assert(sawListen && sawDialog && sawOrder && sawU && sawNotice, 'thiếu dạng câu');
  });

  await tc('N11', 'TC3 Bài 9 – Luyện viết + viết điền ㉠㉡: gõ được lưu trên máy (cả khi tải lại trang học), nút Xem câu mẫu/Xem đáp án mẫu bật/tắt', async () => {
    await startMode(page, 'tc3-09', 'quick');
    await playQuiz(page);
    await page.fill('#wtext', '전에 살던 집에 비해서 작지만 햇빛이 잘 들어요.');
    await page.fill('.fill-in[data-i="0"][data-j="0"]', '죄송합니다');
    await page.waitForTimeout(800);
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('hanadul:v2')).writing);
    assert(st['tc3-09'] === '전에 살던 집에 비해서 작지만 햇빛이 잘 들어요.', 'chưa lưu luyện viết: ' + st['tc3-09']);
    assert(st['tc3-09#51-0-0'] === '죄송합니다', 'chưa lưu viết điền: ' + st['tc3-09#51-0-0']);
    await page.click('#wshow');
    assert(!(await page.$eval('#wsamples', (e) => e.hidden)), 'không mở câu mẫu');
    await page.click('.fill-show[data-i="0"]');
    assert(!(await page.$eval('.fill-ans[data-i="0"]', (e) => e.hidden)), 'không mở đáp án mẫu');
    const ans = await page.$eval('.fill-ans[data-i="0"]', (e) => e.innerText);
    assert(ans.includes('죄송합니다') && ans.includes('㉡'), 'đáp án mẫu thiếu: ' + ans.slice(0, 80));
    await page.click('.fill-show[data-i="0"]');
    assert(await page.$eval('.fill-ans[data-i="0"]', (e) => e.hidden), 'không ẩn đáp án mẫu');
    await go(page, '#/bai/tc3-09');
    await page.waitForSelector('.fill-in');
    const v = await page.$eval('.fill-in[data-i="0"][data-j="0"]', (e) => e.value);
    assert(v === '죄송합니다', 'tải lại không còn câu đã viết: ' + v);
  });

  await tc('N15', 'Sổ câu sai với câu TOPIK: sai câu điền chỗ trống và câu hội thoại ở TC3 Bài 7 → sổ ghi "Trung cấp 3 · Bài 7: Tính cách · 2 câu", câu hội thoại hiện 🎧; ôn lại được (có đoạn hội thoại) và đúng 2 lần thì sổ trống', async () => {
    await go(page, '#/');
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('hanadul:v2')) || {}; s.wrong = {}; localStorage.setItem('hanadul:v2', JSON.stringify(s)); });
    const q0 = 10 + 3 + 2 * DATA['tc3-07'].grammar.length + 3 + 2; // vị trí câu TOPIK đầu tiên trong Luyện nhanh
    await startMode(page, 'tc3-07', 'quick'); await playQuiz(page, { wrong: [q0, q0 + 5] });
    await go(page, '#/so-cau-sai');
    await page.waitForSelector('#startReview');
    const groups = await page.$$eval('.wb-group summary', (els) => els.map((e) => e.innerText));
    assert(groups.length === 1 && /Trung cấp 3 · Bài 7: Tính cách · 2 câu/.test(groups[0]), groups.join(' / '));
    const items = await page.$$eval('.wb-q', (els) => els.map((e) => e.textContent.trim()));
    assert(items.some((t) => t.startsWith('🎧')), 'câu hội thoại không có 🎧: ' + items.join(' | '));
    const st = await page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('hanadul:v2')).wrong).map((e) => e.item));
    assert(st.every((it) => it.kind === 'topik' && it.ttype), 'thiếu dạng câu trong sổ');
    assert(st.some((it) => it.lines && it.lines.length >= 4), 'sổ không lưu lời thoại');
    for (let round = 0; round < 2; round++) {
      await go(page, '#/so-cau-sai');
      await page.waitForSelector('#startReview');
      await page.click('#startReview');
      const r = await playQuiz(page);
      assert(!r.unknown.length, 'không tra được đáp án ôn');
    }
    await go(page, '#/so-cau-sai');
    await page.waitForSelector('.panel h2');
    const h2 = await page.$eval('.panel h2', (e) => e.innerText);
    assert(/Sổ đang trống/.test(h2), h2);
  });

  await tc('N16', 'Trang giới thiệu: mục Trung cấp trên lộ trình chuyển sang "Đang mở 9 bài"', async () => {
    await page.goto(BASE + 'gioi-thieu.html');
    await page.waitForFunction(() => document.querySelector('[data-fill="tc3"]').textContent === 'Đang mở 9 bài', null, { timeout: 4000 });
  });

  // ================= HỒI QUY =================
  for (const id of OLD) {
    await tc(`R01-${id.startsWith('sc1') ? '' : id.slice(0, 4)}${id.slice(-2)}`, `Hồi quy ${id === 'sc1-00' ? 'Hangeul' : id.startsWith('sc1') ? 'Bài ' + (+id.slice(-2)) : lname(id)} – Ôn đầy đủ vẫn làm hết, 100%, không lỗi JS`, async () => {
      page.errors = [];
      const n = await startMode(page, id, 'full');
      const r = await playQuiz(page);
      assert(!r.unknown.length, 'không tra được đáp án: ' + r.unknown.slice(0, 2).join(' | '));
      assert(r.first === n && r.acc === '100%', `${r.first}/${n} câu, ${r.acc}`);
      assert(!page.errors.length, page.errors.join('; '));
      if (id === 'sc1-15') assert(r.nextHref === '#/bai/sc2-01', 'Bài 15 Sơ cấp 1 phải dẫn sang Bài 1 Sơ cấp 2, đang là ' + r.nextHref);
      if (id === 'sc2-08') assert(r.nextHref === '#/bai/sc2-09', 'SC2 Bài 8 phải dẫn sang Bài 9, đang là ' + r.nextHref);
      if (id === 'sc2-12') assert(r.nextHref === '#/bai/sc2-13', 'SC2 Bài 12 phải dẫn sang Bài 13, đang là ' + r.nextHref);
      if (id === 'sc2-15') assert(r.nextHref === '#/bai/tc3-01', 'SC2 Bài 15 phải dẫn sang Bài 1 Trung cấp 3, đang là ' + r.nextHref);
      if (id === 'tc3-03') assert(r.nextHref === '#/bai/tc3-04', 'TC3 Bài 3 phải dẫn sang Bài 4, đang là ' + r.nextHref);
      if (id === 'tc3-06') assert(r.nextHref === '#/bai/tc3-07', 'TC3 Bài 6 phải dẫn sang Bài 7, đang là ' + r.nextHref);
      if (DATA[id].fillWriting) assert((await page.$$('.fill-in')).length === 4, 'TC3 cũ phải còn 4 ô viết điền');
      else assert(!(await page.$('.fill-in')), 'bài không có viết điền thì không được có ô viết điền');
      return `${n} câu`;
    });
  }

  await tc('R02', 'Hồi quy Luyện nhanh bài cũ (Bài 8) vẫn đúng số câu và làm hết', async () => {
    const n = await startMode(page, 'sc1-08', 'quick');
    const r = await playQuiz(page);
    assert(r.first === n && r.acc === '100%', `${r.first}/${n}, ${r.acc}`);
  });

  await tc('R03', 'Tiến độ (sao, XP, chuỗi ngày) của bài cũ vẫn giữ sau khi làm bài mới; trang chủ gợi ý "Học tiếp"', async () => {
    const s = await page.evaluate(() => JSON.parse(localStorage.getItem('hanadul:v2')));
    ['sc1-01', 'sc1-11', 'sc1-15', 'sc2-01', 'sc2-04', 'sc2-08', 'sc2-09', 'sc2-12', 'sc2-13', 'sc2-15', 'tc3-01', 'tc3-02', 'tc3-03', 'tc3-04', 'tc3-05', 'tc3-06', 'tc3-07', 'tc3-08', 'tc3-09'].forEach((id) => assert(s.lessons[id] && s.lessons[id].best === 100, 'mất tiến độ ' + id));
    assert(s.xp > 0 && s.days.length >= 1, 'XP/ngày');
    await go(page, '#/');
    const t = await page.$eval('.hero-actions .btn', (e) => e.innerText);
    assert(/Học tiếp/.test(t), t);
  });

  await tc('R04', 'Sổ câu sai: sai 2 câu ở SC2 Bài 3 (mới) + 1 câu ở SC1 Bài 5 (cũ) → sổ nhóm đúng theo bài, tên bài SC2 có ghi cấp; ôn đúng 2 lần thì sổ trống', async () => {
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('hanadul:v2')); s.wrong = {}; localStorage.setItem('hanadul:v2', JSON.stringify(s)); });
    await startMode(page, 'sc2-03', 'quick'); await playQuiz(page, { wrong: [0, 5] });
    await startMode(page, 'sc1-05', 'quick'); await playQuiz(page, { wrong: [2] });
    await go(page, '#/so-cau-sai');
    await page.waitForSelector('#startReview');
    const groups = await page.$$eval('.wb-group summary', (els) => els.map((e) => e.innerText));
    assert(groups.some((g) => /Sơ cấp 2 · Bài 3: Mua sắm \(2\) · 2 câu/.test(g)), groups.join(' / '));
    assert(groups.some((g) => /^Bài 5: .* · 1 câu/.test(g.trim())), groups.join(' / '));
    for (let round = 0; round < 2; round++) {
      await go(page, '#/so-cau-sai');
      await page.waitForSelector('#startReview');
      await page.click('#startReview');
      const r = await playQuiz(page);
      assert(!r.unknown.length, 'không tra được đáp án ôn');
    }
    await go(page, '#/so-cau-sai');
    await page.waitForSelector('.panel h2');
    const h2 = await page.$eval('.panel h2', (e) => e.innerText);
    assert(/Sổ đang trống/.test(h2), h2);
  });

  await tc('R05', 'Trang giới thiệu: đếm ' + TOTAL + ' bài đang mở, thẻ Sơ cấp 1 báo "Đủ 15 bài", thẻ Sơ cấp 2 báo "Đủ 15 bài", thẻ Trung cấp báo "Đang mở 9 bài", không lỗi JS', async () => {
    page.errors = [];
    await page.goto(BASE + 'gioi-thieu.html');
    await page.waitForFunction((n) => document.querySelector('[data-fill="lessons"]').textContent === String(n), TOTAL, { timeout: 4000 });
    const tag = await page.$eval('[data-fill="sc1"]', (e) => e.textContent);
    assert(tag === 'Đủ 15 bài', tag);
    const tag2 = await page.$eval('[data-fill="sc2"]', (e) => e.textContent);
    assert(tag2 === 'Đủ 15 bài', tag2);
    const tag3 = await page.$eval('[data-fill="tc3"]', (e) => e.textContent);
    assert(tag3 === 'Đang mở 9 bài', tag3);
    assert(!page.errors.length, page.errors.join('; '));
  });

  await tc('R06', 'Trang chính sách bảo mật và 404 vẫn mở được, không lỗi JS', async () => {
    page.errors = [];
    for (const p of ['chinh-sach-bao-mat.html', '404.html']) {
      const resp = await page.goto(BASE + p);
      assert(resp.ok(), p + ' ' + resp.status());
      assert((await page.title()).length, p + ' thiếu title');
    }
    assert(!page.errors.length, page.errors.join('; '));
  });

  await ctx.close();

  // ---- điện thoại ----
  const mob = await newPage(browser, { viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  await tc('T08', 'Điện thoại 375px: 3 tab nằm trọn trên một hàng (không bị cắt), không tràn trang, chạm tab Sơ cấp 2 đổi danh sách và không cuộn trang', async () => {
    const p = mob.page;
    await go(p, '#/'); await p.waitForSelector('.level-jump');
    await p.waitForTimeout(400);
    // Cuộn tức thì (trang dùng scroll-behavior: smooth; cuộn mượt chưa xong thì đo sai).
    await p.$eval('#lo-trinh', (e) => e.scrollIntoView({ block: 'start', behavior: 'instant' }));
    await p.waitForTimeout(400);
    const tops = await p.$$eval('.level-jump a', (els) => els.map((a) => Math.round(a.getBoundingClientRect().top)));
    assert(new Set(tops).size === 1, 'tab xuống dòng: ' + tops.join(','));
    const rights = await p.$$eval('.level-jump a', (els) => els.map((a) => Math.round(a.getBoundingClientRect().right)));
    assert(rights.every((r) => r <= 375), 'tab bị cắt ngoài màn hình: ' + rights.join(','));
    assert(await noHScroll(p), 'trang tràn ngang');
    const y0 = await p.evaluate(() => window.scrollY);
    assert(y0 > 100, 'chưa cuộn tới thanh tab, scrollY=' + y0);
    // Chạm thật vào toạ độ tab (p.tap của Playwright tự cuộn phần tử vào giữa màn hình nên không dùng).
    const pt = await p.$eval('.level-jump a[href="#lo-trinh-sc2"]', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await p.touchscreen.tap(pt[0], pt[1]); await p.waitForTimeout(500);
    const st = await tabState(p);
    assert(st.sel.join() === 'sc2' && st.links.join(',') === SC2.join(','), 'tab ' + st.sel);
    assert(Math.abs(st.y - y0) < 20, 'bị cuộn ' + y0 + ' → ' + st.y);
  });
  await tc('R07', 'Điện thoại 375px: trang chủ (3 khối cấp độ), trang học (gồm ô viết điền) và màn làm bài TC3 Bài 7–9 (gồm câu TOPIK có đoạn văn, hội thoại) + SC2 Bài 15 + SC1 Bài 1 không tràn ngang', async () => {
    const bad = [];
    const p = mob.page;
    await go(p, '#/'); await p.waitForSelector('.hero'); if (!(await noHScroll(p))) bad.push('trang chủ');
    for (const id of ['sc1-01', 'sc2-15', ...NEW]) {
      await go(p, `#/bai/${id}`); await p.waitForSelector('.lesson-hero'); if (!(await noHScroll(p))) bad.push(id + ' học');
      await startMode(p, id, id.startsWith('tc3') ? 'quick' : 'full');
      for (let k = 0; k < 60 && !(await p.$('.result-grid')); k++) {
        await p.waitForSelector('.opt');
        if (!(await noHScroll(p))) { bad.push(id + ' làm bài: ' + (await p.$eval('.qtext', (e) => e.innerText))); break; }
        await p.click('.opt[data-o="0"]'); await p.click('#next');
      }
    }
    await p.goto(BASE + 'gioi-thieu.html'); if (!(await noHScroll(p))) bad.push('giới thiệu');
    assert(!bad.length, bad.join(', '));
  });
  await mob.ctx.close();

  // ---- giao diện tối ----
  const dark = await newPage(browser, { colorScheme: 'dark' });
  await tc('R08', 'Giao diện tối: trang chủ, trang học TC3 Bài 9 (có ô viết điền), màn làm bài và trang giới thiệu dùng nền tối, chữ sáng; ô viết điền nền tối', async () => {
    const p = dark.page; const bad = [];
    const lum = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    async function check(name) {
      const c = await p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color }));
      if (!(lum(c.bg) < 80 && lum(c.fg) > 150)) bad.push(`${name} bg=${c.bg} fg=${c.fg}`);
    }
    await go(p, '#/'); await p.waitForSelector('.hero'); await check('trang chủ');
    await go(p, '#/bai/tc3-09'); await p.waitForSelector('.lesson-hero'); await check('TC3 Bài 9');
    const fb = await p.$eval('.fill-in', (e) => getComputedStyle(e).backgroundColor);
    if (!(lum(fb) < 80)) bad.push('ô viết điền bg=' + fb);
    await startMode(p, 'tc3-09', 'quick'); await p.waitForSelector('.opt'); await check('làm bài');
    await p.goto(BASE + 'gioi-thieu.html'); await check('giới thiệu');
    assert(!bad.length, bad.join('; '));
  });
  await dark.ctx.close();

  await browser.close();
  fs.writeFileSync(path.join(__dirname, 'ket-qua.json'), JSON.stringify(results, null, 2));
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${results.length - fail}/${results.length} PASS`);
  process.exit(fail ? 1 : 0);
})();
