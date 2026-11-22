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
const NEW = ['sc2-09', 'sc2-10', 'sc2-11', 'sc2-12'];
const SC2 = idx.levels.find((lv) => lv.id === 'sc2').lessons.map((l) => l.id);
const TOTAL = LESSONS.length; // 16 bài Sơ cấp 1 (gồm Hangeul) + 12 bài Sơ cấp 2
const lname = (id) => 'Sơ cấp 2 Bài ' + (+id.slice(-2));
const OLD = LESSONS.map((l) => l.id).filter((id) => !NEW.includes(id));

// ---- đáp án đúng, tra từ dữ liệu ----
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const ANS = {}; // khóa (câu hỏi hoặc câu nghe) -> tập đáp án đúng
const PAIRS = []; // [ko, vi, lid]
function addAns(k, a) { k = norm(k); (ANS[k] = ANS[k] || new Set()).add(norm(a)); }
Object.values(DATA).forEach((d) => {
  (d.vocab || []).forEach((g) => g.words.forEach((w) => PAIRS.push([norm(w[0]), norm(w[1])])));
  (d.grammar || []).forEach((g) => g.questions.forEach((q) => addAns(q.q, q.options[0])));
  (d.usage || []).forEach((q) => addAns(q.q, q.options[0]));
  (d.listening || []).forEach((q) => addAns(q.listen, q.options[0]));
  if (d.reading) d.reading.questions.forEach((q) => addAns(d.reading.passage + '|' + q.q, q.options[0]));
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
  await ctx.route(/^(?!http:\/\/127\.0\.0\.1).*/, (r) => r.abort()); // không gọi ra ngoài (GA, font)
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

  await tc('N02', 'SC2 Bài 9–12 soạn đủ phần: ≥35 từ, ≥8 câu từ trong câu, 3–4 mẫu ngữ pháp ≥5 câu/mẫu, 5 câu nghe, đọc hiểu 2 câu, luyện viết', async () => {
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
      notes.push(`${id}: ${nw} từ`);
    });
    return notes.join(', ');
  });

  await tc('N03', 'Từ vựng SC2 Bài 9–12 không lặp lại từ của Sơ cấp 1 (Hangeul + 15 bài), SC2 Bài 1–8 và không lặp giữa 4 bài mới', async () => {
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

  await tc('N05', 'index.json: Sơ cấp 1 giữ nguyên 0→15; có cấp Sơ cấp 2 riêng gồm Bài 1→12, mỗi bài có tên, chữ Hàn, tóm tắt ngữ pháp, icon', async () => {
    assert(idx.levels.length === 2 && idx.levels[0].id === 'sc1' && idx.levels[1].id === 'sc2', idx.levels.map((l) => l.id).join(','));
    const n1 = idx.levels[0].lessons.map((l) => l.no).join(',');
    assert(n1 === '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15', 'SC1 ' + n1);
    const n2 = idx.levels[1].lessons.map((l) => l.id + ':' + l.no).join(',');
    assert(n2 === 'sc2-01:1,sc2-02:2,sc2-03:3,sc2-04:4,sc2-05:5,sc2-06:6,sc2-07:7,sc2-08:8,sc2-09:9,sc2-10:10,sc2-11:11,sc2-12:12', 'SC2 ' + n2);
    NEW.forEach((id) => { const l = LESSONS.find((x) => x.id === id); assert(l.title && l.ko && l.summary && l.icon, id); });
  });

  await tc('N06', 'Trang chủ: đếm "' + TOTAL + ' bài học", hiện link Bài 9–12 Sơ cấp 2', async () => {
    await go(page, '#/');
    await page.waitForSelector('.hero-facts');
    const facts = await page.$eval('.hero-facts', (e) => e.innerText);
    assert(new RegExp(TOTAL + '\\s*bài học').test(facts), facts);
    for (const id of NEW) assert(await page.$(`a[href="#/bai/${id}"]`), 'thiếu link ' + id);
  });

  await tc('N12', 'Lộ trình tách rõ 2 cấp: 2 khối riêng (Sơ cấp 1 trước, Sơ cấp 2 sau), mỗi khối chỉ chứa bài của cấp đó, có nhãn "Cấp 1/Cấp 2", đếm x/16 và x/12, ô "Bài tiếp theo" chỉ ở cuối Sơ cấp 2', async () => {
    await go(page, '#/');
    await page.waitForSelector('.level');
    const lv = await page.$$eval('.level', (els) => els.map((e) => ({
      id: e.id, h2: e.querySelector('h2').innerText, badge: e.querySelector('.level-badge').innerText,
      prog: e.querySelector('.level-progress').innerText,
      links: [...e.querySelectorAll('a.node')].map((a) => a.getAttribute('href').replace('#/bai/', '')),
      soon: !!e.querySelector('.soon'),
    })));
    assert(lv.length === 2, lv.length + ' khối');
    assert(lv[0].id === 'lo-trinh-sc1' && lv[0].h2 === 'Sơ cấp 1' && /Cấp 1/.test(lv[0].badge), JSON.stringify(lv[0]).slice(0, 120));
    assert(lv[1].id === 'lo-trinh-sc2' && lv[1].h2 === 'Sơ cấp 2' && /Cấp 2/.test(lv[1].badge), JSON.stringify(lv[1]).slice(0, 120));
    assert(lv[0].links.length === 16 && lv[0].links.every((x) => x.startsWith('sc1-')), 'khối SC1: ' + lv[0].links.join(','));
    assert(lv[1].links.join(',') === SC2.join(',') && SC2.length === 12, 'khối SC2: ' + lv[1].links.join(','));
    assert(/\/16 bài/.test(lv[0].prog) && /\/12 bài/.test(lv[1].prog), lv[0].prog + ' | ' + lv[1].prog);
    assert(!lv[0].soon && lv[1].soon, 'ô Bài tiếp theo sai chỗ');
    const ids = await page.$$eval('[id]', (els) => els.map((e) => e.id));
    assert(ids.filter((x) => x === 'lo-trinh').length === 1, 'id lo-trinh bị trùng');
  });

  await tc('N13', 'Nút chọn cấp và nút "Xem lộ trình" cuộn tới đúng khối (không nhảy về đầu trang)', async () => {
    await go(page, '#/');
    await page.waitForSelector('.level-jump');
    const chips = await page.$$eval('.level-jump a', (els) => els.map((a) => a.innerText.trim() + '|' + a.getAttribute('href')));
    assert(chips.length === 2 && /Sơ cấp 1\|#lo-trinh-sc1/.test(chips[0]) && /Sơ cấp 2\|#lo-trinh-sc2/.test(chips[1]), chips.join(' / '));
    await page.click('.level-jump a[href="#lo-trinh-sc2"]');
    await page.waitForTimeout(1200);
    const top2 = await page.$eval('#lo-trinh-sc2', (e) => e.getBoundingClientRect().top);
    assert(top2 > -10 && top2 < 200, 'khối SC2 cách đỉnh ' + top2 + 'px');
    // Mở thẳng link #lo-trinh-sc2 (chia sẻ link) cũng tới đúng khối
    await page.goto(BASE + 'index.html#lo-trinh-sc2'); await page.reload();
    await page.waitForSelector('#lo-trinh-sc2'); await page.waitForTimeout(600);
    const top3 = await page.$eval('#lo-trinh-sc2', (e) => e.getBoundingClientRect().top);
    assert(top3 > -10 && top3 < 200, 'mở link trực tiếp: khối SC2 cách đỉnh ' + top3 + 'px');
    await go(page, '#/');
    await page.waitForSelector('.hero-actions');
    await page.click('.hero-actions a[href="#lo-trinh"]');
    await page.waitForTimeout(1200);
    const y = await page.evaluate(() => window.scrollY);
    assert(y > 200, '"Xem lộ trình" không cuộn, scrollY=' + y);
  });

  await tc('N14', 'Tên bài Sơ cấp 2 có ghi cấp (tiêu đề tab, đường dẫn) để không nhầm với bài cùng số Sơ cấp 1; tên bài Sơ cấp 1 giữ nguyên', async () => {
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
    await tc(`N07-${id.slice(-2)}`, `Trang học ${lname(id)}: tiêu đề, đủ nhóm từ, ghi chú đủ các mẫu ngữ pháp, nút Làm bài, không lỗi JS`, async () => {
      page.errors = [];
      await go(page, `#/bai/${id}`);
      await page.waitForSelector('.lesson-hero h1');
      const d = DATA[id];
      const h1 = await page.$eval('.lesson-hero h1', (e) => e.innerText);
      assert(h1.includes(d.title), h1);
      const body = await page.evaluate(() => document.body.innerText);
      d.vocab.forEach((g) => assert(body.includes(g.group), 'thiếu nhóm ' + g.group));
      d.grammar.forEach((g) => assert(body.includes(g.title), 'thiếu mẫu ' + g.pattern));
      assert(await page.$(`a[href="#/bai/${id}/lam-bai"]`), 'thiếu nút Làm bài');
      assert(!page.errors.length, page.errors.join('; '));
    });
  }

  for (const id of NEW) {
    await tc(`N08-${id.slice(-2)}`, `${lname(id)} – Ôn đầy đủ: làm hết, trả lời đúng hết → 100%, đúng số câu đã báo, có ô luyện viết, nút bài tiếp theo đúng`, async () => {
      page.errors = [];
      const n = await startMode(page, id, 'full');
      const r = await playQuiz(page);
      assert(!r.unknown.length, 'không tra được đáp án: ' + r.unknown.slice(0, 2).join(' | '));
      assert(r.first === n, `làm ${r.first} câu, nút báo ${n}`);
      assert(r.acc === '100%', 'chính xác ' + r.acc);
      assert(r.writing, 'thiếu ô luyện viết');
      const i = LESSONS.findIndex((l) => l.id === id);
      const nx = LESSONS[i + 1];
      if (nx) assert(r.nextHref === `#/bai/${nx.id}`, 'nút tiếp theo ' + r.nextHref);
      else assert(r.nextHref === '#/', 'bài cuối phải về trang chủ, đang là ' + r.nextHref);
      assert(!page.errors.length, page.errors.join('; '));
      return `${n} câu`;
    });
  }

  for (const id of NEW) {
    await tc(`N09-${id.slice(-2)}`, `${lname(id)} – Luyện nhanh: số câu đúng như nút báo (10 từ + 3 câu từ trong câu + 2 câu/mẫu + 3 nghe + 2 đọc)`, async () => {
      const n = await startMode(page, id, 'quick');
      const expect = 10 + 3 + 2 * DATA[id].grammar.length + 3 + 2;
      assert(n === expect, `nút báo ${n}, cần ${expect}`);
      const r = await playQuiz(page);
      assert(r.first === n && r.acc === '100%', `${r.first} câu, ${r.acc}`);
      return `${n} câu`;
    });
  }

  await tc('N10', 'Câu nghe (SC2 Bài 10) có nút loa đọc đúng câu; câu đọc hiểu hiện đoạn văn và bản dịch sau khi trả lời', async () => {
    await page.evaluate(() => {});
    const d = DATA['sc2-10'];
    await startMode(page, 'sc2-10', 'full');
    let sawListen = false, sawRead = false;
    for (let k = 0; k < 160 && !(await page.$('.result-grid')); k++) {
      await page.waitForSelector('.opt');
      const say = await page.$eval('.listen-box .play', (e) => e.getAttribute('data-say')).catch(() => null);
      const passage = await page.$eval('.passage', (e) => e.innerText).catch(() => null);
      const info = await page.evaluate(() => ({ q: (document.querySelector('.qtext > span') || {}).innerText || '', listen: (document.querySelector('.listen-box .play') || { getAttribute: () => '' }).getAttribute('data-say') || '', passage: (document.querySelector('.passage') || {}).innerText || '', options: [...document.querySelectorAll('.opt')].map((b) => b.querySelector('span:last-child').innerText) }));
      await page.click(`.opt[data-o="${Math.max(0, pickAnswer(info))}"]`);
      if (say) { sawListen = true; assert(d.listening.some((l) => l.listen === say), 'câu nghe lạ: ' + say); assert(await page.$('.transcript'), 'không hiện lời thoại'); }
      if (passage) { sawRead = true; assert(norm(passage) === norm(d.reading.passage), 'đoạn văn sai'); assert(await page.$('details.trans'), 'không có bản dịch'); }
      await page.click('#next');
    }
    assert(sawListen && sawRead, 'không gặp câu nghe/đọc');
  });

  await tc('N11', 'Luyện viết SC2 Bài 12: gõ câu được lưu trên máy, nút Xem câu mẫu bật/tắt', async () => {
    await startMode(page, 'sc2-12', 'quick');
    await playQuiz(page);
    await page.fill('#wtext', '도서관에서는 떠들면 안 돼요.');
    await page.waitForTimeout(800);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('hanadul:v2')).writing['sc2-12']);
    assert(saved === '도서관에서는 떠들면 안 돼요.', 'chưa lưu: ' + saved);
    await page.click('#wshow');
    assert(!(await page.$eval('#wsamples', (e) => e.hidden)), 'không mở câu mẫu');
    await page.click('#wshow');
    assert(await page.$eval('#wsamples', (e) => e.hidden), 'không ẩn câu mẫu');
  });

  // ================= HỒI QUY =================
  for (const id of OLD) {
    await tc(`R01-${id.startsWith('sc2') ? 'sc2-' : ''}${id.slice(-2)}`, `Hồi quy ${id === 'sc1-00' ? 'Hangeul' : id.startsWith('sc2') ? lname(id) : 'Bài ' + (+id.slice(-2))} – Ôn đầy đủ vẫn làm hết, 100%, không lỗi JS`, async () => {
      page.errors = [];
      const n = await startMode(page, id, 'full');
      const r = await playQuiz(page);
      assert(!r.unknown.length, 'không tra được đáp án: ' + r.unknown.slice(0, 2).join(' | '));
      assert(r.first === n && r.acc === '100%', `${r.first}/${n} câu, ${r.acc}`);
      assert(!page.errors.length, page.errors.join('; '));
      if (id === 'sc1-15') assert(r.nextHref === '#/bai/sc2-01', 'Bài 15 Sơ cấp 1 phải dẫn sang Bài 1 Sơ cấp 2, đang là ' + r.nextHref);
      if (id === 'sc2-08') assert(r.nextHref === '#/bai/sc2-09', 'SC2 Bài 8 phải dẫn sang Bài 9, đang là ' + r.nextHref);
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
    ['sc1-01', 'sc1-11', 'sc1-15', 'sc2-01', 'sc2-04', 'sc2-08', 'sc2-09', 'sc2-12'].forEach((id) => assert(s.lessons[id] && s.lessons[id].best === 100, 'mất tiến độ ' + id));
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

  await tc('R05', 'Trang giới thiệu: đếm ' + TOTAL + ' bài đang mở, thẻ Sơ cấp 1 báo "Đủ 15 bài", thẻ Sơ cấp 2 báo "Đang mở 12 bài", không lỗi JS', async () => {
    page.errors = [];
    await page.goto(BASE + 'gioi-thieu.html');
    await page.waitForFunction((n) => document.querySelector('[data-fill="lessons"]').textContent === String(n), TOTAL, { timeout: 4000 });
    const tag = await page.$eval('[data-fill="sc1"]', (e) => e.textContent);
    assert(tag === 'Đủ 15 bài', tag);
    const tag2 = await page.$eval('[data-fill="sc2"]', (e) => e.textContent);
    assert(tag2 === 'Đang mở 12 bài', tag2);
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
  await tc('R07', 'Điện thoại 375px: trang chủ (2 khối cấp độ), trang học và màn làm bài SC2 Bài 9–12 + SC2 Bài 1 + SC1 Bài 1 không tràn ngang', async () => {
    const bad = [];
    const p = mob.page;
    await go(p, '#/'); await p.waitForSelector('.hero'); if (!(await noHScroll(p))) bad.push('trang chủ');
    for (const id of ['sc1-01', 'sc2-01', ...NEW]) {
      await go(p, `#/bai/${id}`); await p.waitForSelector('.lesson-hero'); if (!(await noHScroll(p))) bad.push(id + ' học');
      await startMode(p, id, 'full');
      for (let k = 0; k < 40 && !(await p.$('.result-grid')); k++) {
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
  await tc('R08', 'Giao diện tối: trang chủ, trang học SC2 Bài 12, màn làm bài và trang giới thiệu dùng nền tối, chữ sáng', async () => {
    const p = dark.page; const bad = [];
    const lum = (rgb) => { const m = rgb.match(/\d+/g).map(Number); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
    async function check(name) {
      const c = await p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color }));
      if (!(lum(c.bg) < 80 && lum(c.fg) > 150)) bad.push(`${name} bg=${c.bg} fg=${c.fg}`);
    }
    await go(p, '#/'); await p.waitForSelector('.hero'); await check('trang chủ');
    await go(p, '#/bai/sc2-12'); await p.waitForSelector('.lesson-hero'); await check('SC2 Bài 12');
    await startMode(p, 'sc2-12', 'quick'); await p.waitForSelector('.opt'); await check('làm bài');
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
