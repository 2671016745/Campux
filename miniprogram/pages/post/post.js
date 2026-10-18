const api = require('../../utils/api.js');
const multipart = require('../../utils/multipart.js');
const icons = require('../../utils/icons.js');

const ROLE_LABELS = {
  submitter: '用户',
  broadcaster: '广播员',
  reviewer: '审核员',
  admin: '管理员',
};

const MAX_IMAGES = 9;

Page({
  data: {
    icons,
    tenantName: '',
    logoUrl: '',
    roleLabel: '',
    banner: '',
    rules: [],
    limitText: '',
    text: '',
    textLength: 0,
    imageUrls: [],
    anonymous: false,
    submitting: false,
    canSubmit: false,
    // 登录后的绑定引导弹窗
    showBindSheet: false,
    bindBusy: false,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
      this.getTabBar().setSelected(0);
    }
    const app = getApp();
    // 未登录也允许进来看看：由 app 统一弹「去登录 / 随便看看」，不再硬跳登录页
    if (!app.globalData.token) {
      this.applyIdentity();
      app.promptLogin();
      return;
    }
    // 冷启动时 token 已从本地恢复，但 user/tenant 还没落地（/api/me 在飞）。
    // 这里等校验完再渲染身份，否则页头会先显示「校园墙」这种空值。
    app.checkSession({ prompt: true }).then((ok) => {
      this.applyIdentity();
      if (!ok) {
        return;
      }
      // 角色这时才落地，补刷一次 tabBar（否则管理员冷启动少「管理」入口）
      const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
      if (tabBar) {
        tabBar.refresh();
        tabBar.setSelected(0);
      }
      this.loadMetadata();
      this.checkWechatBinding();
    });
  },

  /**
   * 登录后自动检测微信是否已绑定：未绑定且用户没选过「不再提醒」时弹出询问。
   * 绑定状态由 app.checkSession 里的 /api/me 一并取回（globalData.wechatBound），
   * 这里不再单独请求一次。
   */
  checkWechatBinding() {
    if (wx.getStorageSync('wechatBindNeverRemind')) {
      return;
    }
    const app = getApp();
    if (app.globalData.bindPrompted) {
      return;   // 本次运行里已经问过了（点了「不要」）
    }
    if (this.data.showBindSheet || this.data.bindBusy) {
      return;
    }
    const bound = app.globalData.wechatBound;
    if (bound === undefined) {
      return;   // 状态还没确认，等下次 onShow
    }
    if (bound) {
      return;
    }
    this.setData({ showBindSheet: true });
  },

  /** 弹窗「确定绑定」：拿当前微信身份绑到本账号 */
  onBindConfirm() {
    if (this.data.bindBusy) {
      return;
    }
    this.setData({ showBindSheet: false, bindBusy: true });
    wx.showLoading({ title: '绑定中…' });
    api.bindWechatToSession().then((res) => {
      wx.hideLoading();
      this.setData({ bindBusy: false });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        getApp().markWechatBound(true);   // 否则切页回来「绑定微信」弹窗会再弹一次
        wx.showModal({
          title: '微信已绑定',
          content: '以后可以直接用微信一键登录，不用再输账号密码。也可以在「服务」页解绑。',
          showCancel: false,
          confirmText: '知道了',
        });
        return;
      }
      wx.showModal({ title: '绑定失败', content: api.errorMessage(res, '请稍后重试'), showCancel: false });
    }).catch((err) => {
      wx.hideLoading();
      this.setData({ bindBusy: false });
      // 绑定失败（含用户取消微信授权）：本次运行内不再反复弹，避免每次切回都打扰
      getApp().globalData.bindPrompted = true;
      wx.showModal({
        title: '绑定失败',
        content: api.errorMessage(err, '网络错误，请稍后重试'),
        showCancel: false,
      });
    });
  },

  /** 弹窗「不要」：本次跳过，下次登录仍会提示 */
  onBindLater() {
    // 只在本次运行内不再打扰（下次启动还会问一次）；「不再提醒」才是持久化关闭。
    // 之前这里什么都不记，导致每次 onShow 都重新弹，看起来像页面卡住/白屏。
    getApp().globalData.bindPrompted = true;
    this.setData({ showBindSheet: false });
    wx.showToast({ title: '可随时在「服务」页绑定', icon: 'none' });
  },

  /** 弹窗「不再提醒」：写入本地标记，之后不再弹 */
  onBindNever() {
    wx.setStorageSync('wechatBindNeverRemind', true);
    getApp().globalData.bindPrompted = true;
    this.setData({ showBindSheet: false });
    wx.showToast({ title: '已关闭提醒，可在「服务」页绑定', icon: 'none' });
  },

  /** 去「服务」页绑定 */
  goServicesForBind() {
    this.setData({ showBindSheet: false });
    wx.switchTab({ url: '/pages/services/services' });
  },

  applyIdentity() {
    const app = getApp();
    const tenant = app.globalData.currentTenant || {};
    this.setData({
      tenantName: tenant.name || '校园墙',
      logoUrl: tenant.logoUrl || '',
      roleLabel: ROLE_LABELS[app.role] || '',
    });
  },

  /** 公告 / 投稿规则 / 待审核上限，全部来自服务端（与网页端同一接口）。 */
  loadMetadata() {
    api.fetchMetadata().then((res) => {
      if (res.statusCode !== 200 || !res.data) {
        return;
      }
      const meta = res.data;
      const limit = meta.pendingPostLimit;
      this.setData({
        banner: meta.banner || '',
        rules: meta.postRules || [],
        limitText: limit > 0 ? '每人最多同时保留 ' + limit + ' 条待审核稿件。' : '当前不限制待审核稿件数量。',
        logoUrl: meta.logoUrl || this.data.logoUrl,
      });
    }).catch(() => {
      // 静默失败，投稿页不阻塞
    });
  },

  onTextInput(event) {
    const text = event.detail.value;
    this.setData({ text, textLength: text.length, canSubmit: text.trim().length > 0 });
  },

  onAnonymousChange(event) {
    this.setData({ anonymous: event.detail.value });
  },

  chooseImage() {
    const remain = MAX_IMAGES - this.data.imageUrls.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 ' + MAX_IMAGES + ' 个文件', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const paths = (res.tempFiles || []).map((f) => f.tempFilePath);
        this.setData({ imageUrls: this.data.imageUrls.concat(paths) });
      },
      fail: () => null,
    });
  },

  /** 与网页端一致：点缩略图弹出删除确认。 */
  confirmRemoveImage(event) {
    const index = event.currentTarget.dataset.index;
    wx.showModal({
      title: '删除这张图片？',
      content: '删除后需要重新选择。',
      confirmText: '删除',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        const next = this.data.imageUrls.slice();
        next.splice(index, 1);
        this.setData({ imageUrls: next });
      },
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

  submitPost() {
    const { text, imageUrls, anonymous, submitting, canSubmit } = this.data;
    if (submitting) {
      return;
    }
    if (!canSubmit) {
      // 按钮看起来是禁用样式，但点击仍会触发事件：不给提示就是「点了没反应」
      wx.showToast({ title: '先写点内容再提交', icon: 'none' });
      return;
    }
    const app = getApp();
    // 未登录（或 token 已失效）时不提交，先引导登录
    if (!app.globalData.token) {
      app.promptLogin({ force: true });
      return;
    }
    const fields = { text: text.trim(), anonymous: anonymous ? 'true' : 'false' };
    const files = imageUrls.map((filePath) => ({ fieldName: 'images', filePath }));

    this.setData({ submitting: true });
    multipart.uploadMultipart('/api/posts', fields, files, {
      Authorization: 'Bearer ' + app.globalData.token,
    }).then((res) => {
      this.setData({ submitting: false });
      if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.post) {
        const post = res.data.post;
        wx.showToast({ title: '已提交 #' + post.displayId, icon: 'success' });
        this.setData({ text: '', textLength: 0, imageUrls: [], canSubmit: false, anonymous: false });
        return;
      }
      wx.showModal({
        title: '投稿未提交',
        content: api.errorMessage(res, '投稿失败（HTTP ' + res.statusCode + '）'),
        showCancel: false,
      });
    }).catch((err) => {
      this.setData({ submitting: false });
      // 4xx 由 uploadMultipart 原样 resolve，走到这里通常是网络/超时；
      // 服务端真给了原因就用它，别再一律「网络错误」
      wx.showModal({
        title: '投稿未提交',
        content: api.errorMessage(err, '') || (err && err.errMsg) || '网络错误，请稍后重试',
        showCancel: false,
      });
    });
  },
});
