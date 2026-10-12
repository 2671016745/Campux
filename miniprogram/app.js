/**
 * Campux 微信小程序入口。
 *
 * 与网页端共用一个 Campux 实例：小程序通过 bearer token 认证
 * （服务端 /api/wechat/login、/api/wechat/bind 返回），不依赖浏览器 cookie。
 *
 * ⚠️ 部署前请把 globalData.baseUrl 改成你自己的 Campux 地址
 *    （必须是 HTTPS，且在微信公众平台「开发 - 服务器域名」里配置为 request 合法域名；
 *     开发者工具里可勾选「不校验合法域名」先本地联调）。
 */
App({
  globalData: {
    baseUrl: 'https://my-campux.top',
    token: '',
    user: null,
    currentTenant: null,
    currentMembership: null,
  },

  onLaunch() {
    this.globalData.token = wx.getStorageSync('token') || '';
  },

  /** 保存登录态（token + 用户/校园墙信息）。 */
  setSession(payload) {
    this.globalData.token = payload.token || '';
    this.globalData.user = payload.user || null;
    this.globalData.currentTenant = payload.currentTenant || null;
    this.globalData.currentMembership = payload.currentMembership || null;
    if (payload.token) {
      wx.setStorageSync('token', payload.token);
    }
    if (payload.currentTenant) {
      wx.setStorageSync('currentTenant', payload.currentTenant);
    }
  },

  /** 清空登录态。 */
  clearSession() {
    this.globalData.token = '';
    this.globalData.user = null;
    this.globalData.currentTenant = null;
    this.globalData.currentMembership = null;
    wx.removeStorageSync('token');
    wx.removeStorageSync('currentTenant');
  },
});
