/**
 * Campux 微信小程序入口。
 *
 * 视觉与交互对齐 apps/web（真实网页端）：所有色值/尺寸来自 web 端实测计算样式。
 * 登录：小程序无 cookie，服务端 /api/wechat/* 签发 bearer token，后续请求带
 *       Authorization: Bearer <token>（服务端 getSessionContext 已支持该回退）。
 *
 * ⚠️ 部署前把 globalData.baseUrl 改成你的 Campux 地址（HTTPS，并在微信公众平台
 *    配置 request 合法域名；开发者工具里可勾选「不校验合法域名」先联调）。
 */
App({
  globalData: {
    baseUrl: 'https://my-campux.top',
    token: '',
    user: null,
    currentTenant: null,
    currentMembership: null,
    metadata: null,
  },

  onLaunch() {
    this.globalData.token = wx.getStorageSync('token') || '';
  },

  setSession(payload) {
    this.globalData.token = payload.token || '';
    this.globalData.user = payload.user || null;
    this.globalData.currentTenant = payload.currentTenant || null;
    this.globalData.currentMembership = payload.currentMembership || null;
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
