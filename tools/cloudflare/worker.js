// Cloudflare Worker phục vụ https://hanadul.app bằng nội dung của https://hanadul-vn.github.io.
// Vì sao không dùng "Custom domain" của GitHub Pages: khi bật, GitHub tự chuyển hướng (301) mọi lượt
// vào hanadul-vn.github.io sang tên miền mới ở phía máy chủ, trang cũ không còn chạy JS, nên không
// mang được tiến độ lưu trong trình duyệt (localStorage) của người chưa đăng nhập sang. Worker giữ
// cả hai địa chỉ cùng chạy; assets/move.js ở địa chỉ cũ chuyển người học sang kèm tiến độ.
// Cách dán vào Cloudflare: xem tools/cloudflare/README.md.
const ORIGIN = 'https://hanadul-vn.github.io';

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // www.hanadul.app → hanadul.app
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return Response.redirect(url.toString(), 301);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } });
    }

    const upstream = await fetch(ORIGIN + url.pathname + url.search, {
      method: request.method,
      headers: { accept: request.headers.get('accept') || '*/*' },
      redirect: 'manual',
      cf: { cacheEverything: true, cacheTtl: 300 }
    });

    const headers = new Headers(upstream.headers);
    const loc = headers.get('location');
    if (loc && loc.startsWith(ORIGIN)) headers.set('location', url.origin + loc.slice(ORIGIN.length));
    headers.delete('x-github-request-id');
    headers.set('strict-transport-security', 'max-age=31536000');
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  }
};
