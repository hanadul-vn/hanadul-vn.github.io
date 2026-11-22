// Giả lập dịch vụ ngoài (Google Analytics, Formspree) trong test: không gửi số liệu/email thật,
// và test không phụ thuộc mạng. Dùng: await require('./stub_third_party')(ctx)
'use strict';
module.exports = async function stubThirdParty(ctx) {
  await ctx.route(/googletagmanager\.com\//, (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* gtag giả */' }));
  await ctx.route(/google-analytics\.com\//, (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.route(/formspree\.io\//, (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"ok":true}' }));
};
