const api = require('../../utils/api');

Page({
  data: {
    loading: true,
    hasBan: false,
    banComment: '',
    banEndsAt: '',
    displayName: '',
    tenantName: '',
  },

  onLoad() {
    this.loadBanInfo();
  },

  async loadBanInfo() {
    try {
      const res = await api.fetchMe();
      const me = res.data || {};
      const ban = me.activeBan;

      if (ban) {
        this.setData({
          loading: false,
          hasBan: true,
          banComment: ban.comment || '暂无原因',
          banEndsAt: this.formatDateTime(ban.endsAt),
          displayName: me.user?.displayName || me.user?.qqUin || '',
          tenantName: me.tenant?.name || '',
        });
      } else {
        this.setData({ loading: false, hasBan: false });
      }
    } catch (err) {
      this.setData({ loading: false, hasBan: false });
    }
  },

  formatDateTime(value) {
    if (!value) return '永久';
    const d = new Date(value);
    if (isNaN(d.getTime())) return '永久';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  goBack() {
    wx.navigateBack({ delta: 1 });
  },

  onLogout() {
    wx.showModal({
      title: '退出登录',
      content: '确定要退出登录吗？',
      success: (r) => {
        if (r.confirm) {
          api.logout().finally(() => {
            wx.removeStorageSync('token');
            wx.reLaunch({ url: '/pages/login/login' });
          });
        }
      },
    });
  },
});
