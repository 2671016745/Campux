const api = require('../../utils/api.js');

Page({
  data: {
    loggedOut: false,
    loading: false,
    bots: [],
    // 新增表单
    form: { qqUin: '', displayName: '', platform: 'onebot' },
    creating: false,
    busyId: '',
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.token) {
      this.setData({ loggedOut: true });
      return;
    }
    app.checkSession({ prompt: false }).then(() => {
      this.setData({ loggedOut: false });
      this.load();
    });
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  load() {
    this.setData({ loading: true });
    return api.fetchBots().then((res) => {
      const d = res.data || {};
      const list = Array.isArray(d) ? d : (d.bots || []);
      const bots = list.map((b) => ({
        id: b.id,
        displayName: b.displayName || '',
        qqUin: String(b.qqUin || ''),
        platform: b.platform || 'onebot',
        enabled: !!b.enabled,
        reviewGroupId: b.reviewGroupId || '未设置',
        targets: (b.publishTargets && b.publishTargets.length) || 0,
        lastSeen: b.lastSeenAt ? formatDate(b.lastSeenAt) : '从未连接',
      }));
      this.setData({ bots, loading: false });
      return null;
    }).catch((err) => {
      this.setData({ loading: false });
      if (err && err.res && err.res.statusCode === 403) {
        wx.showModal({ title: '没有权限', content: '机器人管理仅管理员可访问。', showCancel: false });
        return null;
      }
      wx.showToast({ title: api.errorMessage(err, '加载失败'), icon: 'none' });
      return null;
    });
  },

  onQqInput(e) {
    this.setData({ 'form.qqUin': e.detail.value });
  },

  onNameInput(e) {
    this.setData({ 'form.displayName': e.detail.value });
  },

  createBot() {
    const f = this.data.form;
    const qqUin = String(f.qqUin || '').trim();
    const displayName = String(f.displayName || '').trim();
    if (!/^\d{5,12}$/.test(qqUin)) {
      wx.showToast({ title: '请输入正确的 QQ 号', icon: 'none' });
      return;
    }
    if (!displayName) {
      wx.showToast({ title: '请输入机器人名称', icon: 'none' });
      return;
    }
    if (this.data.creating) return;
    this.setData({ creating: true });
    api.createBot({ qqUin: qqUin, displayName: displayName, platform: f.platform || 'onebot' }).then(() => {
      this.setData({ creating: false, form: { qqUin: '', displayName: '', platform: 'onebot' } });
      wx.showToast({ title: '已添加', icon: 'success' });
      this.load();
    }).catch((err) => {
      this.setData({ creating: false });
      wx.showModal({ title: '添加失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
    });
  },

  toggleBot(e) {
    const id = e.currentTarget.dataset.id;
    const enabled = !!this.data.bots.find((b) => b.id === id).enabled;
    if (!id || this.data.busyId) return;
    this.setData({ busyId: id });
    api.updateBot(id, { enabled: !enabled }).then(() => {
      this.setData({ busyId: '' });
      this.load();
    }).catch((err) => {
      this.setData({ busyId: '' });
      wx.showModal({ title: '操作失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
    });
  },

  removeBot(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.busyId) return;
    wx.showModal({
      title: '删除这个机器人？',
      content: '删除后该机器人的登录态与发布目标也会移除，不可恢复。',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: (r) => {
        if (!r.confirm) return;
        this.setData({ busyId: id });
        api.deleteBot(id).then(() => {
          this.setData({ busyId: '' });
          wx.showToast({ title: '已删除', icon: 'none' });
          this.load();
        }).catch((err) => {
          this.setData({ busyId: '' });
          wx.showModal({ title: '删除失败', content: api.errorMessage(err, '请稍后重试'), showCancel: false });
        });
      },
    });
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
