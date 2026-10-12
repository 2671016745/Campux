/**
 * 小程序 API 封装：对齐 web 端实际调用的接口，统一带 bearer token。
 * 接口契约以服务端为准（见 apps/server/src/routes/*）：
 *   GET  /api/me                    登录态
 *   GET  /api/tenant/metadata       公告 / 投稿规则 / 待审核上限 / logo 等
 *   GET  /api/posts/mine            我的稿件（注意：不存在 GET /api/posts）
 *   POST /api/posts                 multipart 投稿（text/anonymous/images）
 *   POST /api/wechat/login|bind     微信登录 / 首次绑定
 *   POST /api/wechat/unbind         解绑
 *   POST /api/auth/token-login      账号密码登录（返回 bearer token，不种 cookie）
 */

function baseUrl() {
  const app = getApp();
  return (app && app.globalData && app.globalData.baseUrl) || '';
}

function getToken() {
  const app = getApp();
  return (app && app.globalData && app.globalData.token) || wx.getStorageSync('token') || '';
}

function buildHeader(extra) {
  const header = Object.assign({ 'content-type': 'application/json' }, extra || {});
  const token = getToken();
  if (token) {
    header.Authorization = 'Bearer ' + token;
  }
  return header;
}

function request(path, options) {
  const opts = options || {};
  return new Promise((resolve, reject) => {
    wx.request({
      url: baseUrl() + path,
      method: opts.method || 'GET',
      data: opts.data || {},
      header: buildHeader(opts.header),
      success: resolve,
      fail: reject,
    });
  });
}

function errorMessage(res, fallback) {
  if (res && res.data && res.data.message) {
    return res.data.message;
  }
  return fallback || '请求失败';
}

// ─── 登录 ───────────────────────────────────────────────────────────────
function wechatLogin(tenantId) {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          reject(new Error('微信登录失败：未取得 code'));
          return;
        }
        const data = { code: loginRes.code };
        if (tenantId) data.tenantId = tenantId;
        request('/api/wechat/login', { method: 'POST', data }).then(resolve, reject);
      },
      fail: () => reject(new Error('微信登录失败，请重试')),
    });
  });
}

function wechatBind(account, password, tenantId) {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          reject(new Error('微信登录失败：未取得 code'));
          return;
        }
        const data = { code: loginRes.code, account: account, password: password };
        if (tenantId) data.tenantId = tenantId;
        request('/api/wechat/bind', { method: 'POST', data }).then(resolve, reject);
      },
      fail: () => reject(new Error('微信登录失败，请重试')),
    });
  });
}

/**
 * 账号密码登录（小程序「邮箱/密码登录」用）。
 * 与 /api/auth/login 不同：不依赖浏览器 cookie，改为返回 bearer token，
 * 由小程序存入本地存储后以 Authorization: Bearer 访问既有接口。
 */
function passwordLogin(account, password, tenantId) {
  const data = { account: account, password: password };
  if (tenantId) data.tenantId = tenantId;
  return request('/api/auth/token-login', { method: 'POST', data });
}

function logout() {
  return request('/api/auth/logout', { method: 'POST' }).catch(() => null);
}

// ─── 业务 ───────────────────────────────────────────────────────────────
function fetchMe() {
  return request('/api/me');
}

function fetchMetadata() {
  return request('/api/tenant/metadata');
}

function fetchMyPosts(page, limit) {
  return request('/api/posts/mine?page=' + (page || 1) + '&limit=' + (limit || 10));
}

function cancelPost(id) {
  return request('/api/posts/' + id + '/cancel', { method: 'POST' });
}

module.exports = {
  baseUrl,
  getToken,
  request,
  errorMessage,
  wechatLogin,
  wechatBind,
  passwordLogin,
  logout,
  fetchMe,
  fetchMetadata,
  fetchMyPosts,
  cancelPost,
};
