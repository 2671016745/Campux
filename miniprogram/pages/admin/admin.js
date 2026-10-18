const icons = require('../../utils/icons.js');

const ROLE_LABELS = {
  submitter: '用户',
  broadcaster: '广播员',
  reviewer: '审核员',
  admin: '管理员',
};

Page({
  data: {
    icons,
    tenantName: '',
    logoUrl: '',
    roleLabel: '',
    pendingCount: 0,
    consoleUrl: '',
    loggedOut: false,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
      this.getTabBar().setSelected(3);
    }
    const app = getApp();
    // 未登录不硬跳登录页：弹「去登录 / 随便看看」，页面显示未登录占位
    if (!app.globalData.token) {
      this.setData({ loggedOut: true, pendingCount: 0 });
      app.promptLogin();
      return;
    }
    // 与其它 tab 页一致：等 /api/me 回来再渲染，避免冷启动先显示「校园墙」+ 0
    app.checkSession({ prompt: true }).then((ok) => {
      if (!ok) {
        this.setData({ loggedOut: true, pendingCount: 0 });
        return;
      }
      if (this.data.loggedOut) {
        this.setData({ loggedOut: false });
      }
      const tenant = app.globalData.currentTenant || {};
      this.setData({
        tenantName: tenant.name || '校园墙',
        logoUrl: tenant.logoUrl || '',
        roleLabel: ROLE_LABELS[app.role] || '',
        pendingCount: tenant.pendingPostCount || 0,
        consoleUrl: app.globalData.baseUrl,
      });
      // 角色这时才落地，补刷一次 tabBar
      const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
      if (tabBar) {
        tabBar.refresh();
        tabBar.setSelected(3);
      }
    });
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => wx.redirectTo({ url: '/pages/login/login' }),
    });
  },

  copyConsoleUrl() {
    wx.setClipboardData({
      data: this.data.consoleUrl,
      success: () => wx.showToast({ title: '地址已复制，请在浏览器打开', icon: 'none' }),
    });
  },
});
