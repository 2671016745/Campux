const api = require('../../utils/api.js');

// 附件/头像走鉴权接口（GET /api/uploads/post-image 需要登录态），
// 小程序的 <image src> 无法携带 Authorization 头，因此先用 wx.downloadFile
// （支持自定义 header）下载到本地临时文件，再把本地路径交给 <image>。
// 会话内缓存，避免重复下载。
const imageCache = {};

const ROLE_LABELS = {
  submitter: '用户',
  broadcaster: '广播员',
  reviewer: '审核员',
  admin: '管理员',
};

const STATUS_LABELS = {
  pending_approval: '待审核',
  approved: '已通过',
  rejected: '未通过',
  publishing: '发布中',
  published: '已发布',
  publish_failed: '发布失败',
  pending_recall: '撤回中',
  recalled: '已撤回',
  cancelled: '已取消',
};

Page({
  data: {
    bannerText: '欢迎使用 Campux 校园墙',
    loggedIn: false,
    loggingIn: false,
    binding: false,
    unbound: false,
    account: '',
    password: '',
    userName: '',
    tenantName: '',
    tenantLogo: '',
    roleLabel: '',
    posts: [],
    loadingPosts: false,
  },

  onShow() {
    this.refresh();
  },

  onPullDownRefresh() {
    this.refresh().then(() => wx.stopPullDownRefresh());
  },

  /** 拉取登录态；已登录再拉稿件列表。 */
  refresh() {
    const app = getApp();
    if (!app.globalData.token) {
      this.setData({ loggedIn: false, posts: [] });
      return Promise.resolve();
    }
    return api.fetchMe().then((res) => {
      if (res.statusCode === 401 || !res.data || !res.data.authenticated) {
        app.clearSession();
        this.setData({ loggedIn: false, posts: [] });
        return null;
      }
      this.applySession(res.data);
      return this.loadPosts();
    }).catch(() => {
      this.setData({ loggedIn: false });
      return null;
    });
  },

  applySession(data) {
    const app = getApp();
    app.globalData.user = data.user;
    app.globalData.currentTenant = data.currentTenant;
    app.globalData.currentMembership = data.currentMembership;
    const tenant = data.currentTenant || {};
    this.setData({
      loggedIn: true,
      unbound: false,
      userName: (data.user && data.user.displayName) || '',
      tenantName: tenant.name || '未加入校园墙',
      tenantLogo: tenant.logoUrl || '',
      roleLabel: ROLE_LABELS[(data.currentMembership && data.currentMembership.role) || ''] || '无权限',
      bannerText: tenant.name ? tenant.name + ' · 欢迎投稿' : this.data.bannerText,
    });
    // 墙 logo 同样可能是鉴权相对路径，异步换成可渲染的本地路径。
    if (tenant.logoUrl) {
      this.downloadImage(tenant.logoUrl).then((localPath) => {
        if (localPath) {
          this.setData({ tenantLogo: localPath });
        }
      });
    }
  },

  loadPosts() {
    this.setData({ loadingPosts: true });
    return api.fetchPosts(1, 10).then((res) => {
      const list = (res.data && res.data.posts) || [];
      const posts = list.map((post) => ({
        id: post.id,
        displayId: post.displayId,
        text: post.text,
        anonymous: post.anonymous,
        statusLabel: STATUS_LABELS[post.status] || post.status,
        imageUrls: extractImageUrls(post.attachments),
      }));
      this.setData({ posts, loadingPosts: false });
      this.resolvePostImages(posts);
    }).catch(() => {
      this.setData({ loadingPosts: false });
    });
  },

  /** 把相对路径的图片下载成本地临时文件，逐张回填（下载失败则保持空串不显示）。 */
  resolvePostImages(posts) {
    posts.forEach((post, postIndex) => {
      post.imageUrls.forEach((url, imageIndex) => {
        this.downloadImage(url).then((localPath) => {
          if (localPath) {
            this.setData({
              ['posts[' + postIndex + '].imageUrls[' + imageIndex + ']']: localPath,
            });
          }
        });
      });
    });
  },

  downloadImage(url) {
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
  },

  // ─── 登录 ─────────────────────────────────────────────────────────────
  onWechatLogin() {
    this.setData({ loggingIn: true });
    api.wechatLogin().then((res) => {
      this.setData({ loggingIn: false });
      const data = res.data || {};
      if (data.authenticated && data.token) {
        getApp().setSession(data);
        this.applySession(data);
        this.loadPosts();
        wx.showToast({ title: '登录成功', icon: 'success' });
        return;
      }
      if (data.unbound) {
        this.setData({ unbound: true });
        wx.showToast({ title: '请先绑定账号', icon: 'none' });
        return;
      }
      wx.showToast({ title: api.errorMessage(res, '登录失败'), icon: 'none' });
    }).catch((err) => {
      this.setData({ loggingIn: false });
      wx.showToast({ title: (err && err.message) || '登录失败', icon: 'none' });
    });
  },

  onAccountInput(e) {
    this.setData({ account: e.detail.value });
  },

  onPasswordInput(e) {
    this.setData({ password: e.detail.value });
  },

  onBind() {
    const { account, password } = this.data;
    if (!account.trim()) {
      wx.showToast({ title: '请输入 QQ 号或 QQ 邮箱', icon: 'none' });
      return;
    }
    if (!password) {
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }
    this.setData({ binding: true });
    api.wechatBind(account.trim(), password).then((res) => {
      this.setData({ binding: false });
      const data = res.data || {};
      if (data.authenticated && data.token) {
        getApp().setSession(data);
        this.setData({ password: '' });
        this.applySession(data);
        this.loadPosts();
        wx.showToast({ title: '绑定成功', icon: 'success' });
        return;
      }
      wx.showToast({ title: api.errorMessage(res, '绑定失败'), icon: 'none' });
    }).catch(() => {
      this.setData({ binding: false });
      wx.showToast({ title: '绑定失败，请重试', icon: 'none' });
    });
  },

  onLogout() {
    api.logout().then(() => {
      getApp().clearSession();
      this.setData({ loggedIn: false, posts: [], account: '', password: '', unbound: false });
      wx.showToast({ title: '已退出', icon: 'none' });
    });
  },

  onPreviewImage(e) {
    const urls = e.currentTarget.dataset.urls || [];
    const index = e.currentTarget.dataset.index || 0;
    if (urls.length > 0) {
      wx.previewImage({ urls, current: urls[index] });
    }
  },
});

/** attachments 是服务端存的附件数组，图片项带 url 字段。 */
function extractImageUrls(attachments) {
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
    .map((item) => (item && typeof item === 'object' && typeof item.url === 'string' ? item.url : null))
    .filter((url) => Boolean(url));
}
