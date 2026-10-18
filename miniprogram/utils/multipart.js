/**
 * 手工构造 multipart/form-data 请求体。
 *
 * 为什么不用 wx.uploadFile：它一次只能传一个文件，而 Campux 的
 * POST /api/posts 要求在同一次请求里带上 text/anonymous 字段和最多 9 张
 * 图片（字段名 images），所以这里按 RFC 7578 手工组包，再用 wx.request
 * 以 ArrayBuffer 形式发送。
 */

function randomBoundary() {
  return '----CampuxMiniProgram' + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function stringToUint8Array(str) {
  const utf8 = unescape(encodeURIComponent(str));
  const bytes = new Uint8Array(utf8.length);
  for (let i = 0; i < utf8.length; i += 1) {
    bytes[i] = utf8.charCodeAt(i);
  }
  return bytes;
}

function concatUint8Arrays(chunks) {
  let total = 0;
  for (const chunk of chunks) {
    total += chunk.length;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function guessContentType(filePath) {
  const lower = String(filePath || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/jpeg';
}

function baseName(filePath) {
  const parts = String(filePath || '').split('/');
  return parts[parts.length - 1] || 'upload.jpg';
}

/**
 * 组包并发送 multipart 请求。
 * @param {string} path      形如 "/api/posts"
 * @param {object} fields    { text: "...", anonymous: "true" }
 * @param {Array}  files     [{ fieldName: "images", filePath: "/tmp/xxx.jpg" }]
 * @param {object} extraHeader 额外请求头（Authorization 由调用方给）
 */
function uploadMultipart(path, fields, files, extraHeader) {
  const boundary = randomBoundary();
  const chunks = [];

  Object.keys(fields || {}).forEach((key) => {
    const value = fields[key];
    if (value === undefined || value === null) {
      return;
    }
    chunks.push(stringToUint8Array(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="' + key + '"\r\n\r\n' +
      String(value) + '\r\n'
    ));
  });

  (files || []).forEach((file) => {
    const filePath = file.filePath;
    const name = baseName(filePath);
    const contentType = guessContentType(filePath);
    // 同步读文件：投稿图片通常几百 KB，可接受。
    const buffer = wx.getFileSystemManager().readFileSync(filePath);
    chunks.push(stringToUint8Array(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="' + (file.fieldName || 'images') +
      '"; filename="' + name + '"\r\n' +
      'Content-Type: ' + contentType + '\r\n\r\n'
    ));
    chunks.push(new Uint8Array(buffer));
    chunks.push(stringToUint8Array('\r\n'));
  });

  chunks.push(stringToUint8Array('--' + boundary + '--\r\n'));
  const body = concatUint8Arrays(chunks);

  return new Promise((resolve, reject) => {
    wx.request({
      url: getApp().globalData.baseUrl + path,
      method: 'POST',
      header: Object.assign({
        'content-type': 'multipart/form-data; boundary=' + boundary,
        // 与 api.js 的 buildHeader 保持一致：服务端据此把投稿记为「小程序投稿」
        'X-Campux-Client': 'miniprogram',
      }, extraHeader || {}),
      data: body.buffer,
      success: resolve,
      fail: reject,
    });
  });
}

module.exports = { uploadMultipart, randomBoundary };
