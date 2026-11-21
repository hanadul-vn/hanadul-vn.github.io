/* Cấu hình Hana Dul. Để trống mục nào thì tính năng đó tự ẩn, web vẫn chạy bình thường. */
window.HANADUL_CONFIG = {
  // Google Analytics 4, dạng "G-XXXXXXXXXX". Trống = không đo.
  gaId: '',

  // Form nhận email báo bài mới và cảm nhận người học. Chọn 1 trong 2:
  //  - Formspree:   { type: 'formspree', url: 'https://formspree.io/f/xxxxxxx' }
  //  - Google Form: { type: 'google', url: 'https://docs.google.com/forms/d/e/<id>/formResponse',
  //                   fields: { email: 'entry.111', name: 'entry.222', message: 'entry.333', kind: 'entry.444' } }
  // null = ẩn form email.
  form: null,

  // Link nhóm Zalo / trang Facebook. Trống = ẩn nút.
  zaloUrl: '',
  facebookUrl: ''
};
