/**
 * Campux 微信小程序入口。
 *
 * 视觉与交互对齐 apps/web（真实网页端）：所有色值/尺寸来自 web 端实测计算样式。
 * 登录：小程序无 cookie，服务端 /api/wechat/* 签发 bearer token，后续请求带
 *       Authorization: Bearer <token>（服务端 getSessionContext 已支持该回退）。
 *
 * 启动流程：首页是「投稿」页；进小程序先查登录态，没登录弹「去登录 / 随便看看」。
 *
 * ⚠️ 部署前把 globalData.baseUrl 改成你的 Campux 地址（HTTPS，并在微信公众平台
 *    配置 request 合法域名；开发者工具里可勾选「不校验合法域名」先联调）。
 */
const api = require('./utils/api.js');

// 未登录弹窗的防抖窗口（毫秒）：app.onShow 与页面 onShow 会接连触发，避免连弹两次
const LOGIN_PROMPT_DEBOUNCE_MS = 1500;

App({
  globalData: {
    // 本地联调地址（配 D:/agent/hermes-data/campux-dev/start-server.sh 起的实例）。
    // ⚠️ 发 PR 前再改成 https://app.campux.top —— 等用户明确说「PR」时再换。
    baseUrl: 'http://127.0.0.1:8989',
    // 注册接口只对管理端域名开放（服务端按 Host 判定，即 SystemSetting.management_host）。
    // 留空即回退到 baseUrl。
    managementBaseUrl: '',
    token: '',
    user: null,
    currentTenant: null,
    currentMembership: null,
    metadata: null,
    logoUrl: '',
    /** 最近一次未登录弹窗的时间戳，用于防抖 */
    loginPromptAt: 0,
  },

  onLaunch() {
    this.globalData.token = wx.getStorageSync('token') || '';
    // 冷启动先静默校验一次：token 还有效就刷新会话数据，已失效就清掉
    this.checkSession({ prompt: false });
  },

  onShow() {
    // 每次进小程序（冷启动 / 从后台切回）都查一次登录态，未登录则弹窗
    this.checkSession({ prompt: true });
  },

  /**
   * 查询登录态。
   * - 有 token：GET /api/me 校验。authenticated=true 时刷新会话数据；否则视为 token 失效并清掉
   * - 无 token 或已失效：按需弹「去登录 / 随便看看」
   * 返回 Promise<boolean>：是否处于已登录状态
   */
  checkSession(options) {
    const opts = options || {};
    const token = this.globalData.token || wx.getStorageSync('token') || '';
    if (!token) {
      if (opts.prompt) {
        this.promptLogin();
      }
      return Promise.resolve(false);
    }
    this.globalData.token = token;
    return api.fetchMe().then((res) => {
      const data = (res && res.data) || {};
      if (res && res.statusCode === 200 && data.authenticated) {
        this.globalData.user = data.user || this.globalData.user;
        this.globalData.currentTenant = data.currentTenant || null;
        this.globalData.currentMembership = data.currentMembership || null;
        this.globalData.logoUrl = (data.currentTenant && data.currentTenant.logoUrl) || '';
        return true;
      }
      // authenticated=false（或 401/403）：这个 token 已经不能用了
      this.clearSession();
      if (opts.prompt) {
        this.promptLogin();
      }
      return false;
    }).catch(() => {
      // 网络异常不当作未登录：一次抖动不该把人弹去登录页
      return Boolean(this.globalData.token);
    });
  },

  /**
   * 未登录弹窗：去登录 / 随便看看。
   * 登录页和注册页上不弹（人已经在登录流程里了），并按 LOGIN_PROMPT_DEBOUNCE_MS 防抖。
   */
  promptLogin(options) {
    const opts = options || {};
    if (!opts.force) {
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      const route = (current && current.route) || '';
      if (route.indexOf('pages/login/') === 0 || route.indexOf('pages/register/') === 0) {
        return;
      }
      if (Date.now() - (this.globalData.loginPromptAt || 0) < LOGIN_PROMPT_DEBOUNCE_MS) {
        return;
      }
    }
    this.globalData.loginPromptAt = Date.now();
    wx.showModal({
      title: '还没有登录',
      content: '登录后才能投稿、查看自己的稿件。你也可以先随便看看。',
      confirmText: '去登录',
      cancelText: '随便看看',
      success: (res) => {
        if (res.confirm) {
          wx.navigateTo({
            url: '/pages/login/login',
            fail: () => wx.redirectTo({ url: '/pages/login/login' }),
          });
        }
      },
    });
  },

  setSession(payload) {
    this.globalData.token = payload.token || '';
    this.globalData.user = payload.user || null;
    this.globalData.currentTenant = payload.currentTenant || null;
    this.globalData.currentMembership = payload.currentMembership || null;
    this.globalData.logoUrl = (payload.currentTenant && payload.currentTenant.logoUrl) || '';
    if (payload.token) {
      wx.setStorageSync('token', payload.token);
    }
  },

  clearSession() {
    this.globalData.token = '';
    this.globalData.user = null;
    this.globalData.currentTenant = null;
    this.globalData.currentMembership = null;
    this.globalData.metadata = null;
    wx.removeStorageSync('token');
  },

  get role() {
    return (this.globalData.currentMembership && this.globalData.currentMembership.role) || '';
  },
});
