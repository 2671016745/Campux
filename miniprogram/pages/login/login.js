const api = require('../../utils/api.js');

Page({
  data: {
    loggingIn: false,
    binding: false,
    unbound: false,
    account: '',
    password: '',
  },

  onShow() {
    const app = getApp();
    // 已有登录态直接进投稿页
    if (app.globalData.token) {
      wx.switchTab({ url: '/pages/post/post' });
    }
  },

  onWechatLogin() {
    if (this.data.loggingIn) {
      return;
    }
    this.setData({ loggingIn: true });
    api.wechatLogin().then((res) => {
      this.setData({ loggingIn: false });
      const data = res.data || {};
      if (data.authenticated && data.token) {
        getApp().setSession(data);
        wx.switchTab({ url: '/pages/post/post' });
        return;
      }
      if (data.unbound) {
        this.setData({ unbound: true });
        wx.showToast({ title: '请先绑定账号', icon: 'none' });
        return;
      }
      wx.showModal({ title: '登录失败', content: api.errorMessage(res, '请稍后重试'), showCancel: false });
    }).catch((err) => {
      this.setData({ loggingIn: false });
      wx.showModal({ title: '登录失败', content: (err && err.message) || '网络错误', showCancel: false });
    });
  },

  onAccountInput(event) {
    this.setData({ account: event.detail.value });
  },

  onPasswordInput(event) {
    this.setData({ password: event.detail.value });
  },

  onBind() {
    const { account, password, binding } = this.data;
    if (binding) {
      return;
    }
    if (!account.trim()) {
      wx.showToast({ title: '请输入 QQ 号或 QQ 邮箱', icon: 'none' });
      return;
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }
    this.setData({ binding: true });
    api.wechatBind(account.trim(), password).then((res) => {
      this.setData({ binding: false });
      const data = res.data || {};
      if (data.authenticated && data.token) {
        getApp().setSession(data);
        this.setData({ password: '' });
        wx.switchTab({ url: '/pages/post/post' });
        return;
      }
      wx.showModal({ title: '绑定失败', content: api.errorMessage(res, '请检查账号密码'), showCancel: false });
    }).catch(() => {
      this.setData({ binding: false });
      wx.showModal({ title: '绑定失败', content: '网络错误，请稍后重试', showCancel: false });
    });
  },
});
