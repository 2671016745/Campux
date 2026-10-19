const api = require('../../utils/api.js');
const app = getApp();

/** 发送后的倒计时：与服务端 60 秒冷却一致，避免用户反复点击。 */
const RESEND_SECONDS = 60;

Page({
  data: {
    logoUrl: '',
    email: '',
    code: '',
    newPassword: '',
    // 1 = 发送验证码；2 = 输入验证码 + 新密码
    step: 1,
    sending: false,
    countdown: 0,
    busy: false,
    canSubmit: false,
    message: '',
    messageError: false,
  },

  onLoad() {
    this.setData({ logoUrl: app.globalData.logoUrl || '' });
  },

  onUnload() {
    this.clearTimer();
  },

  clearTimer() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  onEmailInput(e) {
    this.setData({ email: e.detail.value });
  },

  onCodeInput(e) {
    // 与网页端一致：验证码只收数字，最多 6 位
    this.setData({ code: e.detail.value.replace(/\D/g, '').slice(0, 6) }, () => this.refreshSubmit());
  },

  onPasswordInput(e) {
    this.setData({ newPassword: e.detail.value }, () => this.refreshSubmit());
  },

  refreshSubmit() {
    const { code, newPassword } = this.data;
    this.setData({ canSubmit: /^\d{6}$/.test(code) && newPassword.length >= 6 });
  },

  /** 第一步：发送验证码到账号绑定的 QQ 邮箱 */
  sendCode() {
    if (this.data.sending || this.data.countdown > 0) {
      return;
    }
    const email = this.data.email.trim();
    if (!email) {
      this.setData({ message: '请输入 QQ 号或邮箱', messageError: true });
      return;
    }

    this.setData({ sending: true, message: '', messageError: false });
    api.requestPasswordReset(email)
      .then(() => {
        this.setData({
          sending: false,
          step: 2,
          message: '验证码已发送，请查收邮箱',
          messageError: false,
        });
        this.startCountdown();
      })
      .catch((err) => {
        // 服务端原因（账号不存在、发送太频繁等）原样显示
        this.setData({
          sending: false,
          message: api.errorMessage(err, '验证码发送失败'),
          messageError: true,
        });
      });
  },

  startCountdown() {
    this.clearTimer();
    this.setData({ countdown: RESEND_SECONDS });
    this.timer = setInterval(() => {
      const next = this.data.countdown - 1;
      if (next <= 0) {
        this.clearTimer();
        this.setData({ countdown: 0 });
        return;
      }
      this.setData({ countdown: next });
    }, 1000);
  },

  /** 第二步：提交验证码 + 新密码 */
  onReset() {
    if (this.data.busy) {
      return;
    }
    if (!this.data.canSubmit) {
      wx.showToast({ title: '请输入 6 位验证码，密码至少 6 位', icon: 'none' });
      return;
    }
    const { email, code, newPassword } = this.data;
    this.setData({ busy: true, message: '', messageError: false });

    api.resetPassword(email.trim(), code.trim(), newPassword)
      .then(() => {
        this.setData({ busy: false });
        wx.showToast({ title: '密码已重置，请用新密码登录', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      })
      .catch((err) => {
        // 验证码错误/过期、密码太短等服务端原因原样显示
        this.setData({
          busy: false,
          message: api.errorMessage(err, '重置失败，请稍后重试'),
          messageError: true,
        });
      });
  },

  /** 返回登录页 */
  goLogin() {
    wx.navigateBack();
  },
});
