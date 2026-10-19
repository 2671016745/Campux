const api = require('../../utils/api.js');
const icons = require('../../utils/icons.js');

const ROLE_LABELS = {
  submitter: '用户',
  broadcaster: '广播员',
  reviewer: '审核员',
  admin: '管理员',
};

// 角色等级：与 custom-tab-bar/index.js 保持一致（审核相关入口按这个判权限）
const ROLE_RANK = { submitter: 1, broadcaster: 2, reviewer: 3, admin: 4 };

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

// 与服务端一致：只有待审核稿件可以取消（其余状态要走「撤回」流程）。
// 之前这里多了 publishing/failed/partially_failed，按钮会显示但接口 409，
// 又因为缺 .catch 而没有任何提示 —— 表现就是「点了没反应」。
const CANCELLABLE = ['pending_approval'];

// 各视图模式：按角色动态显示
const MODES = {
  mine: { label: '我的稿件', minRank: 1 },
  published: { label: '已发布', minRank: 1 },
  review: { label: '待审核', minRank: 3 },
  pending: { label: '待发布', minRank: 4 },
};

const CHANNEL_LABELS = {
  web: '网页投稿',
  private: '对话投稿',
  miniprogram: '小程序投稿',
  bot: '私聊投稿',
  onebot: '私聊投稿',
  qzone: '空间投稿',
};

const PAGE_SIZE = 10;

// 审核权限探测结果的缓存时长：普通用户不必每次进页面都白打一次 403
const REVIEW_PROBE_TTL = 5 * 60 * 1000;

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
    // 'mine' = 我的稿件；'review' = 待审核队列（reviewer 及以上才显示这个 tab）
    // 'published' = 已发布（全员可见）；'pending' = 待发布（仅管理员）
    mode: 'mine',
    canReview: false,
    modes: ['mine', 'published'],
    reviewBusyId: '',
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
    // 冷启动时 user/tenant 可能还没落地（/api/me 在飞）：等校验完再渲染，
    // 否则页头会先显示「校园墙」这种空值，看起来像登录态坏了。
    // 顺便用服务端确认一次审核权限（拉得动队列就显示「待审核」），
    // 不再只靠 app.role 推断 —— 角色字符串一有偏差，审核入口就整块消失。
    const render = () => {
      const t = app.globalData.currentTenant || {};
      const rank = ROLE_RANK[app.role] || 0;
      const canReview = rank >= ROLE_RANK.reviewer || app.globalData.reviewAllowed === true;
      // 按角色动态计算可用模式
      const modes = ['mine', 'published'];
      if (canReview) modes.push('review');
      if (rank >= ROLE_RANK.admin) modes.push('pending');
      // 当前模式不在可用列表里则回退到第一个
      const mode = modes.indexOf(this.data.mode) >= 0 ? this.data.mode : modes[0];
      this.setData({
        tenantName: t.name || '校园墙',
        logoUrl: t.logoUrl || '',
        roleLabel: ROLE_LABELS[app.role] || '',
        canReview,
        modes,
        mode,
      });
    };
    app.checkSession({ prompt: true }).then((ok) => {
      if (!ok) {
        this.setData({ loggedOut: true, posts: [], total: 0, pageCount: 1 });
        return;
      }
      this.probeReviewPermission().then(() => {
        render();
        // 角色这时才落地：tabBar 在 onShow 开头刷新时可能还按 submitter 渲染，
        // 管理员会少一个「管理」入口，这里补一次
        const tabBar = typeof this.getTabBar === 'function' ? this.getTabBar() : null;
        if (tabBar) {
          tabBar.refresh();
          tabBar.setSelected(1);
        }
        this.load(this.data.page);
      });
    });
  },

  /** 用服务端确认能不能审核（拉 1 条待审核队列），结果缓存在 globalData 里 */
  probeReviewPermission() {
    const app = getApp();
    if ((ROLE_RANK[app.role] || 0) >= ROLE_RANK.reviewer) {
      app.globalData.reviewAllowed = true;
      return Promise.resolve();
    }
    // true / false 都缓存：以前只缓存 true，普通用户每次切到本页都会再打一次 403
    const probedAt = app.globalData.reviewProbedAt || 0;
    if (typeof app.globalData.reviewAllowed === 'boolean' && Date.now() - probedAt < REVIEW_PROBE_TTL) {
      return Promise.resolve();
    }
    return api.fetchReviewPosts(1, 1).then(() => {
      app.globalData.reviewAllowed = true;
      app.globalData.reviewProbedAt = Date.now();
    }).catch(() => {
      app.globalData.reviewAllowed = false;
      app.globalData.reviewProbedAt = Date.now();
    });
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

  /** 切换视图模式（我的稿件 / 已发布 / 待审核 / 待发布） */
  switchMode(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!mode || mode === this.data.mode) {
      return;
    }
    if (mode === 'review' && !this.data.canReview) {
      return;
    }
    if (mode === 'pending' && (ROLE_RANK[getApp().role] || 0) < ROLE_RANK.admin) {
      return;
    }
    this.setData({ mode, page: 1, posts: [], total: 0, pageCount: 1, keyword: '' });
    this.load(1);
  },

  load(page) {
    this.setData({ loading: true });
    // 请求序号：快速切「我的稿件 / 待审核」或连点翻页时，
    // 先发后到的慢响应不许覆盖当前视图（否则会出现 tab 与列表对不上）
    this._loadSeq = (this._loadSeq || 0) + 1;
    const seq = this._loadSeq;
    const mode = this.data.mode;
    const isReview = mode === 'review';
    const isPending = mode === 'pending';
    const isPublished = mode === 'published';
    const keyword = this.data.keyword.trim();
    let req;
    if (isReview) {
      req = api.fetchReviewPosts(page, PAGE_SIZE);
    } else if (isPending) {
      req = api.fetchPendingPublish(page, PAGE_SIZE);
    } else if (isPublished) {
      req = api.fetchPublishedPosts(page, PAGE_SIZE);
    } else {
      let path = '/api/posts/mine?page=' + page + '&limit=' + PAGE_SIZE;
      if (keyword) {
        path += '&q=' + encodeURIComponent(keyword);
      }
      req = api.request(path);
    }
    return req.then((res) => {
      if (seq !== this._loadSeq) {
        return null;   // 已经有更新的请求了，丢弃这次结果
      }
      const data = res.data || {};
      const pagination = data.pagination || {};
      let posts;
      if (isPublished) {
        // 已发布返回的是按「说说」聚合的批次，字段是 items 不是 posts
        posts = (data.items || []).map((batch) => this.toPublishedView(batch));
      } else {
        posts = (data.posts || []).map((post) => this.toView(post, isReview || isPending));
      }
      this.setData({
        posts,
        loading: false,
        page: pagination.page || page,
        pageCount: pagination.pageCount || 1,
        total: pagination.total || posts.length,
      });
      this.resolveImages(posts);
      return null;
    }).catch((err) => {
      if (seq !== this._loadSeq) {
        return null;
      }
      this.setData({ loading: false });
      const status = err && err.res && err.res.statusCode;
      // 401 现在也走 reject（api 层已统一清会话），这里只把页面切到未登录态
      if (status === 401) {
        this.setData({ loggedOut: true, posts: [], total: 0, pageCount: 1 });
        return null;
      }
      if (status === 403 && isReview) {
        // 权限不够：退回「我的稿件」，别让人停在空的待审核页
        wx.showToast({ title: '没有审核权限', icon: 'none' });
        this.setData({ canReview: false, mode: 'mine' });
        this.load(1);
        return null;
      }
      if (status === 403 && isPending) {
        // 待发布仅管理员可见
        wx.showToast({ title: '没有权限', icon: 'none' });
        this.setData({ mode: 'mine' });
        this.load(1);
        return null;
      }
      wx.showToast({ title: api.errorMessage(err, '加载失败，请检查网络'), icon: 'none' });
      return null;
    });
  },

  /** 待发布模式：确认已发布（手动发到 QQ 空间后回来点） */
  confirmPublished(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.reviewBusyId) {
      return;
    }
    wx.showModal({
      title: '确认已发布？',
      content: '确认后该稿件会从待发布队列移除。',
      confirmText: '确认发布',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.setData({ reviewBusyId: id });
        api.confirmPendingPublish(id).then(() => {
          this.setData({ reviewBusyId: '' });
          wx.showToast({ title: '已确认', icon: 'success' });
          this.load(1);
        }).catch((err) => {
          this.setData({ reviewBusyId: '' });
          wx.showModal({ title: '操作失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
        });
      },
    });
  },

  /** 通过这条稿件 */
  approveReview(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.reviewBusyId) {
      return;
    }
    wx.showModal({
      title: '通过这条稿件？',
      content: '通过后会进入发布流程。',
      confirmText: '通过',
      cancelText: '再看看',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.setData({ reviewBusyId: id });
        api.approveReviewPost(id, '').then(() => {
          this.setData({ reviewBusyId: '' });
          wx.showToast({ title: '已通过', icon: 'success' });
          this.load(1);
        }).catch((err) => {
          this.setData({ reviewBusyId: '' });
          wx.showModal({ title: '操作失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
        });
      },
    });
  },

  /** 拒绝这条稿件（可填理由） */
  rejectReview(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.reviewBusyId) {
      return;
    }
    wx.showModal({
      title: '拒绝这条稿件',
      editable: true,
      placeholderText: '拒绝理由（可选，会记进时间线）',
      confirmText: '拒绝',
      cancelText: '取消',
      success: (res) => {
        if (!res.confirm) {
          return;
        }
        this.setData({ reviewBusyId: id });
        api.rejectReviewPost(id, (res.content || '').trim()).then(() => {
          this.setData({ reviewBusyId: '' });
          wx.showToast({ title: '已拒绝', icon: 'none' });
          this.load(1);
        }).catch((err) => {
          this.setData({ reviewBusyId: '' });
          wx.showModal({ title: '操作失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
        });
      },
    });
  },

  /** 已发布视图：把「说说」批次转成卡片数据。每条说说可能包含多条稿件。 */
  toPublishedView(batch) {
    const first = (batch.posts && batch.posts[0]) || {};
    const attachments = normalizeAttachments(first.attachments);
    const postCount = (batch.posts || []).length;
    const stats = batch.qzoneStats || {};
    const targets = stats.targets || [];
    const totalViews = targets.reduce((sum, t) => sum + (t.visitorCount || 0), 0);
    const totalLikes = targets.reduce((sum, t) => sum + (t.likeCount || 0), 0);
    const totalComments = targets.reduce((sum, t) => sum + (t.commentCount || 0), 0);
    return {
      id: batch.id || first.id || '',
      batchId: batch.id || '',
      displayId: first.displayId,
      title: first.title || first.text || '已发布说说',
      text: first.text || '',
      anonymous: first.anonymous,
      statusLabel: postCount > 1 ? '批量 ' + postCount + ' 条' : '独立发布',
      statusTone: 'active',
      cancellable: false,
      channelLabel: '',
      author: '',
      authorQq: '',
      attachmentCount: attachments.length,
      imageUrls: attachments.map((a) => a.url),
      textLength: (first.text || '').length,
      createdAt: formatDate(batch.publishedAt || first.createdAt),
      postCount,
      totalViews,
      totalLikes,
      totalComments,
      adminOnly: !!batch.adminOnly,
      publishedAt: batch.publishedAt || first.createdAt,
    };
  },

  /** 与服务端 toPostListItem 的字段对齐（title 即截断后的正文）。 */
  toView(post, isReview) {
    const attachments = normalizeAttachments(post.attachments);
    return {
      id: post.id,
      displayId: post.displayId,
      title: post.title || post.text,
      text: post.text,
      anonymous: post.anonymous,
      statusLabel: STATUS_LABELS[post.status] || post.status,
      statusTone: STATUS_TONES[post.status] || 'neutral',
      // 审核队列里不能取消别人的稿件
      cancellable: !isReview && CANCELLABLE.indexOf(post.status) >= 0,
      channelLabel: CHANNEL_LABELS[post.submissionChannel] || '',
      author: post.author ? post.author.displayName || '' : '',
      authorQq: post.author ? String(post.author.qqUin || '') : '',
      attachmentCount: attachments.length,
      imageUrls: attachments.map((a) => a.url),
      textLength: (post.text || '').length,
      createdAt: formatDate(post.createdAt),
    };
  },

  /** 附件是鉴权相对路径，<image src> 带不了 header，先下到本地临时文件再渲染。 */
  resolveImages(posts) {
    posts.forEach((post) => {
      (post.imageUrls || []).forEach((url, imageIndex) => {
        downloadImage(url).then((localPath) => {
          if (!localPath) {
            return;
          }
          // 下载是异步的：期间列表可能已经翻页 / 切 tab 被替换，
          // 不能再用闭包里的下标写回（会写到别的稿件卡片上），按 id 重新定位。
          const list = this.data.posts || [];
          const postIndex = list.findIndex((item) => item.id === post.id);
          if (postIndex < 0) {
            return;
          }
          if (list[postIndex].imageUrls[imageIndex] !== url) {
            return;   // 这一格已经换图了
          }
          this.setData({
            ['posts[' + postIndex + '].imageUrls[' + imageIndex + ']']: localPath,
          });
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
        api.cancelPost(id).then(() => {
          wx.showToast({ title: '已取消', icon: 'success' });
          this.load(this.data.page);
        }).catch((err) => {
          // 服务端对非待审核稿件回 409「只有待审核稿件可以取消」—— 原因要显示出来
          wx.showModal({ title: '取消失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
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
