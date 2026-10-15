const api = require('../../utils/api.js');
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
    account: '',
    rules: [],
    wechatBound: false,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
      this.getTabBar().setSelected(2);
    }
    const app = getApp();
    if (!app.globalData.token) {
      wx.redirectTo({ url: '/pages/login/login' });
      return;
    }
    this.applyIdentity();
    this.loadMetadata();
  },

  applyIdentity() {
    const app = getApp();
    const tenant = app.globalData.currentTenant || {};
    const user = app.globalData.user || {};
    this.setData({
      tenantName: tenant.name || '校园墙',
      logoUrl: tenant.logoUrl || '',
      roleLabel: ROLE_LABELS[app.role] || '',
      account: user.displayName ? user.displayName + '（QQ ' + user.qqUin + '）' : '',
    });
  },

  loadMetadata() {
    api.fetchMetadata().then((res) => {
      if (res.statusCode === 200 && res.data) {
        this.setData({ rules: res.data.postRules || [], logoUrl: res.data.logoUrl || this.data.logoUrl });
      }
    }).catch(() => null);
    // 查询微信绑定状态
    api.fetchMe().then((res) => {
      if (res.statusCode === 200 && res.data) {
        const providers = res.data.oauthProviders || [];
        this.setData({ wechatBound: providers.indexOf('wechat_miniprogram') >= 0 });
      }
    }).catch(() => null);
  },

  /** 修改显示名：服务端 PATCH /api/auth/profile（网页端同一接口）。 */
  renameAccount() {
    const app = getApp();
    const current = (app.globalData.user && app.globalData.user.displayName) || '';
    wx.showModal({
      title: '修改名称',
      editable: true,
      placeholderText: current || '输入新的显示名',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const displayName = (res.content || '').trim();
        if (!displayName) {
          wx.showToast({ title: '名称不能为空', icon: 'none' });
          return;
        }
        api.request('/api/auth/profile', { method: 'PATCH', data: { displayName } }).then((resp) => {
          if (resp.statusCode >= 200 && resp.statusCode < 300 && resp.data && resp.data.user) {
            app.globalData.user = resp.data.user;
            this.applyIdentity();
            wx.showToast({ title: '已更新', icon: 'success' });
            return;
          }
          wx.showModal({ title: '更新失败', content: api.errorMessage(resp, '请稍后重试'), showCancel: false });
        }).catch(() => {
          wx.showModal({ title: '更新失败', content: '网络错误，请稍后重试', showCancel: false });
        });
      },
    });
  },

  changePasswordHint() {
    wx.showModal({
      title: '修改密码',
      content: '为了账号安全，修改密码请在网页端完成（需要输入当前密码）。',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  showRules() {
    const rules = this.data.rules;
    if (!rules.length) {
      wx.showToast({ title: '本墙暂未配置投稿规则', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '投稿规则',
      content: rules.map((rule, i) => (i + 1) + '. ' + rule).join('\n'),
      showCancel: false,
      confirmText: '知道了',
    });
  },

  showAbout() {
    const app = getApp();
    wx.showModal({
      title: '关于 Campux',
      content:
        'Campux 微信小程序端\n' +
        '实例：' + app.globalData.baseUrl + '\n' +
        '当前校园墙：' + (this.data.tenantName || '-') + '\n' +
        '登录方式：微信一键登录（绑定校园墙账号后可用）',
      showCancel: false,
      confirmText: '知道了',
    });
  },

  /** 已登录状态下绑定微信：走 /api/wechat/bind-session（无需再输账号密码）。 */
  bindWechat() {
    wx.showLoading({ title: '绑定中…' });
    api.bindWechatToSession().then((res) => {
      wx.hideLoading();
      if (res.statusCode >= 200 && res.statusCode < 300) {
        wx.showToast({ title: '微信已绑定', icon: 'success' });
        this.setData({ wechatBound: true });
        return;
      }
      wx.showModal({ title: '绑定失败', content: api.errorMessage(res, '请稍后重试'), showCancel: false });
    }).catch((err) => {
      wx.hideLoading();
      wx.showModal({
        title: '绑定失败',
        content: (err && err.message) || '网络错误，请稍后重试',
        showCancel: false,
      });
    });
  },

  unbindWechat() {
    wx.showModal({
      title: '解绑微信',
      content: '解绑后需要重新用 QQ 号/邮箱绑定才能微信登录，确认解绑？',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        api.request('/api/wechat/unbind', { method: 'POST' }).then((resp) => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            getApp().clearSession();
            wx.showToast({ title: '已解绑', icon: 'success' });
            wx.redirectTo({ url: '/pages/login/login' });
            return;
          }
          wx.showModal({ title: '解绑失败', content: api.errorMessage(resp, '请稍后重试'), showCancel: false });
        }).catch(() => {
          wx.showModal({ title: '解绑失败', content: '网络错误，请稍后重试', showCancel: false });
        });
      },
    });
  },

  onLogout() {
    api.logout().then(() => {
      getApp().clearSession();
      wx.redirectTo({ url: '/pages/login/login' });
    }).catch(() => {
      getApp().clearSession();
      wx.redirectTo({ url: '/pages/login/login' });
    });
  },
});
