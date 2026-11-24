// Kiểm thử trang tĩnh từng bài (bai/<id>/), sitemap và ô tra từ/ngữ pháp.
// Chạy: python3 -m http.server 8765 (ở thư mục gốc repo), rồi node tests/e2e_seo.js   (ONLY=S01,S05 chạy riêng)
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.BASE || 'http://localhost:8765/';
const SITE = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/site.json'), 'utf8')).url.replace(/\/$/, '');
const idx = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/index.json'), 'utf8'));
const ALL = idx.levels.flatMap((lv) => lv.lessons.map((l) => ({ lv, l, d: JSON.parse(fs.readFileSync(path.join(ROOT, 'data/lessons', l.id + '.json'), 'utf8')) })));
const ONLY = process.env.ONLY ? new RegExp('^(' + process.env.ONLY.split(',').join('|') + ')$') : null;

const results = [];
async function tc(id, title, fn) {
  if (ONLY && !ONLY.test(id)) return;
  const r = { id, title, status: 'PASS', note: '' };
  try { const n = await fn(); if (n) r.note = String(n); } catch (e) { r.status = 'FAIL'; r.note = (e && e.message || String(e)).split('\n')[0]; }
  results.push(r);
  console.log(`${r.status}  ${id}  ${title}${r.note ? '  — ' + r.note : ''}`);
}
function assert(c, m) { if (!c) throw new Error(m); }
const lname = (x) => x.lv.name + ' · ' + (x.l.no === '0' ? x.l.title : 'Bài ' + x.l.no + ': ' + x.l.title);

async function newPage(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 } }, opts));
  await require('./stub_third_party')(ctx);
  await ctx.route(/^(?!http:\/\/(localhost|127\.0\.0\.1)).*/, (r) => r.abort());
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) page.errors.push(m.text()); });
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch();
  const { ctx, page: p } = await newPage(browser);

  await tc('S01', `Mỗi bài (${ALL.length} bài) có trang tĩnh: tải được, title/description/canonical/h1 riêng, đủ từ vựng và mẫu ngữ pháp, JSON-LD hợp lệ, không lỗi JS`, async () => {
    const bad = []; const titles = new Set(); const descs = new Set();
    for (const x of ALL) {
      const res = await p.goto(BASE + 'bai/' + x.l.id + '/');
      if (res.status() !== 200) { bad.push(x.l.id + ' HTTP ' + res.status()); continue; }
      const info = await p.evaluate(() => ({
        title: document.title,
        desc: document.querySelector('meta[name=description]').content,
        canon: document.querySelector('link[rel=canonical]').href,
        h1: document.querySelector('h1').textContent,
        rows: document.querySelectorAll('.vtable tbody tr').length,
        gram: document.querySelectorAll('#ngu-phap .gnote').length,
        ex: document.querySelectorAll('#ngu-phap .ex li').length,
        ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
      }));
      const words = x.d.vocab.reduce((n, g) => n + g.words.length, 0);
      const gram = (x.d.grammar || []).length;
      const ex = (x.d.grammar || []).reduce((n, g) => n + (g.examples || []).length, 0);
      if (!info.title.includes(lname(x))) bad.push(x.l.id + ' title');
      if (info.desc.length < 80 || info.desc.length > 200) bad.push(x.l.id + ' desc dài ' + info.desc.length);
      if (info.canon !== SITE + '/bai/' + x.l.id + '/') bad.push(x.l.id + ' canonical ' + info.canon);
      if (!info.h1.includes(x.l.title) || !info.h1.includes(x.d.ko)) bad.push(x.l.id + ' h1');
      if (info.rows !== words) bad.push(`${x.l.id} từ ${info.rows}/${words}`);
      if (info.gram !== gram || info.ex !== ex) bad.push(`${x.l.id} ngữ pháp ${info.gram}/${gram}, ví dụ ${info.ex}/${ex}`);
      try { info.ld.forEach((s) => JSON.parse(s)); if (!info.ld.length) bad.push(x.l.id + ' thiếu JSON-LD'); } catch (e) { bad.push(x.l.id + ' JSON-LD lỗi'); }
      titles.add(info.title); descs.add(info.desc);
    }
    if (titles.size !== ALL.length) bad.push('title trùng');
    if (descs.size !== ALL.length) bad.push('description trùng');
    if (p.errors.length) bad.push('lỗi JS: ' + p.errors.join(' | '));
    assert(!bad.length, bad.slice(0, 6).join('; '));
  });

  await tc('S02', 'Nội dung bài nằm sẵn trong HTML (không cần JS): từ, nghĩa, mẫu ngữ pháp, ví dụ, bài đọc của SC2 Bài 5 có trong mã nguồn trang', async () => {
    const x = ALL.find((a) => a.l.id === 'sc2-05');
    const raw = await (await fetch(BASE + 'bai/sc2-05/')).text();
    const dec = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
    const text = dec(raw.replace(/<[^>]+>/g, ''));
    const need = [x.d.vocab[0].words[0][0], x.d.vocab[0].words[0][1], x.d.grammar[0].pattern, x.d.grammar[0].examples[0][0], x.d.reading.passage.slice(0, 20)];
    const miss = need.filter((s) => !text.includes(s));
    assert(!miss.length, 'thiếu: ' + miss.join(' | '));
  });

  await tc('S03', 'Nút "Làm bài" trên trang tĩnh mở đúng màn làm bài trong trang học; nút "Nghe phát âm" mở trang học của bài; bài trước/sau trỏ đúng', async () => {
    await p.goto(BASE + 'bai/sc1-05/');
    await p.click('.cta-bar.top a.btn:not(.ghost)');
    await p.waitForSelector('.mode-card, .opt, [data-mode]', { timeout: 5000 });
    assert(/#\/bai\/sc1-05\/lam-bai$/.test(p.url()), 'url ' + p.url());
    await p.goto(BASE + 'bai/sc1-05/');
    await p.click('.cta-bar.top a.btn.ghost');
    await p.waitForSelector('#vocab .wcard');
    assert(/#\/bai\/sc1-05$/.test(p.url()), 'url ' + p.url());
    await p.goto(BASE + 'bai/sc1-15/');
    const prev = await p.getAttribute('.pager .prev', 'href'); const next = await p.getAttribute('.pager .next', 'href');
    assert(prev === '../sc1-14/' && next === '../sc2-01/', `prev=${prev} next=${next}`);
    await p.goto(BASE + 'bai/sc1-00/');
    assert(!(await p.$('.pager .prev')), 'bài đầu có nút bài trước');
  });

  await tc('S04', `Trang /bai/ liệt kê đủ ${ALL.length} bài theo cấp, mọi link mở được`, async () => {
    await p.goto(BASE + 'bai/');
    const links = await p.$$eval('.lesson-list a', (as) => as.map((a) => a.href));
    assert(links.length === ALL.length, 'số bài ' + links.length);
    for (const l of links) { const r = await fetch(l); if (r.status !== 200) throw new Error(l + ' ' + r.status); }
    const lv = await p.$$eval('.lv h2', (h) => h.length);
    assert(lv === idx.levels.length, 'số cấp ' + lv);
  });

  await tc('S05', 'sitemap.xml có trang chủ, giới thiệu, /bai/ và đủ trang bài, cùng một tên miền (data/site.json); robots.txt trỏ tới sitemap', async () => {
    const xml = await (await fetch(BASE + 'sitemap.xml')).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const need = [SITE + '/', SITE + '/gioi-thieu.html', SITE + '/bai/', ...ALL.map((x) => SITE + '/bai/' + x.l.id + '/')];
    const miss = need.filter((u) => !locs.includes(u));
    assert(!miss.length, 'thiếu ' + miss.slice(0, 3).join(', '));
    assert(locs.every((u) => u.startsWith(SITE + '/')), 'có link khác tên miền');
    assert(new Set(locs).size === locs.length, 'trùng link');
    const rb = await (await fetch(BASE + 'robots.txt')).text();
    assert(rb.includes('Sitemap: ' + SITE + '/sitemap.xml'), 'robots: ' + rb);
  });

  await tc('S06', 'Bài mới tự có trang: thêm 1 bài giả vào bản sao dữ liệu, chạy script → có bai/<id>/, có trong sitemap, /bai/ và chỉ mục tra cứu; --check báo lệch khi chưa chạy lại', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hd-build-'));
    fs.cpSync(path.join(ROOT, 'data'), path.join(tmp, 'data'), { recursive: true });
    fs.mkdirSync(path.join(tmp, 'tools'));
    fs.copyFileSync(path.join(ROOT, 'tools/build_pages.py'), path.join(tmp, 'tools/build_pages.py'));
    const py = (args) => execFileSync('python3', [path.join(tmp, 'tools/build_pages.py'), ...args], { encoding: 'utf8' });
    py([]);
    py(['--check']);
    const ix = JSON.parse(fs.readFileSync(path.join(tmp, 'data/index.json'), 'utf8'));
    const src = JSON.parse(fs.readFileSync(path.join(tmp, 'data/lessons/tc3-01.json'), 'utf8'));
    src.id = 'tc3-99'; src.ko = '시험용'; src.vocab = [{ group: 'Thử', words: [['시험용단어', 'từ thử nghiệm riêng']] }];
    fs.writeFileSync(path.join(tmp, 'data/lessons/tc3-99.json'), JSON.stringify(src));
    const prevId = ix.levels[ix.levels.length - 1].lessons.slice(-1)[0].id; // bài cuối hiện tại
    ix.levels[ix.levels.length - 1].lessons.push({ id: 'tc3-99', no: '99', title: 'Bài thử', ko: '시험용', summary: 'thử', icon: '🧪' });
    fs.writeFileSync(path.join(tmp, 'data/index.json'), JSON.stringify(ix));
    let stale = false;
    try { py(['--check']); } catch (e) { stale = /tc3-99/.test(e.stdout); }
    assert(stale, '--check không báo bài mới');
    py([]);
    assert(fs.existsSync(path.join(tmp, 'bai/tc3-99/index.html')), 'không có trang');
    assert(fs.readFileSync(path.join(tmp, 'sitemap.xml'), 'utf8').includes('/bai/tc3-99/'), 'sitemap thiếu');
    assert(fs.readFileSync(path.join(tmp, 'bai/index.html'), 'utf8').includes('href="tc3-99/"'), '/bai/ thiếu');
    assert(fs.readFileSync(path.join(tmp, 'data/search.json'), 'utf8').includes('시험용단어'), 'chỉ mục thiếu');
    assert(fs.readFileSync(path.join(tmp, 'bai/' + prevId + '/index.html'), 'utf8').includes('href="../tc3-99/"'), 'bài trước không trỏ sang bài mới');
    fs.rmSync(path.join(tmp, 'data/lessons/tc3-99.json'));
    ix.levels[ix.levels.length - 1].lessons.pop();
    fs.writeFileSync(path.join(tmp, 'data/index.json'), JSON.stringify(ix));
    py([]);
    assert(!fs.existsSync(path.join(tmp, 'bai/tc3-99')), 'bài bị xóa vẫn còn trang');
    fs.rmSync(tmp, { recursive: true, force: true });
    // Bản trong repo khớp dữ liệu.
    execFileSync('python3', [path.join(ROOT, 'tools/build_pages.py'), '--check']);
  });

  await tc('S07', 'Trang chủ: tra "학교" → kết quả đầu là 학교 (trường học); bấm → mở trang học bài đó, thẻ từ được cuộn tới và làm nổi bật', async () => {
    await p.goto(BASE + 'index.html#/'); await p.reload();
    await p.fill('.search-input', '학교');
    await p.waitForSelector('.sr-item');
    const first = await p.$eval('.sr-list:last-of-type .sr-item, .sr-item', (a) => a.textContent);
    const tItems = await p.$$eval('.sr-item[data-kind="t"]', (as) => as.map((a) => ({ t: a.textContent, h: a.getAttribute('href') })));
    assert(tItems[0].t.startsWith('학교trường học'), 'đầu tiên: ' + tItems[0].t + ' / ' + first);
    const n = await p.getAttribute('.sr-item[data-kind="t"]', 'data-n');
    await p.click('.sr-item[data-kind="t"]');
    await p.waitForSelector('#vocab .wcard.flash');
    const id = tItems[0].h.split('/').pop();
    assert(p.url().endsWith('#/bai/' + id), 'url ' + p.url());
    const fl = await p.$eval('#vocab .wcard.flash .w-ko', (e) => e.textContent);
    assert(fl === '학교', 'nổi bật: ' + fl);
    const idxN = await p.$$eval('#vocab .wcard', (cs) => cs.findIndex((c) => c.classList.contains('flash')) + 1);
    assert(String(idxN) === n, `thứ tự ${idxN} ≠ ${n}`);
    const inView = await p.$eval('#vocab .wcard.flash', (e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });
    assert(inView, 'thẻ không nằm trong màn hình');
  });

  await tc('S08', 'Tra tiếng Việt không dấu "truong hoc" → có 학교; tra mẫu ngữ pháp "으니까" ra -(으)니까, bấm → trang học cuộn tới đúng mẫu ngữ pháp', async () => {
    await p.goto(BASE + 'index.html#/'); await p.reload();
    await p.fill('.search-input', 'truong hoc');
    await p.waitForSelector('.sr-item');
    const t = await p.$$eval('.sr-item[data-kind="t"] .sr-ko', (e) => e.map((x) => x.textContent));
    assert(t[0] === '학교', 'không dấu: ' + t.slice(0, 3).join(','));
    await p.fill('.search-input', '으니까');
    await p.waitForFunction(() => document.querySelector('.sr-item[data-kind="g"]'));
    const g = await p.$eval('.sr-item[data-kind="g"]', (a) => ({ ko: a.querySelector('.sr-ko').textContent, h: a.getAttribute('href'), n: a.getAttribute('data-n') }));
    assert(g.ko.includes('(으)니까'), 'ngữ pháp: ' + g.ko);
    await p.click('.sr-item[data-kind="g"]');
    await p.waitForSelector('.gnote.flash');
    const fid = await p.$eval('.gnote.flash', (e) => e.id + '|' + e.querySelector('.gpat').textContent);
    assert(fid.startsWith('g' + g.n + '|') && fid.includes('(으)니까'), 'nổi bật ' + fid);
  });

  await tc('S09', 'Tra trên trang tĩnh: kết quả trỏ tới trang tĩnh bài kia (#t/#g), mở ra dòng đó được làm nổi bật; Enter mở kết quả đầu; Esc xóa; không có kết quả thì báo', async () => {
    await p.goto(BASE + 'bai/tc3-01/');
    await p.fill('.search-input', 'xyzxyz');
    await p.waitForSelector('.sr-empty');
    await p.press('.search-input', 'Escape');
    assert((await p.inputValue('.search-input')) === '' && (await p.$$('.search-results > *')).length === 0, 'Esc không xóa');
    await p.fill('.search-input', '학교');
    await p.waitForSelector('.sr-item');
    const h = await p.getAttribute('.sr-item', 'href');
    assert(/^\.\.\/\.\.\/bai\/[a-z0-9-]+\/#[tg]\d+$/.test(h), 'href ' + h);
    await p.press('.search-input', 'Enter');
    await p.waitForURL(/\/bai\/.+#[tg]\d+$/);
    const anchor = p.url().split('#')[1];
    await p.waitForSelector('#' + anchor + '.flash');
    const txt = await p.$eval('#' + anchor, (e) => e.textContent);
    assert(txt.includes('학교'), 'dòng ' + txt);
  });

  await tc('S10', 'Điện thoại 375px và giao diện tối: trang bài, /bai/, kết quả tra cứu không tràn ngang; nền tối chữ sáng; không lỗi JS', async () => {
    const m = await newPage(browser, { viewport: { width: 375, height: 800 }, colorScheme: 'dark' });
    const bad = [];
    const lum = (rgb) => { const v = rgb.match(/\d+/g).map(Number); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    for (const u of ['bai/tc3-09/', 'bai/sc1-00/', 'bai/', 'index.html#/']) {
      await m.page.goto(BASE + u); await m.page.waitForTimeout(200);
      await m.page.fill('.search-input', 'đi');
      await m.page.waitForSelector('.sr-item');
      const r = await m.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, w: innerWidth, bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color, tb: getComputedStyle(document.querySelector('.search-input')).backgroundColor }));
      if (r.sw > r.w) bad.push(u + ' tràn ' + r.sw);
      if (!(lum(r.bg) < 80 && lum(r.fg) > 150 && lum(r.tb) < 80)) bad.push(u + ' màu ' + r.bg + '/' + r.fg + '/' + r.tb);
    }
    if (m.page.errors.length) bad.push('JS: ' + m.page.errors.join(' | '));
    await m.ctx.close();
    assert(!bad.length, bad.join('; '));
  });

  await tc('S11', 'Hồi quy trang chủ: ô tra cứu không làm mất tab cấp độ, lộ trình, thẻ đề thi thử; chân trang có link "Tất cả bài" tới /bai/', async () => {
    await p.goto(BASE + 'index.html#/'); await p.reload();
    await p.waitForSelector('.level-jump [role=tab]');
    const tabs = await p.$$eval('.level-jump [role=tab]', (t) => t.length);
    const nodes = await p.$$eval('section.level:not([hidden]) .path a.node', (n) => n.length);
    assert(tabs === idx.levels.length && nodes === idx.levels[0].lessons.length, `tab ${tabs}, bài ${nodes}`);
    assert(await p.$('.exam-card'), 'mất thẻ đề thi thử');
    const order = await p.evaluate(() => !!(document.querySelector('.search').compareDocumentPosition(document.querySelector('.level-jump')) & Node.DOCUMENT_POSITION_FOLLOWING));
    assert(order, 'ô tra cứu không nằm trên tab cấp');
    await p.click('footer a[href="bai/"]');
    await p.waitForSelector('.lesson-list');
    assert(p.errors.length === 0, 'JS: ' + p.errors.join(' | '));
  });

  await ctx.close();
  await browser.close();
  const fail = results.filter((r) => r.status === 'FAIL').length;
  console.log(`\n${results.length - fail}/${results.length} PASS`);
  process.exit(fail ? 1 : 0);
})();
