const { fetchAdminTenantMetadata, updateAdminTenantMetadata, fetchMetadata } = require('../../utils/api.js');

const ROLE_LABELS = {
  submitter: '用户',
  broadcaster: '广播员',
  reviewer: '审核员',
  admin: '管理员',
};

// 墙面功能开关（键名与服务端 tenant metadata / 插件配置一致）
const SWITCH_FIELDS = [
  { key: 'enableLingling', label: '吉祥萌宠', desc: '服务页展示吉祥萌宠与成长值，页头展示 Live2D 小狗' },
  { key: 'enableCampaigns', label: '投票竞选', desc: '投稿页发起投票竞选，审核通过后在服务页公开投票' },
  { key: 'enableBroadcast', label: '广播通知', desc: '投稿页发起有时效的广播通知，广播员可标记已广播' },
  { key: 'enableGraduation', label: '毕业去向', desc: '投稿页自填级/届与学历，审核通过后进入服务页统计' },
  { key: 'enableHeatBoard', label: '热度榜', desc: '服务页展示稿件与话题热度排行，投稿页支持添加话题' },
];

const THEME_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

Page({
  data: {
    icons: require('../../utils/icons.js'),
    tenantName: '',
    logoUrl: '',
    roleLabel: '',
    loggedOut: false,
    loading: true,
    saving: false,
    form: {
      tenantName: '',
      themeColor: '#2563eb',
    },
    switches: [],
    original: {},
  },

  onShow() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().refresh();
      this.getTabBar().setSelected(3);
    }
    const app = getApp();
    if (!app.globalData.token) {
      this.setData({ loggedOut: true, loading: false });
      app.promptLogin();
      return;
    }
    app.checkSession({ prompt: true }).then((ok) => {
      if (!ok) {
        this.setData({ loggedOut: true, loading: false });
        return;
      }
      if (this.data.loggedOut) {
        this.setData({ loggedOut: false });
      }
      const tenant = app.globalData.currentTenant || {};
      this.setData({
        logoUrl: tenant.logoUrl || '',
        roleLabel: ROLE_LABELS[app.role] || '',
      });
      this.loadMetadata();
    });
  },

  // ── 加载 ───────────────────────────────────────────────────

  async loadMetadata() {
    this.setData({ loading: true });
    try {
      let data = {};
      try {
        const res = await fetchAdminTenantMetadata();
        data = (res && res.data) || {};
      } catch (err) {
        // 管理端 GET 接口缺失时回退到公开 metadata 接口
        const res = await fetchMetadata();
        data = (res && res.data) || {};
      }

      const app = getApp();
      const tenant = (app && app.globalData && app.globalData.currentTenant) || {};

      const switches = SWITCH_FIELDS.map((field, index) => ({
        key: field.key,
        label: field.label,
        desc: field.desc,
        value: Boolean(data[field.key]),
        showDivider: index < SWITCH_FIELDS.length - 1,
      }));

      const form = {
        tenantName: data.tenantName || data.name || tenant.name || '',
        themeColor: data.themeColor || tenant.themeColor || '#2563eb',
      };

      const original = {
        tenantName: form.tenantName,
        themeColor: form.themeColor,
      };
      SWITCH_FIELDS.forEach((field) => {
        original[field.key] = Boolean(data[field.key]);
      });

      this.setData({
        form,
        switches,
        original,
        tenantName: form.tenantName,
        logoUrl: data.logoUrl || tenant.logoUrl || '',
        roleLabel: ROLE_LABELS[app.role] || '',
      });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  // ── 表单 ───────────────────────────────────────────────────

  onNameInput(e) {
    this.setData({ 'form.tenantName': e.detail.value });
  },

  onThemeInput(e) {
    this.setData({ 'form.themeColor': e.detail.value });
  },

  onSwitchChange(e) {
    const key = e.currentTarget.dataset.key;
    const value = Boolean(e.detail.value);
    const switches = this.data.switches.map((item) => (item.key === key ? Object.assign({}, item, { value }) : item));
    this.setData({ switches });
  },

  // ── 保存 ───────────────────────────────────────────────────

  async onSave() {
    const form = this.data.form;
    const tenantName = (form.tenantName || '').trim();
    if (!tenantName) {
      wx.showToast({ title: '请输入墙名', icon: 'none' });
      return;
    }
    const themeColor = (form.themeColor || '').trim();
    if (!THEME_COLOR_RE.test(themeColor)) {
      wx.showToast({ title: '主题色格式应为 #RRGGBB', icon: 'none' });
      return;
    }

    const patch = {};
    const original = this.data.original;
    if (tenantName !== original.tenantName) {
      patch.tenantName = tenantName;
    }
    if (themeColor !== original.themeColor) {
      patch.themeColor = themeColor;
    }
    this.data.switches.forEach((item) => {
      if (item.value !== original[item.key]) {
        patch[item.key] = item.value;
      }
    });

    if (Object.keys(patch).length === 0) {
      wx.showToast({ title: '没有需要保存的改动', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      await updateAdminTenantMetadata(patch);
      wx.showToast({ title: '墙面设置已保存', icon: 'success' });
      await this.loadMetadata();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  // ── 工具 ───────────────────────────────────────────────────

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => wx.redirectTo({ url: '/pages/login/login' }),
    });
  },
});
