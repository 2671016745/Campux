const { fetchBanRecords, banUser, unbanUser } = require('../../utils/api.js');

const DURATION_OPTIONS = [
  { label: '永久', value: 'permanent' },
  { label: '1天', value: '1d' },
  { label: '7天', value: '7d' },
  { label: '30天', value: '30d' },
];

function computeEndsAt(duration) {
  if (duration === 'permanent') return null;
  const days = parseInt(duration, 10);
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

Page({
  data: {
    icons: require('../../utils/icons.js'),
    tenantName: '',
    logoUrl: '',
    roleLabel: '',
    loggedOut: false,

    // 封禁表单
    banForm: {
      qqUin: '',
      comment: '',
      durationIndex: 0,
    },
    durationOptions: DURATION_OPTIONS,
    submitting: false,

    // 封禁列表
    bans: [],
    bansLoading: false,
    bansPage: 1,
    bansTotal: 0,
    bansLimit: 20,
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
      this.getTabBar().setSelected(3);
    }
    const app = getApp();
    if (!app.globalData.token) {
      this.setData({ loggedOut: true, bans: [] });
      app.promptLogin();
      return;
    }
    app.checkSession({ prompt: true }).then((ok) => {
      if (!ok) {
        this.setData({ loggedOut: true, bans: [] });
        return;
      }
      if (this.data.loggedOut) {
        this.setData({ loggedOut: false });
      }
      const tenant = app.globalData.currentTenant || {};
      this.setData({
        tenantName: tenant.name || '校园墙',
        logoUrl: tenant.logoUrl || '',
        roleLabel: app.roleLabel || '',
      });
      this.loadBans();
    });
  },

  // ── 封禁表单 ───────────────────────────────────────────────

  onQqUinInput(e) {
    this.setData({ 'banForm.qqUin': e.detail.value.replace(/\D/g, '') });
  },

  onCommentInput(e) {
    this.setData({ 'banForm.comment': e.detail.value });
  },

  onDurationChange(e) {
    this.setData({ 'banForm.durationIndex': Number(e.detail.value) });
  },

  async onSubmitBan() {
    const { qqUin, comment, durationIndex } = this.data.banForm;
    if (!qqUin.trim()) {
      wx.showToast({ title: '请输入 QQ 号', icon: 'none' });
      return;
    }
    if (!comment.trim()) {
      wx.showToast({ title: '请输入封禁原因', icon: 'none' });
      return;
    }
    const duration = DURATION_OPTIONS[durationIndex];
    const endsAt = computeEndsAt(duration.value);

    this.setData({ submitting: true });
    try {
      await banUser({
        userId: qqUin.trim(),
        comment: comment.trim(),
        endsAt: endsAt,
      });
      wx.showToast({ title: '已封禁', icon: 'success' });
      this.setData({
        'banForm.qqUin': '',
        'banForm.comment': '',
        'banForm.durationIndex': 0,
      });
      this.loadBans();
    } catch (err) {
      wx.showToast({ title: err.message || '封禁失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  },

  // ── 封禁列表 ───────────────────────────────────────────────

  async loadBans() {
    this.setData({ bansLoading: true });
    try {
      const res = await fetchBanRecords(this.data.bansPage, this.data.bansLimit);
      const data = res.data || {};
      this.setData({
        bans: data.bans || [],
        bansTotal: (data.pagination && data.pagination.total) || 0,
      });
    } catch (err) {
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ bansLoading: false });
    }
  },

  onBansPageChange(e) {
    const page = e.currentTarget.dataset.page;
    this.setData({ bansPage: page }, () => this.loadBans());
  },

  async onUnban(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: '确认解封',
      content: '确定要解除该用户的封禁吗？',
      confirmText: '解封',
      cancelText: '取消',
      success: async (res) => {
        if (!res.confirm) return;
        try {
          await unbanUser(id);
          wx.showToast({ title: '已解封', icon: 'success' });
          this.loadBans();
        } catch (err) {
          wx.showToast({ title: err.message || '解封失败', icon: 'none' });
        }
      },
    });
  },

  // ── 工具 ───────────────────────────────────────────────────

  formatDate(iso) {
    return formatDate(iso);
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => wx.redirectTo({ url: '/pages/login/login' }),
    });
  },
});
