// Test Cloudflare Worker (tools/cloudflare/worker.js) bằng fetch giả. Chạy: node tests/worker.test.mjs
import assert from 'assert';
import worker from '../tools/cloudflare/worker.js';
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push([url, init]);
  if (url.endsWith('/thu-muc')) return new Response(null, { status: 301, headers: { location: 'https://hanadul-vn.github.io/thu-muc/' } });
  if (url.includes('khong-co')) return new Response('404 page', { status: 404, headers: { 'content-type': 'text/html' } });
  return new Response('ok ' + url, { status: 200, headers: { 'content-type': 'text/html', 'x-github-request-id': 'x' } });
};
const res = [];
async function tc(id, name, fn) { try { await fn(); res.push('PASS'); console.log('PASS', id, name); } catch (e) { res.push('FAIL'); console.log('FAIL', id, name, e.message); process.exitCode = 1; } }
await tc('W1', 'Lấy đúng trang từ GitHub Pages (giữ đường dẫn + query), trả 200', async () => {
  calls = []; const r = await worker.fetch(new Request('https://hanadul.app/gioi-thieu.html?a=1'));
  assert.strictEqual(calls[0][0], 'https://hanadul-vn.github.io/gioi-thieu.html?a=1');
  assert.strictEqual(r.status, 200); assert.strictEqual(await r.text(), 'ok https://hanadul-vn.github.io/gioi-thieu.html?a=1');
  assert.ok(!r.headers.get('x-github-request-id'));
});
await tc('W2', 'Chuyển hướng của GitHub được đổi sang hanadul.app', async () => {
  const r = await worker.fetch(new Request('https://hanadul.app/thu-muc'));
  assert.strictEqual(r.status, 301); assert.strictEqual(r.headers.get('location'), 'https://hanadul.app/thu-muc/');
});
await tc('W3', 'www.hanadul.app → hanadul.app (301, giữ đường dẫn)', async () => {
  const r = await worker.fetch(new Request('https://www.hanadul.app/chinh-sach-bao-mat.html'));
  assert.strictEqual(r.status, 301); assert.strictEqual(r.headers.get('location'), 'https://hanadul.app/chinh-sach-bao-mat.html');
});
await tc('W4', 'Trang không có giữ mã 404', async () => {
  const r = await worker.fetch(new Request('https://hanadul.app/khong-co'));
  assert.strictEqual(r.status, 404);
});
await tc('W5', 'POST bị chặn 405', async () => {
  const r = await worker.fetch(new Request('https://hanadul.app/', { method: 'POST', body: 'x' }));
  assert.strictEqual(r.status, 405);
});
console.log(`\n${res.filter((x) => x === 'PASS').length}/${res.length} PASS`);
