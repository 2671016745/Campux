const api = require('../../utils/api.js');

Page({
  data: {
    loggedOut: false,
    loading: false,
    posts: [],
    page: 1,
    pageCount: 1,
    total: 0,
    busyId: '',
    selected: {},
    selectedCount: 0,
    batchBusy: false,
    residualText: '',
    requeueBusy: false,
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.token) {
      this.setData({ loggedOut: true });
      return;
    }
    app.checkSession({ prompt: false }).then(() => {
      this.setData({ loggedOut: false });
      this.load(1);
      this.loadResidual();
    });
  },

  onPullDownRefresh() {
    this.load(1).finally(() => wx.stopPullDownRefresh());
  },

  load(page) {
    this.setData({ loading: true });
    this._seq = (this._seq || 0) + 1;
    const seq = this._seq;
    return api.fetchPendingPublish(page, 10).then((res) => {
      if (seq !== this._seq) return null;
      const d = res.data || {};
      const pg = d.pagination || {};
      const posts = (d.posts || []).map((p) => ({
        id: p.id,
        displayId: p.displayId,
        text: p.text || '',
        anonymous: !!p.anonymous,
        attachmentCount: p.attachmentCount || 0,
        createdAt: formatDate(p.createdAt),
        author: (p.author && (p.author.displayName || p.author.qqUin)) || '',
      }));
      // 保持已勾选状态（只保留仍在本页的）
      const selected = {};
      let count = 0;
      posts.forEach((p) => {
        if (this.data.selected[p.id]) {
          selected[p.id] = true;
          count += 1;
        }
      });
      this.setData({
        posts,
        loading: false,
        page: pg.page || page,
        pageCount: pg.pageCount || 1,
        total: pg.total || posts.length,
        selected,
        selectedCount: count,
      });
      return null;
    }).catch((err) => {
      if (seq !== this._seq) return null;
      this.setData({ loading: false });
      if (err && err.res && err.res.statusCode === 403) {
        wx.showModal({ title: '没有权限', content: '待发布队列仅管理员可访问。', showCancel: false });
        return null;
      }
      wx.showToast({ title: api.errorMessage(err, '加载失败'), icon: 'none' });
      return null;
    });
  },

  loadResidual() {
    api.fetchPendingPublishResidual().then((res) => {
      const d = res.data || {};
      const mode = d.operateMode === 'manual' ? '无 Bot（手动发布）' : 'Bot 自动发布';
      this.setData({
        residualText: mode + ' · 滞留 ' + (d.residual || 0) + ' 条',
      });
    }).catch(() => null);
  },

  toggleSelect(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    const selected = Object.assign({}, this.data.selected);
    if (selected[id]) {
      delete selected[id];
    } else {
      selected[id] = true;
    }
    let count = 0;
    Object.keys(selected).forEach((k) => { if (selected[k]) count += 1; });
    this.setData({ selected, selectedCount: count });
  },

  confirmOne(event) {
    const id = event.currentTarget.dataset.id;
    if (!id || this.data.busyId) return;
    wx.showModal({
      title: '确认已发布？',
      content: '确认后该稿件会离开待发布队列。',
      confirmText: '确认',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ busyId: id });
        api.confirmPendingPublish(id).then(() => {
          this.setData({ busyId: '' });
          wx.showToast({ title: '已确认', icon: 'success' });
          this.load(this.data.page);
        }).catch((err) => {
          this.setData({ busyId: '' });
          wx.showModal({ title: '确认失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
        });
      },
    });
  },

  confirmBatch() {
    const ids = Object.keys(this.data.selected).filter((k) => this.data.selected[k]);
    if (!ids.length || this.data.batchBusy) {
      wx.showToast({ title: '先勾选稿件', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '批量确认 ' + ids.length + ' 条？',
      content: '逐条独立处理，单条失败不会回滚其余稿件。',
      confirmText: '确认',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ batchBusy: true });
        api.confirmPendingPublishBatch(ids).then((res) => {
          this.setData({ batchBusy: false, selected: {}, selectedCount: 0 });
          const d = res.data || {};
          const fails = (d.failures || []).length;
          wx.showModal({
            title: fails ? '部分成功' : '已全部确认',
            content: fails ? ('成功 ' + ((d.confirmedDisplayIds || []).length) + ' 条，失败 ' + fails + ' 条') : '共确认 ' + ids.length + ' 条',
            showCancel: false,
          });
          this.load(1);
        }).catch((err) => {
          this.setData({ batchBusy: false });
          wx.showModal({ title: '批量确认失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
        });
      },
    });
  },

  requeue() {
    if (this.data.requeueBusy) return;
    wx.showModal({
      title: '补入自动发布队列？',
      content: '把滞留的已通过稿件重新排进 Bot 自动发布队列。',
      confirmText: '补入',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ requeueBusy: true });
        api.requeuePendingPublish().then((res) => {
          this.setData({ requeueBusy: false });
          const n = (res.data && res.data.requeued) || 0;
          wx.showToast({ title: '已补入 ' + n + ' 条', icon: 'none' });
          this.load(1);
          this.loadResidual();
        }).catch((err) => {
          this.setData({ requeueBusy: false });
          wx.showModal({ title: '补入失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
        });
      },
    });
  },

  prevPage() {
    if (this.data.page > 1) this.load(this.data.page - 1);
  },

  nextPage() {
    if (this.data.page < this.data.pageCount) this.load(this.data.page + 1);
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login', fail: () => wx.redirectTo({ url: '/pages/login/login' }) });
  },
});

function formatDate(value) {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
