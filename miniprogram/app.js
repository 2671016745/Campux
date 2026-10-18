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
    memberships: [],
    // 本次运行里是否已经问过「绑定微信」（点「不要」后置 true，冷启动重置）
    bindPrompted: false,
    metadata: null,
    logoUrl: '',
    /** 当前账号是否已绑定微信；undefined = 尚未确认 */
    wechatBound: undefined,
    /** 最近一次未登录弹窗的时间戳，用于防抖 */
    loginPromptAt: 0,
  },

  onLaunch() {
    this.globalData.token = wx.getStorageSync('token') || '';
    // 先用上次的会话快照把身份铺上，避免冷启动那几帧显示「校园墙 / 身份空白」
    this.restoreSessionCache();
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
        this.globalData.memberships = data.memberships || [];
        const providers = data.oauthProviders || [];
        this.globalData.wechatBound = providers.indexOf('wechat_miniprogram') >= 0;
        this.saveSessionCache();
        return true;
      }
      // authenticated=false（或 401/403）：这个 token 已经不能用了
      this.clearSession();
      if (opts.prompt) {
        this.promptLogin();
      }
      return false;
    }).catch((err) => {
      // 401/403 = token 已失效：必须清会话并引导登录。
      // 只有网络层错误（没有 res）才按「已登录」处理，避免一次抖动把人踢出去。
      // 之前这里不区分，导致失效 token 让 App 停在「已登录但没有任何数据」的半空状态。
      const status = err && err.res && err.res.statusCode;
      if (status === 401 || status === 403) {
        this.clearSession();
        if (opts.prompt) {
          this.promptLogin();
        }
        return false;
      }
      // 网络层错误：会话没坏，只是这次没问到。用本地快照把身份补上，
      // 否则页面会拿着空的 currentTenant 渲染出「校园墙 / 身份空白」那一屏。
      this.restoreSessionCache();
      return Boolean(this.globalData.token);
    });
  },

  /** 会话快照：网络抖动 / 冷启动首帧用它兜底，避免身份区空白 */
  saveSessionCache() {
    try {
      wx.setStorageSync('sessionCache', {
        user: this.globalData.user,
        currentTenant: this.globalData.currentTenant,
        currentMembership: this.globalData.currentMembership,
        memberships: this.globalData.memberships,
        wechatBound: this.globalData.wechatBound,
      });
    } catch (e) {
      // 存储失败不影响主流程
    }
  },

  restoreSessionCache() {
    let cached = null;
    try {
      cached = wx.getStorageSync('sessionCache');
    } catch (e) {
      cached = null;
    }
    if (!cached || !cached.user) {
      return false;
    }
    this.globalData.user = cached.user;
    this.globalData.currentTenant = cached.currentTenant || null;
    this.globalData.currentMembership = cached.currentMembership || null;
    this.globalData.logoUrl = (cached.currentTenant && cached.currentTenant.logoUrl) || '';
    if (Array.isArray(cached.memberships)) {
      this.globalData.memberships = cached.memberships;
    }
    if (typeof cached.wechatBound === 'boolean') {
      this.globalData.wechatBound = cached.wechatBound;
    }
    return true;
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
    this.globalData.memberships = payload.memberships || [];
    // 登录接口不返回 oauthProviders，绑定状态等下一次 /api/me 确认
    this.globalData.wechatBound = undefined;
    this.globalData.bindPrompted = false;
    if (payload.token) {
      wx.setStorageSync('token', payload.token);
    }
    this.saveSessionCache();
  },

  clearSession() {
    this.globalData.token = '';
    this.globalData.user = null;
    this.globalData.currentTenant = null;
    this.globalData.currentMembership = null;
    this.globalData.metadata = null;
    this.globalData.memberships = [];
    this.globalData.logoUrl = '';          // 否则换账号后登录页还挂着上一个墙的 logo
    this.globalData.bindPrompted = false;  // 换账号后要重新走一次绑定引导
    this.globalData.wechatBound = undefined;
    this.globalData.reviewAllowed = undefined;   // 换账号后重新判定审核权限
    this.globalData.reviewProbedAt = 0;
    wx.removeStorageSync('token');
    wx.removeStorageSync('sessionCache');
  },

  get role() {
    return (this.globalData.currentMembership && this.globalData.currentMembership.role) || '';
  },
});
