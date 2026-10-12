/**
 * 小程序 API 封装：统一带上 bearer token，统一错误处理。
 */

function baseUrl() {
  // getApp() 在页面/组件内可用；工具函数里惰性读取，避免初始化时序问题。
  const instance = getApp();
  return (instance && instance.globalData && instance.globalData.baseUrl) || '';
}

function getToken() {
  const instance = getApp();
  return (instance && instance.globalData && instance.globalData.token) || wx.getStorageSync('token') || '';
}

function buildHeader(extra) {
  const token = getToken();
  const header = Object.assign({ 'content-type': 'application/json' }, extra || {});
  if (token) {
    header.Authorization = 'Bearer ' + token;
  }
  return header;
}

/** Promise 化的 wx.request。resolve 整个 response，便于读取 statusCode。 */
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

/** 从响应里取错误信息（服务端统一返回 { message }）。 */
function errorMessage(res, fallback) {
  if (res && res.data && res.data.message) {
    return res.data.message;
  }
  return fallback || '请求失败';
}

// ─── 登录相关 ───────────────────────────────────────────────────────────

/** 用 wx.login 的 code 换 Campux 会话。返回服务端原始响应 data。 */
function wechatLogin(tenantId) {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          reject(new Error('微信登录失败：未取得 code'));
          return;
        }
        request('/api/wechat/login', {
          method: 'POST',
          data: tenantId ? { code: loginRes.code, tenantId } : { code: loginRes.code },
        }).then((res) => resolve(res), reject);
      },
      fail: () => reject(new Error('微信登录失败，请重试')),
    });
  });
}

/** 首次绑定：QQ 号/邮箱 + 密码绑定当前微信并登录。 */
function wechatBind(account, password, tenantId) {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          reject(new Error('微信登录失败：未取得 code'));
          return;
        }
        const data = { code: loginRes.code, account, password };
        if (tenantId) {
          data.tenantId = tenantId;
        }
        request('/api/wechat/bind', { method: 'POST', data }).then((res) => resolve(res), reject);
      },
      fail: () => reject(new Error('微信登录失败，请重试')),
    });
  });
}

function logout() {
  return request('/api/auth/logout', { method: 'POST' }).catch(() => null);
}

function fetchMe() {
  return request('/api/me');
}

function fetchPosts(page, limit) {
  // 投稿页展示「我的稿件」，对应 GET /api/posts/mine（返回 { posts, pagination }）。
  return request('/api/posts/mine?page=' + (page || 1) + '&limit=' + (limit || 10));
}

module.exports = {
  baseUrl,
  getToken,
  request,
  errorMessage,
  wechatLogin,
  wechatBind,
  logout,
  fetchMe,
  fetchPosts,
};
