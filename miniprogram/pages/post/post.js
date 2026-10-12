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
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
      this.getTabBar().setSelected(0);
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
    }).catch(() => null);
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
    if (submitting || !canSubmit) {
      return;
    }
    const app = getApp();
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
      wx.showModal({
        title: '投稿未提交',
        content: (err && err.errMsg) || '网络错误，请稍后重试',
        showCancel: false,
      });
    });
  },
});
