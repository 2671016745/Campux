const api = require('../../utils/api.js');
const icons = require('../../utils/icons.js');

const ROLE_LABELS = {
  submitter: '用户',
  broadcaster: '广播员',
  reviewer: '审核员',
  admin: '管理员',
};

// 与网页端 app-model.ts 的 statusLabels 一致
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

const CANCELLABLE = ['pending_approval', 'publishing', 'failed', 'partially_failed'];

const CHANNEL_LABELS = {
  web: '网页投稿',
  bot: '私聊投稿',
  onebot: '私聊投稿',
  qzone: '空间投稿',
};

const PAGE_SIZE = 10;

Page({
  data: {
    icons,
    tenantName: '',
    logoUrl: '',
    roleLabel: '',
    posts: [],
    page: 1,
    pageCount: 1,
    total: 0,
    keyword: '',
    loading: false,
    loggedOut: false,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
      this.getTabBar().setSelected(1);
    }
    const app = getApp();
    // 未登录不硬跳登录页：弹「去登录 / 随便看看」，页面显示未登录占位
    if (!app.globalData.token) {
      this.setData({ loggedOut: true, posts: [], total: 0, pageCount: 1 });
      app.promptLogin();
      return;
    }
    if (this.data.loggedOut) {
      this.setData({ loggedOut: false });
    }
    const tenant = app.globalData.currentTenant || {};
    this.setData({
      tenantName: tenant.name || '校园墙',
      logoUrl: tenant.logoUrl || '',
      roleLabel: ROLE_LABELS[app.role] || '',
    });
    this.load(this.data.page);
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => wx.redirectTo({ url: '/pages/login/login' }),
    });
  },

  onPullDownRefresh() {
    this.load(this.data.page).finally(() => wx.stopPullDownRefresh());
  },

  onKeywordInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  refresh() {
    this.load(1);
  },

  prevPage() {
    if (this.data.page > 1) {
      this.load(this.data.page - 1);
    }
  },

  nextPage() {
    if (this.data.page < this.data.pageCount) {
      this.load(this.data.page + 1);
    }
  },

  load(page) {
    this.setData({ loading: true });
    const keyword = this.data.keyword.trim();
    let path = '/api/posts/mine?page=' + page + '&limit=' + PAGE_SIZE;
    if (keyword) {
      path += '&q=' + encodeURIComponent(keyword);
    }
    return api.request(path).then((res) => {
      if (res.statusCode === 401) {
        getApp().clearSession();
        this.setData({ loggedOut: true, posts: [], total: 0, pageCount: 1, loading: false });
        getApp().promptLogin();
        return null;
      }
      const data = res.data || {};
      const pagination = data.pagination || {};
      const posts = (data.posts || []).map((post) => this.toView(post));
      this.setData({
        posts,
        loading: false,
        page: pagination.page || page,
        pageCount: pagination.pageCount || 1,
        total: pagination.total || posts.length,
      });
      this.resolveImages(posts);
      return null;
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败，请检查网络', icon: 'none' });
      return null;
    });
  },

  /** 与服务端 toPostListItem 的字段对齐（title 即截断后的正文）。 */
  toView(post) {
    const attachments = normalizeAttachments(post.attachments);
    return {
      id: post.id,
      displayId: post.displayId,
      title: post.title || post.text,
      text: post.text,
      anonymous: post.anonymous,
      statusLabel: STATUS_LABELS[post.status] || post.status,
      statusTone: STATUS_TONES[post.status] || 'neutral',
      cancellable: CANCELLABLE.indexOf(post.status) >= 0,
      channelLabel: CHANNEL_LABELS[post.submissionChannel] || '',
      attachmentCount: attachments.length,
      imageUrls: attachments.map((a) => a.url),
      textLength: (post.text || '').length,
      createdAt: formatDate(post.createdAt),
    };
  },

  /** 附件是鉴权相对路径，<image src> 带不了 header，先下到本地临时文件再渲染。 */
  resolveImages(posts) {
    posts.forEach((post, postIndex) => {
      post.imageUrls.forEach((url, imageIndex) => {
        downloadImage(url).then((localPath) => {
          if (localPath) {
            this.setData({
              ['posts[' + postIndex + '].imageUrls[' + imageIndex + ']']: localPath,
            });
          }
        });
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

  /** 预览图：与网页端一致，取服务端渲染的说说预览图（GET /api/posts/:id/render-preview）。 */
  previewPost(event) {
    const id = event.currentTarget.dataset.id;
    const token = api.getToken();
    if (!token) {
      getApp().promptLogin({ force: true });
      return;
    }
    wx.showLoading({ title: '生成预览图…' });
    wx.downloadFile({
      url: api.baseUrl() + '/api/posts/' + id + '/render-preview',
      header: { Authorization: 'Bearer ' + token },
      success: (res) => {
        wx.hideLoading();
        if (res.statusCode === 200 && res.tempFilePath) {
          wx.previewImage({ urls: [res.tempFilePath] });
          return;
        }
        wx.showModal({ title: '预览图生成失败', content: '服务端返回 HTTP ' + res.statusCode, showCancel: false });
      },
      fail: () => {
        wx.hideLoading();
        wx.showModal({ title: '预览图生成失败', content: '网络错误，请稍后重试', showCancel: false });
      },
    });
  },

  cancelPost(event) {
    const id = event.currentTarget.dataset.id;
    wx.showModal({
      title: '取消这条稿件？',
      content: '取消后该稿件不会再进入审核。',
      confirmText: '取消稿件',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        api.cancelPost(id).then((resp) => {
          if (resp.statusCode >= 200 && resp.statusCode < 300) {
            wx.showToast({ title: '已取消', icon: 'success' });
            this.load(this.data.page);
            return;
          }
          wx.showModal({ title: '取消失败', content: api.errorMessage(resp, '请稍后重试'), showCancel: false });
        });
      },
    });
  },
});

function normalizeAttachments(attachments) {
  if (!attachments) {
    return [];
  }
  let list = attachments;
  if (typeof attachments === 'string') {
    try {
      list = JSON.parse(attachments);
    } catch (e) {
      return [];
    }
  }
  if (!Array.isArray(list)) {
    return [];
  }
  return list
    .map((item) => (item && typeof item === 'object' && typeof item.url === 'string' ? { url: item.url } : null))
    .filter(Boolean);
}

const imageCache = {};

function downloadImage(url) {
  if (!url) {
    return Promise.resolve('');
  }
  if (/^https?:\/\//.test(url)) {
    return Promise.resolve(url);
  }
  if (imageCache[url]) {
    return Promise.resolve(imageCache[url]);
  }
  const token = api.getToken();
  if (!token) {
    return Promise.resolve('');
  }
  return new Promise((resolve) => {
    wx.downloadFile({
      url: api.baseUrl() + url,
      header: { Authorization: 'Bearer ' + token },
      success: (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          imageCache[url] = res.tempFilePath;
          resolve(res.tempFilePath);
        } else {
          resolve('');
        }
      },
      fail: () => resolve(''),
    });
  });
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return '';
  }
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate() + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}
