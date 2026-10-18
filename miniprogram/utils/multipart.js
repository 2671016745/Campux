/**
 * 手工构造 multipart/form-data 请求体。
 *
 * 为什么不用 wx.uploadFile：它一次只能传一个文件，而 Campux 的
 * POST /api/posts 要求在同一次请求里带上 text/anonymous 字段和最多 9 张
 * 图片（字段名 images），所以这里按 RFC 7578 手工组包，再用 wx.request
 * 以 ArrayBuffer 形式发送。
 */

// 微信请求体上限约 10MB：留一点余量，超限时给明确提示，而不是让请求莫名失败
const MAX_TOTAL_BYTES = 9 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

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
  // 兼容 Windows 开发者工具给的带反斜杠路径
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || 'upload.jpg';
}

/** 只取大小，不读内容（一次读 9 张大图会把内存和主线程拖死） */
function statSize(filePath) {
  try {
    const stat = wx.getFileSystemManager().statSync(filePath);
    return (stat && stat.size) || 0;
  } catch (e) {
    return 0;
  }
}

function readFileAsync(filePath) {
  return new Promise((resolve, reject) => {
    wx.getFileSystemManager().readFile({
      filePath,
      success: (res) => resolve(res.data),
      fail: (err) => reject(new Error('读取图片失败：' + ((err && err.errMsg) || '未知错误'))),
    });
  });
}

/**
 * 组包并发送 multipart 请求。
 * @param {string} path      形如 "/api/posts"
 * @param {object} fields    { text: "...", anonymous: "true" }
 * @param {Array}  files     [{ fieldName: "images", filePath: "/tmp/xxx.jpg" }]
 * @param {object} extraHeader 额外请求头（Authorization 由调用方给）
 */
function uploadMultipart(path, fields, files, extraHeader) {
  const list = files || [];

  // 体积预检：单张 8MB、整包 9MB。超限直接 reject，由页面显示人话
  let total = 0;
  for (const file of list) {
    const size = statSize(file.filePath);
    if (size > MAX_FILE_BYTES) {
      return Promise.reject(new Error('单张图片不能超过 8MB，请换一张或先压缩'));
    }
    total += size;
  }
  if (total > MAX_TOTAL_BYTES) {
    return Promise.reject(new Error('图片总大小超过 9MB，请减少图片数量或压缩后再传'));
  }

  // 异步读取所有文件再组包：readFileSync 在 9 张大图时会明显卡住界面
  return Promise.all(list.map((file) => readFileAsync(file.filePath))).then((buffers) => {
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

  list.forEach((file, index) => {
    const filePath = file.filePath;
    const name = baseName(filePath);
    const contentType = guessContentType(filePath);
    chunks.push(stringToUint8Array(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="' + (file.fieldName || 'images') +
      '"; filename="' + name + '"\r\n' +
      'Content-Type: ' + contentType + '\r\n\r\n'
    ));
    chunks.push(new Uint8Array(buffers[index]));
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
      timeout: 60000,   // 上传比普通请求慢，单独放宽
      success: resolve,
      fail: reject,
    });
  });
  });
}

module.exports = { uploadMultipart, randomBoundary };
