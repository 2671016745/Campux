const api = require('../../utils/api.js');
const icons = require('../../utils/icons.js');

const STATUS_LABELS = {
  pending_approval: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
  publishing: '发布中',
  partially_failed: '部分失败',
  failed: '发布失败',
  waiting_cookies: '等待登录态',
  published: '已发布',
  pending_recall: '待撤回',
  recalled: '已撤回',
};

const STATUS_TONES = {
  pending_approval: 'pending',
  approved: 'active',
  published: 'active',
};

const CHANNEL_LABELS = {
  web: '网页投稿',
  private: '对话投稿',
  miniprogram: '小程序投稿',
  bot: '私聊投稿',
  onebot: '私聊投稿',
  qzone: '空间投稿',
};

Page({
  data: {
    icons,
    tenantName: '',
    logoUrl: '',
    roleLabel: '',
    post: null,
    statusLabel: '',
    statusTone: 'neutral',
    textLength: 0,
    createdAt: '',
    updatedAt: '',
    authorName: '',
    authorQq: '',
    channelLabel: '',
    imageUrls: [],
    busy: false,
  },

  onLoad() {
    const app = getApp();
    const t = app.globalData.currentTenant || {};
    const post = app.globalData.selectedPost;

    if (!post) {
      wx.showToast({ title: '未找到稿件', icon: 'none' });
      return;
    }

    const statusLabel = STATUS_LABELS[post.status] || post.status;
    const statusTone = STATUS_TONES[post.status] || 'neutral';
    const textLength = (post.text || '').length;
    const createdAt = formatDate(post.createdAt);
    const updatedAt = formatDate(post.updatedAt);
    const authorName = post.author ? (post.author.displayName || '匿名') : '匿名';
    const authorQq = post.author ? String(post.author.qqUin || '') : '';
    const channelLabel = CHANNEL_LABELS[post.submissionChannel] || '';

    this.setData({
      tenantName: t.name || '校园墙',
      logoUrl: t.logoUrl || '',
      roleLabel: '',
      post,
      statusLabel,
      statusTone,
      textLength,
      createdAt,
      updatedAt,
      authorName,
      authorQq,
      channelLabel,
    });
    this.resolveImages(post);
  },

  /** 附件是鉴权相对路径，<image src> 带不了 header，先下到本地临时文件再渲染。 */
  resolveImages(post) {
    const attachments = this.normalizeAttachments(post.attachments);
    const urls = attachments.map((a) => a.url);
    this.setData({ imageUrls: urls });
    urls.forEach((url, index) => {
      this.downloadImage(url).then((localPath) => {
        if (!localPath) return;
        const current = this.data.imageUrls;
        if (current[index] !== url) return;
        this.setData({ ['imageUrls[' + index + ']']: localPath });
      });
    });
  },

  normalizeAttachments(attachments) {
    if (!attachments) return [];
    let list = attachments;
    if (typeof attachments === 'string') {
      try { list = JSON.parse(attachments); } catch (e) { return []; }
    }
    if (!Array.isArray(list)) return [];
    return list
      .map((item) => (item && typeof item === 'object' && typeof item.url === 'string' ? { url: item.url } : null))
      .filter(Boolean);
  },

  downloadImage(url) {
    if (!url) return Promise.resolve('');
    if (/^https?:\/\//.test(url)) return Promise.resolve(url);
    const token = api.getToken();
    if (!token) return Promise.resolve('');
    return new Promise((resolve) => {
      wx.downloadFile({
        url: api.baseUrl() + url,
        header: { Authorization: 'Bearer ' + token },
        success: (res) => {
          if (res.statusCode === 200 && res.tempFilePath) {
            resolve(res.tempFilePath);
          } else {
            resolve('');
          }
        },
        fail: () => resolve(''),
      });
    });
  },

  previewImage(event) {
    const urls = event.currentTarget.dataset.urls || [];
    const index = event.currentTarget.dataset.index || 0;
    if (urls.length) {
      wx.previewImage({ urls, current: urls[index] });
    }
  },

  toggleFollow() {
    const post = this.data.post;
    if (!post || this.data.busy) return;
    const isFollowed = post.isFollowed;
    this.setData({ busy: true });
    const req = isFollowed ? api.unfollowPost(post.id) : api.followPost(post.id);
    req.then(() => {
      this.setData({ busy: false });
      wx.showToast({ title: isFollowed ? '已取消关注' : '已关注', icon: 'success' });
      const updated = Object.assign({}, this.data.post, { isFollowed: !isFollowed });
      this.setData({ post: updated });
      getApp().globalData.selectedPost = updated;
    }).catch((err) => {
      this.setData({ busy: false });
      wx.showToast({ title: api.errorMessage(err, '操作失败'), icon: 'none' });
    });
  },

  requestRecall() {
    const post = this.data.post;
    if (!post || this.data.busy) return;
    wx.showModal({
      title: '申请撤回',
      content: '确定要申请撤回这条稿件吗？',
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        api.requestRecall(post.id).then(() => {
          this.setData({ busy: false });
          wx.showToast({ title: '已提交撤回申请', icon: 'success' });
          const updated = Object.assign({}, this.data.post, { status: 'pending_recall' });
          this.setData({
            post: updated,
            statusLabel: STATUS_LABELS[updated.status] || updated.status,
            statusTone: STATUS_TONES[updated.status] || 'neutral',
          });
          getApp().globalData.selectedPost = updated;
        }).catch((err) => {
          this.setData({ busy: false });
          wx.showToast({ title: api.errorMessage(err, '操作失败'), icon: 'none' });
        });
      },
    });
  },

  cancelPost() {
    const post = this.data.post;
    if (!post || this.data.busy) return;
    wx.showModal({
      title: '取消这条稿件？',
      content: '取消后该稿件不会再进入审核。',
      confirmText: '取消稿件',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ busy: true });
        api.cancelPost(post.id).then(() => {
          this.setData({ busy: false });
          wx.showToast({ title: '已取消', icon: 'success' });
          const updated = Object.assign({}, this.data.post, { status: 'cancelled' });
          this.setData({
            post: updated,
            statusLabel: STATUS_LABELS[updated.status] || updated.status,
            statusTone: STATUS_TONES[updated.status] || 'neutral',
          });
          getApp().globalData.selectedPost = updated;
        }).catch((err) => {
          this.setData({ busy: false });
          wx.showToast({ title: api.errorMessage(err, '操作失败'), icon: 'none' });
        });
      },
    });
  },
});

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (isNaN(date.getTime())) return '';
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate() + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}
