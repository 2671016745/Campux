const api = require('../../utils/api.js');
const app = getApp();

/** 服务端只接受 QQ 邮箱： regex 与 apps/server/src/routes/auth.ts 的 emailSchema 保持一致。 */
const QQ_EMAIL = /^[1-9]\d{4,9}@qq\.com$/i;
const RESEND_SECONDS = 60;

Page({
  data: {
    logoUrl: '',
    email: '',
    code: '',
    displayName: '',
    password: '',
    sending: false,
    countdown: 0,
    busy: false,
    bindMode: false,
    canSubmit: false,
    message: '',
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

  refreshSubmit() {
    const { email, code, displayName, password } = this.data;
    const ok = QQ_EMAIL.test(email.trim())
      && /^\d{6}$/.test(code.trim())
      && displayName.trim().length > 0
      && password.length >= 6;
    this.setData({ canSubmit: ok });
  },

  onEmailInput(e) {
    this.setData({ email: e.detail.value }, () => this.refreshSubmit());
  },

  onCodeInput(e) {
    this.setData({ code: e.detail.value }, () => this.refreshSubmit());
  },

  onNameInput(e) {
    this.setData({ displayName: e.detail.value }, () => this.refreshSubmit());
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value }, () => this.refreshSubmit());
  },

  /** 获取验证码（与原版一致：结果写在表单内的提示行里） */
  sendCode() {
    if (this.data.sending || this.data.countdown > 0) {
      return;
    }
    const email = this.data.email.trim();
    if (!QQ_EMAIL.test(email)) {
      this.setData({ message: '只能使用 QQ 邮箱，例如 123456@qq.com' });
      return;
    }
    this.setData({ sending: true, message: '' });
    api.requestRegisterCode(email)
      .then((res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const devCode = res.data && res.data.devCode;
          this.setData({
            sending: false,
            message: devCode ? '开发环境验证码：' + devCode : '验证码已发送，请检查邮箱。',
          });
          this.startCountdown();
          return;
        }
        this.setData({ sending: false, message: api.errorMessage(res, '验证码发送失败') });
      })
      .catch(() => {
        this.setData({ sending: false, message: '网络错误，请稍后重试' });
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

  onRegister() {
    this.submit(false);
  },

  onRegisterAndBind() {
    this.submit(true);
  },

  /** bindMode = true 时，注册成功后再把当前微信绑到新账号上。 */
  submit(bindMode) {
    if (this.data.busy || !this.data.canSubmit) {
      return;
    }
    const { email, code, displayName, password } = this.data;
    this.setData({ busy: true, bindMode });

    api.registerAccount({
      email: email.trim(),
      code: code.trim(),
      displayName: displayName.trim(),
      password,
    }).then((res) => {
      if (!(res.statusCode >= 200 && res.statusCode < 300) || !res.data || !res.data.token) {
        this.setData({ busy: false, message: api.errorMessage(res, '注册失败（HTTP ' + res.statusCode + '）') });
        return;
      }

      // 注册接口已返回 token，直接当登录态用
      app.setSession(res.data);

      if (!bindMode) {
        this.setData({ busy: false });
        this.finish('');
        return;
      }

      api.bindWechatToSession().then((bindRes) => {
        this.setData({ busy: false });
        if (bindRes.statusCode >= 200 && bindRes.statusCode < 300) {
          this.finish('微信已同时绑定。');
          return;
        }
        this.finish('账号已注册，但微信绑定失败：' + api.errorMessage(bindRes, '请到「服务」页重试') + '。');
      }).catch(() => {
        this.setData({ busy: false });
        this.finish('账号已注册，但微信绑定失败，请到「服务」页重试。');
      });
    }).catch(() => {
      this.setData({ busy: false, message: '网络错误，请稍后重试' });
    });
  },

  /** 注册成功：新账号还没有校园墙，引导去管理端创建，然后回登录页。 */
  finish(extra) {
    wx.showModal({
      title: '注册成功',
      content: (extra ? extra + '\n\n' : '')
        + '账号已创建，但你还没有校园墙。请到管理端登录并创建你的校园墙，之后即可回到小程序使用。',
      showCancel: false,
      confirmText: '知道了',
      success: () => {
        app.clearSession();
        wx.redirectTo({ url: '/pages/login/login' });
      },
    });
  },
});
