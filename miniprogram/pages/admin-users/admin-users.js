const api = require('../../utils/api.js');

const ROLE_LABELS = {
  submitter: '用户',
  reviewer: '审核员',
  admin: '管理员',
};

const ROLE_OPTIONS = ['submitter', 'reviewer', 'admin'];

Page({
  data: {
    members: [],
    pagination: { page: 1, limit: 20, total: 0, pageCount: 0 },
    tenantMemberTotal: 0,
    keyword: '',
    page: 1,
    limit: 20,
    loading: false,
    // 添加用户表单
    inviteAccount: '',
    inviteRole: 'submitter',
    inviteBusy: false,
    loggedOut: false,
  },

  onLoad() {
    this.loadMembers();
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.token) {
      this.setData({ loggedOut: true });
      app.promptLogin();
      return;
    }
    if (this.data.loggedOut) {
      this.setData({ loggedOut: false });
    }
  },

  async loadMembers() {
    this.setData({ loading: true });
    try {
      const res = await api.fetchAdminMembers(this.data.page, this.data.limit, this.data.keyword);
      const d = res.data || {};
      this.setData({
        members: d.members || [],
        pagination: d.pagination || { page: 1, limit: 20, total: 0, pageCount: 0 },
        tenantMemberTotal: d.tenantMemberTotal || 0,
      });
    } catch (err) {
      wx.showToast({ title: api.errorMessage(err, '加载失败'), icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearch() {
    this.setData({ page: 1 });
    this.loadMembers();
  },

  onClearSearch() {
    this.setData({ keyword: '', page: 1 });
    this.loadMembers();
  },

  onPrevPage() {
    if (this.data.page <= 1) return;
    this.setData({ page: this.data.page - 1 });
    this.loadMembers();
  },

  onNextPage() {
    if (this.data.page >= (this.data.pagination.pageCount || 1)) return;
    this.setData({ page: this.data.page + 1 });
    this.loadMembers();
  },

  onMemberTap(e) {
    const index = e.currentTarget.dataset.index;
    const member = this.data.members[index];
    if (!member) return;
    wx.showActionSheet({
      itemList: ROLE_OPTIONS.map((r) => ROLE_LABELS[r]),
      success: (res) => {
        const role = ROLE_OPTIONS[res.tapIndex];
        if (role && role !== member.role) {
          this.changeRole(member, role);
        }
      },
    });
  },

  async changeRole(member, role) {
    wx.showLoading({ title: '更新中' });
    try {
      await api.updateMemberRole(member.id, role);
      wx.showToast({ title: '身份已更新', icon: 'success' });
      this.loadMembers();
    } catch (err) {
      wx.showToast({ title: api.errorMessage(err, '更新失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onInviteAccountInput(e) {
    this.setData({ inviteAccount: e.detail.value });
  },

  onInviteRoleChange(e) {
    const idx = Number(e.detail.value);
    this.setData({ inviteRole: ROLE_OPTIONS[idx] || 'submitter' });
  },

  async onInvite() {
    const account = this.data.inviteAccount.trim();
    if (!account) {
      wx.showToast({ title: '请输入 QQ 号', icon: 'none' });
      return;
    }
    this.setData({ inviteBusy: true });
    wx.showLoading({ title: '添加中' });
    try {
      await api.inviteMember(account, this.data.inviteRole);
      wx.showToast({ title: '用户已添加', icon: 'success' });
      this.setData({ inviteAccount: '' });
      this.loadMembers();
    } catch (err) {
      wx.showToast({ title: api.errorMessage(err, '添加失败'), icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ inviteBusy: false });
    }
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => wx.redirectTo({ url: '/pages/login/login' }),
    });
  },
});
