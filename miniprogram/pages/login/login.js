const { wechatLogin, wechatBind, passwordLogin, errorMessage } = require('../../utils/api');
const app = getApp();

Page({
  data: {
    logoUrl: '',
    account: '',
    password: '',
    loggingIn: false,
    loginBusy: false,
    unbound: false,
  },

  onLoad(options) {
    // 支持从其他页带参跳转（如 ?account=xxx）
    if (options && options.account) {
      this.setData({ account: options.account });
    }
    this.setData({ logoUrl: app.globalData.logoUrl || '' });
  },

  onShow() {
    this.setData({ logoUrl: app.globalData.logoUrl || '' });
  },

  onAccountInput(e) {
    this.setData({ account: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  /** 微信一键登录 */
  onWechatLogin() {
    if (this.data.loggingIn) return;
    this.setData({ loggingIn: true });

    wechatLogin()
      .then((res) => {
        if (res.data && res.data.unbound) {
          // 未绑定：提示用户用下面的账号密码登录
          this.setData({ unbound: true, loggingIn: false });
          return;
        }
        // 已绑定：直接登录成功
        this.onLoginSuccess(res.data);
      })
      .catch((err) => {
        this.setData({ loggingIn: false });
        wx.showToast({ title: errorMessage(err, '微信登录失败'), icon: 'none' });
      });
  },

  /** 邮箱/密码登录（未绑定时自动走绑定流程） */
  onPasswordLogin() {
    if (this.data.loginBusy) return;
    const { account, password, unbound } = this.data;
    if (!account || !password) return;

    this.setData({ loginBusy: true });

    if (unbound) {
      // 未绑定微信：走 bind 接口（绑定 + 登录）
      this.doBind(account, password);
      return;
    }

    passwordLogin(account, password)
      .then((res) => {
        this.setData({ loginBusy: false });
        this.onLoginSuccess(res.data);
      })
      .catch((err) => {
        this.setData({ loginBusy: false });
        wx.showToast({ title: errorMessage(err, '登录失败'), icon: 'none' });
      });
  },

  /** 绑定微信并登录 */
  doBind(account, password) {
    wechatBind(account, password)
      .then((res) => {
        this.setData({ loginBusy: false, unbound: false });
        this.onLoginSuccess(res.data);
      })
      .catch((err) => {
        this.setData({ loginBusy: false });
        wx.showToast({ title: errorMessage(err, '绑定失败'), icon: 'none' });
      });
  },

  /** 跳转注册页 */
  goRegister() {
    wx.navigateTo({ url: '/pages/register/register' });
  },

  /** 登录成功：保存会话并跳转 */
  onLoginSuccess(data) {
    if (!data || !data.token) {
      wx.showToast({ title: '登录失败：未获取到令牌', icon: 'none' });
      return;
    }
    app.setSession(data);
    wx.reLaunch({ url: '/pages/post/post' });
  },
});
