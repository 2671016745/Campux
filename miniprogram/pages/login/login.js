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
    wechatHint: '还没绑定微信？先登录，再在「服务」页绑定，之后即可一键登录。',
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
          // 未绑定：提示用账号密码登录一次即完成绑定
          this.setData({
            unbound: true,
            loggingIn: false,
            wechatHint: '这个微信还没绑定账号，用上面的账号密码登录一次即可绑定。',
          });
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
    if (this.data.loginBusy) {
      return;
    }
    const { account, password, unbound } = this.data;
    // 按钮与原版一致始终保持蓝色可点，因此这里做提示而不是静默返回
    if (!account.trim() || !password) {
      wx.showToast({ title: '请输入账号和密码', icon: 'none' });
      return;
    }

    this.setData({ loginBusy: true, message: '' });

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
        // 失败原因来自服务端（如「账号或密码错误」），原样显示，别再落到「未获取到令牌」
        this.setData({ loginBusy: false, message: errorMessage(err, '登录失败') });
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

  /** 跳转忘记密码页 */
  goForgotPassword() {
    wx.navigateTo({ url: '/pages/forgot-password/forgot-password' });
  },

  /** 登录成功：保存会话并跳转 */
  onLoginSuccess(data) {
    if (!data || !data.token) {
      // 非 2xx 已在 api.request 里转成 catch，能走到这说明服务端 200 却没给登录态
      this.setData({ message: '登录失败：服务端未返回登录态，请稍后重试' });
      return;
    }
    app.setSession(data);
    // 服务端要求强制改密（如首次登录、管理员重置密码后）：跳转修改密码页
    if (data.user && data.user.passwordChangeRequired) {
      app.globalData.forcePasswordChange = true;
      wx.reLaunch({ url: '/pages/change-password/change-password' });
      return;
    }
    wx.reLaunch({ url: '/pages/post/post' });
  },
});
