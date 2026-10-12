const api = require('../../../utils/api.js');
const multipart = require('../../../utils/multipart.js');

const MAX_IMAGES = 3;

Page({
  data: {
    bannerText: '今日校园',
    loggedIn: false,
    text: '',
    imageUrls: [],
    showAnonymous: false,
    showRules: false,
    rulesText: '投稿请遵守校园墙规则：禁止人身攻击、泄露隐私、违法违规与商业广告内容；违规稿件将被删除并可能封禁账号。',
    submitting: false,
    lastResult: '',
  },

  onShow() {
    const app = getApp();
    this.setData({
      loggedIn: Boolean(app.globalData.token),
      bannerText: (app.globalData.currentTenant && app.globalData.currentTenant.name) || '今日校园',
    });
  },

  goLogin() {
    wx.switchTab({ url: '/pages/index/index' });
  },

  onTextareaInput(e) {
    this.setData({ text: e.detail.value });
  },

  chooseImage() {
    const remain = MAX_IMAGES - this.data.imageUrls.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 ' + MAX_IMAGES + ' 张图片', icon: 'none' });
      return;
    }
    wx.chooseImage({
      count: remain,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        this.setData({ imageUrls: this.data.imageUrls.concat(res.tempFilePaths) });
      },
    });
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index;
    const next = this.data.imageUrls.slice();
    next.splice(index, 1);
    this.setData({ imageUrls: next });
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index;
    wx.previewImage({ urls: this.data.imageUrls, current: this.data.imageUrls[index] });
  },

  toggleAnonymous() {
    this.setData({ showAnonymous: !this.data.showAnonymous });
  },

  toggleRules() {
    this.setData({ showRules: !this.data.showRules });
  },

  submitPost() {
    const { text, imageUrls, showAnonymous, showRules } = this.data;
    const app = getApp();

    if (!app.globalData.token) {
      wx.showToast({ title: '请先登录', icon: 'none' });
      return;
    }
    if (!text.trim() && imageUrls.length === 0) {
      wx.showToast({ title: '请输入内容或选择图片', icon: 'none' });
      return;
    }

    // 与服务端 /api/posts 的 multipart 字段保持一致（text / anonymous / images）。
    const fields = {
      text: showRules ? text.trim() + '\n\n' + this.data.rulesText : text.trim(),
      anonymous: showAnonymous ? 'true' : 'false',
    };
    const files = imageUrls.map((filePath) => ({ fieldName: 'images', filePath }));

    this.setData({ submitting: true });
    multipart.uploadMultipart('/api/posts', fields, files, {
      Authorization: 'Bearer ' + app.globalData.token,
    }).then((res) => {
      this.setData({ submitting: false });
      if (res.statusCode >= 200 && res.statusCode < 300 && res.data && res.data.post) {
        const post = res.data.post;
        this.setData({
          text: '',
          imageUrls: [],
          lastResult: '提交成功：#' + post.displayId + '（' + (post.status || 'pending_approval') + '），可在「投稿」页查看状态',
        });
        wx.showToast({ title: '投稿成功', icon: 'success' });
        return;
      }
      const message = api.errorMessage(res, '投稿失败（HTTP ' + res.statusCode + '）');
      this.setData({ lastResult: '提交失败：' + message });
      wx.showToast({ title: message, icon: 'none' });
    }).catch((err) => {
      this.setData({ submitting: false, lastResult: '提交失败：网络错误' });
      wx.showToast({ title: (err && err.errMsg) || '网络错误', icon: 'none' });
    });
  },
});
