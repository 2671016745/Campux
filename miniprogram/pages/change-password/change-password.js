/**
 * 强制改密页 —— 服务端在登录后标记 passwordChangeRequired=true 时进入。
 *
 * 结构对齐 apps/web/src/features/auth/RequiredPasswordChangeScreen.tsx：
 *   标题 + 说明 → 新密码 / 确认新密码 → 「保存并继续」→ 成功后回首页。
 * 视觉复用登录页实测样式（login.wxss），不另立体系。
 *
 * 入口约定：login.js 在拿到登录态后发现 user.passwordChangeRequired，
 *   置 getApp().globalData.forcePasswordChange = true 并 navigateTo 到本页。
 *   本页 onLoad 校验该标记，缺失则视为误进，直接回首页。
 */
const { changeRequiredPassword, logout, errorMessage } = require('../../utils/api');

Page({
  data: {
    logoUrl: '',
    newPassword: '',
    confirmPassword: '',
    canSubmit: false,
    busy: false,
    blocked: false,
    message: '',
  },

  onLoad() {
    const app = getApp();
    // 只有被服务端标记「必须改密」才允许停留本页；否则回首页
    // （未登录时首页会引导登录），避免用户卡在一张空表单上。
    if (!app.globalData.forcePasswordChange) {
      this.setData({ blocked: true });
      return;
    }
    this.setData({ logoUrl: app.globalData.logoUrl || '' });
  },

  onNewPasswordInput(e) {
    this.setData({ newPassword: e.detail.value }, () => this.updateCanSubmit());
  },

  onConfirmPasswordInput(e) {
    this.setData({ confirmPassword: e.detail.value }, () => this.updateCanSubmit());
  },

  /** 与服务端规则一致：至少 6 位且两次输入一致才可提交 */
  updateCanSubmit() {
    const { newPassword, confirmPassword } = this.data;
    this.setData({
      canSubmit: newPassword.length >= 6 && newPassword === confirmPassword,
    });
  },

  /** 保存并继续 */
  onSubmit() {
    if (this.data.busy) {
      return;
    }
    const { newPassword, confirmPassword } = this.data;
    if (newPassword.length < 6) {
      this.setData({ message: '新密码至少 6 位' });
      return;
    }
    if (newPassword !== confirmPassword) {
      this.setData({ message: '两次输入的新密码不一致。' });
      return;
    }

    this.setData({ busy: true, message: '' });
    const app = getApp();

    changeRequiredPassword(newPassword)
      .then(() => {
        // 服务端已把 passwordChangeRequired 置 false；清掉本地标记再刷新会话，
        // 否则下次 /api/me 之前页面仍以为要改密。
        app.globalData.forcePasswordChange = false;
        return app.checkSession({ prompt: false }).catch(() => null);
      })
      .then(() => {
        wx.reLaunch({ url: '/pages/post/post' });
      })
      .catch((err) => {
        this.setData({ busy: false, message: errorMessage(err, '修改密码失败') });
      });
  },

  /** 退出登录（网页端同屏也有） */
  onLogout() {
    if (this.data.busy) {
      return;
    }
    // logout() 内部已 catch，始终 resolve
    logout().then(() => {
      wx.reLaunch({ url: '/pages/login/login' });
    });
  },

  /** 误进本页时返回首页 */
  goHome() {
    wx.reLaunch({ url: '/pages/post/post' });
  },
});
