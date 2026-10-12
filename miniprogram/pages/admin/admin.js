const api = require('../../utils/api.js');

const ROLE_LABELS = {
  submitter: '用户',
  broadcaster: '广播员',
  reviewer: '审核员',
  admin: '管理员',
};

const REVIEW_ROLES = ['reviewer', 'admin', 'broadcaster'];

Page({
  data: {
    loggedIn: false,
    roleLabel: '',
    tenantName: '',
    pendingCount: 0,
    canReview: false,
    consoleUrl: '',
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.token) {
      this.setData({ loggedIn: false });
      return;
    }
    api.fetchMe().then((res) => {
      if (res.statusCode === 401 || !res.data || !res.data.authenticated) {
        app.clearSession();
        this.setData({ loggedIn: false });
        return;
      }
      const role = (res.data.currentMembership && res.data.currentMembership.role) || '';
      const tenant = res.data.currentTenant || {};
      this.setData({
        loggedIn: true,
        roleLabel: ROLE_LABELS[role] || '无权限',
        tenantName: tenant.name || '未加入校园墙',
        pendingCount: tenant.pendingPostCount || 0,
        canReview: REVIEW_ROLES.indexOf(role) >= 0,
        consoleUrl: app.globalData.baseUrl,
      });
    }).catch(() => this.setData({ loggedIn: false }));
  },

  openWebConsole() {
    // 小程序内不能直接打开外部网页，复制地址由用户在浏览器打开。
    this.copyConsoleUrl();
  },

  copyConsoleUrl() {
    wx.setClipboardData({
      data: this.data.consoleUrl,
      success: () => wx.showToast({ title: '地址已复制，请在浏览器打开', icon: 'none' }),
    });
  },
});
