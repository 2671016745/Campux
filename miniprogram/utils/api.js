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
      // 注册类接口服务端按 Host 判定「管理端域名」，故允许按调用点覆盖基地址
      url: (opts.baseUrl || baseUrl()) + path,
      method: opts.method || 'GET',
      data: opts.data || {},
      header: buildHeader(opts.header),
      success: (res) => {
        // ⚠ wx.request 对 4xx/5xx 也走 success（只在断网时才走 fail）。
        // 不在这里分流的话，登录失败会一路走到「未获取到令牌」这类兜底文案，
        // 把服务端真实原因（如「账号或密码错误」）丢掉 —— 用户看到的就是「登不上去」+ 一句看不懂的话。
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res);
          return;
        }
        const message = errorMessage(res, '请求失败（HTTP ' + res.statusCode + '）');
        // 制造成 Error 抛给调用方的 catch；err.res 保留原始响应，errorMessage() 认得它
        const err = new Error(message);
        err.res = res;
        reject(err);
      },
      fail: reject,
    });
  });
}

function errorMessage(resOrErr, fallback) {
  const res = resOrErr && resOrErr.res ? resOrErr.res : resOrErr;
  if (res && res.data && res.data.message) {
    return res.data.message;
  }
  if (resOrErr && resOrErr.message && !(resOrErr.res && resOrErr.res.data)) {
    return resOrErr.message;   // 网络层错误（如「request:fail」）
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

/**
 * 已登录状态下绑定微信（「服务」页用）。
 * 与 wechatBind 的区别：调用方已经登录，不需要再输账号密码；
 * 服务端用本次新取的 code 换 openid 后，直接绑到当前会话账号上。
 */
function bindWechatToSession() {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (loginRes) => {
        if (!loginRes.code) {
          reject(new Error('微信登录失败：未取得 code'));
          return;
        }
        request('/api/wechat/bind-session', { method: 'POST', data: { code: loginRes.code } }).then(resolve, reject);
      },
      fail: () => reject(new Error('微信登录失败，请重试')),
    });
  });
}

/**
 * 注册相关接口的基地址。
 * 服务端 /api/auth/register* 只对「管理端域名」（systemSetting.management_host）开放，
 * 其他 Host 一律 404「当前入口不开放注册」。小程序没法改 Host，因此这里允许在
 * app.js 的 globalData.managementBaseUrl 里单独指定管理端地址；留空则退回 baseUrl。
 */
function registerBaseUrl() {
  const app = getApp();
  return (app && app.globalData && app.globalData.managementBaseUrl) || baseUrl();
}

/** 发送注册邮箱验证码（仅 QQ 邮箱可用）。 */
function requestRegisterCode(email) {
  return request('/api/auth/register/request-code', {
    method: 'POST',
    data: { email: email },
    baseUrl: registerBaseUrl(),
  });
}

/** 注册运营管理员账号。成功时返回体里带 token，可直接当作登录态使用。 */
function registerAccount(payload) {
  return request('/api/auth/register', {
    method: 'POST',
    data: payload,
    baseUrl: registerBaseUrl(),
  });
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
  bindWechatToSession,
  passwordLogin,
  requestRegisterCode,
  registerAccount,
  logout,
  fetchMe,
  fetchMetadata,
  fetchMyPosts,
  cancelPost,
};
