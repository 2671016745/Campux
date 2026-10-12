const api = require('../../utils/api.js');

const ROLE_LABELS = {
  submitter: '用户',
  broadcaster: '广播员',
  reviewer: '审核员',
  admin: '管理员',
};

Page({
  data: {
    loggedIn: false,
    userName: '',
    qqUin: '',
    email: '',
    roleLabel: '',
    tenantName: '',
    tenantHost: '',
    tenantStatus: '',
    unbinding: false,
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
      const user = res.data.user || {};
      const tenant = res.data.currentTenant || {};
      this.setData({
        loggedIn: true,
        userName: user.displayName || '',
        qqUin: user.qqUin || '',
        email: user.email || '',
        roleLabel: ROLE_LABELS[(res.data.currentMembership && res.data.currentMembership.role) || ''] || '无权限',
        tenantName: tenant.name || '未加入校园墙',
        tenantHost: tenant.host || '',
        tenantStatus: tenant.status || '',
      });
    }).catch(() => this.setData({ loggedIn: false }));
  },

  unbindWechat() {
    wx.showModal({
      title: '解绑微信',
      content: '解绑后需重新用 QQ 号/邮箱登录并绑定才能用微信登录，确认解绑？',
      success: (modal) => {
        if (!modal.confirm) {
          return;
        }
        this.setData({ unbinding: true });
        api.request('/api/wechat/unbind', { method: 'POST' }).then((res) => {
          this.setData({ unbinding: false });
          if (res.statusCode >= 200 && res.statusCode < 300) {
            wx.showToast({ title: '已解绑', icon: 'success' });
            return;
          }
          wx.showToast({ title: api.errorMessage(res, '解绑失败'), icon: 'none' });
        }).catch(() => {
          this.setData({ unbinding: false });
          wx.showToast({ title: '解绑失败，请重试', icon: 'none' });
        });
      },
    });
  },

  onLogout() {
    api.logout().then(() => {
      getApp().clearSession();
      this.setData({ loggedIn: false });
      wx.showToast({ title: '已退出', icon: 'none' });
    });
  },
});
