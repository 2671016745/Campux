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
    loggedOut: false,
    tenants: [],
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
      this.getTabBar().setSelected(2);
    }
    const app = getApp();
    // 未登录不硬跳登录页：弹「去登录 / 随便看看」，页面显示未登录占位
    if (!app.globalData.token) {
      this.setData({ loggedOut: true });
      app.promptLogin();
      return;
    }
    // token 存在 ≠ 有效（服务端可能已清掉）：先校验一次。
    // checkSession 拿到 401/403 会清掉会话并返回 false，页面就回到未登录态，
    // 不会出现「有按钮、但校园墙/身份/账号全空」的半空页面。
    app.checkSession({ prompt: true }).then((ok) => {
      if (!ok) {
        this.setData({ loggedOut: true });
        return;
      }
      if (this.data.loggedOut) {
        this.setData({ loggedOut: false });
      }
      this.applyIdentity();
      this.loadMetadata();
      // 角色这时才落地，补刷一次 tabBar
      const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
      if (tabBar) {
        tabBar.refresh();
        tabBar.setSelected(2);
      }
    });
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => wx.redirectTo({ url: '/pages/login/login' }),
    });
  },

  applyIdentity() {
    const app = getApp();
    const tenant = app.globalData.currentTenant || {};
    const user = app.globalData.user || {};
    const memberships = app.globalData.memberships || [];
    this.setData({
      tenantName: tenant.name || '校园墙',
      logoUrl: tenant.logoUrl || '',
      roleLabel: ROLE_LABELS[app.role] || '',
      account: user.displayName ? user.displayName + '（QQ ' + user.qqUin + '）' : '',
      tenants: memberships.map((m) => ({
        id: (m.tenant && m.tenant.id) || '',
        name: (m.tenant && m.tenant.name) || '校园墙',
        role: ROLE_LABELS[m.role] || m.role || '',
      })),
      wechatBound: app.globalData.wechatBound === true,
    });
  },

  loadMetadata() {
    api.fetchMetadata().then((res) => {
      if (res && res.data) {
        this.setData({ rules: res.data.postRules || [], logoUrl: res.data.logoUrl || this.data.logoUrl });
      }
    }).catch(() => null);
  },

  /** 多墙账号切换当前校园墙 */
  switchTenant() {
    const app = getApp();
    const list = this.data.tenants;
    if (list.length < 2) {
      return;
    }
    wx.showActionSheet({
      itemList: list.map((t) => t.name + (t.role ? '（' + t.role + '）' : '')),
      success: (res) => {
        const target = list[res.tapIndex];
        const current = (app.globalData.currentTenant || {}).id;
        if (!target || !target.id || target.id === current) {
          return;
        }
        wx.showLoading({ title: '切换中…' });
        api.switchTenant(target.id).then((resp) => {
          wx.hideLoading();
          const data = (resp && resp.data) || {};
          // 换墙接口不返回 token：只替换墙与身份，token 保持不动
          app.globalData.currentTenant = data.currentTenant || null;
          app.globalData.currentMembership = data.currentMembership || null;
          app.globalData.logoUrl = (data.currentTenant && data.currentTenant.logoUrl) || '';
          app.globalData.reviewAllowed = undefined;
          app.globalData.reviewProbedAt = 0;
          app.saveSessionCache();
          this.applyIdentity();
          this.loadMetadata();
          const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
          if (tabBar) {
            tabBar.refresh();
          }
          wx.showToast({ title: '已切换到' + (target.name || '该校墙'), icon: 'none' });
        }).catch((err) => {
          wx.hideLoading();
          wx.showModal({ title: '切换失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
        });
      },
    });
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
          const user = (resp && resp.data && resp.data.user) || null;
          if (user) {
            app.globalData.user = user;
            app.saveSessionCache();
            this.applyIdentity();
          }
          wx.showToast({ title: '已更新', icon: 'success' });
        }).catch((err) => {
          // 服务端原因（名称不合法、含敏感词等）原样显示，别再统一说成网络错误
          wx.showModal({ title: '更新失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
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
        getApp().markWechatBound(true);
        this.setData({ wechatBound: true });
        return;
      }
      wx.showModal({ title: '绑定失败', content: api.errorMessage(res, '请稍后重试'), showCancel: false });
    }).catch((err) => {
      wx.hideLoading();
      wx.showModal({
        title: '绑定失败',
        content: api.errorMessage(err, '网络错误，请稍后重试'),
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
        api.request('/api/wechat/unbind', { method: 'POST' }).then(() => {
          // 服务端解绑只删微信身份（OAuthIdentity），不动当前会话 ——
          // 所以这里不再清会话踢人重登，只把绑定状态改掉
          getApp().markWechatBound(false);
          this.setData({ wechatBound: false });
          wx.showToast({ title: '已解绑', icon: 'success' });
        }).catch((err) => {
          wx.showModal({ title: '解绑失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
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
