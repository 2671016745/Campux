const api = require('../../utils/api.js');
const icons = require('../../utils/icons.js');
const pluginIcons = require('../../utils/plugin-icons.js');

/**
 * 插件配置（管理台）。
 *
 * 对齐网页端「插件配置」页左栏：只列 14 个预设插件（服务端还会返回 registry 插件
 * campux-plugin-review-notify，原版侧栏不展示它，这里按 pluginIcons 是否收录来过滤）。
 *
 * 开关行为与网页端一致：点一下即时生效（PATCH /api/admin/plugins/:name/status），
 * 不做「先改后保存」；成功/失败各给一次 toast。
 */
Page({
  data: {
    icons,
    headIcon: '',
    plugins: [],
    enabledCount: 0,
    selectedIndex: 0,
    loading: false,
    loggedOut: false,
  },

  onShow() {
    const app = getApp();
    if (!app.globalData.token) {
      this.setData({ loggedOut: true, plugins: [] });
      app.promptLogin();
      return;
    }
    if (this.data.loggedOut) {
      this.setData({ loggedOut: false });
    }
    this.load();
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => wx.redirectTo({ url: '/pages/login/login' }),
    });
  },

  load() {
    this.setData({ loading: true });
    return api.request('/api/admin/plugins').then((res) => {
      if (res.statusCode === 403) {
        this.setData({ loading: false, plugins: [] });
        wx.showToast({ title: '需要管理员权限', icon: 'none' });
        return;
      }
      if (res.statusCode !== 200 || !res.data) {
        this.setData({ loading: false });
        return;
      }
      const list = (res.data.plugins || [])
        // 只保留网页端侧栏展示的预设插件（插件图标表里有的）
        .filter((plugin) => pluginIcons[plugin.name])
        .map((plugin) => ({
          name: plugin.name,
          displayName: pluginIcons[plugin.name].name,
          tagline: pluginIcons[plugin.name].tagline,
          icon: pluginIcons[plugin.name].icon,
          description: plugin.description || '',
          version: plugin.version,
          enabled: plugin.status === 'enabled',
        }));
      this.setData({
        plugins: list,
        enabledCount: list.filter((item) => item.enabled).length,
        headIcon: list.length ? list[0].icon : '',
        loading: false,
      });
    }).catch(() => {
      this.setData({ loading: false });
      wx.showToast({ title: '加载失败，请检查网络', icon: 'none' });
    });
  },

  selectPlugin(event) {
    this.setData({ selectedIndex: Number(event.currentTarget.dataset.index) || 0 });
  },

  /** 开关：乐观更新 + 失败回滚（与网页端一样即时生效并 toast） */
  togglePlugin(event) {
    const { name } = event.currentTarget.dataset;
    const wasEnabled = event.currentTarget.dataset.enabled === true || event.currentTarget.dataset.enabled === 'true';
    if (!name || this.data.busy) {
      return;
    }
    const nextEnabled = !wasEnabled;
    this.setData({ busy: name });
    this.applyEnabled(name, nextEnabled);

    api.request('/api/admin/plugins/' + name + '/status', {
      method: 'PATCH',
      data: { status: nextEnabled ? 'enabled' : 'disabled' },
    }).then((res) => {
      this.setData({ busy: '' });
      if (res.statusCode >= 200 && res.statusCode < 300) {
        wx.showToast({ title: nextEnabled ? '已启用插件' : '已禁用插件' });
        return;
      }
      this.applyEnabled(name, wasEnabled);
      wx.showToast({ title: api.errorMessage(res, '操作失败'), icon: 'none' });
    }).catch(() => {
      this.setData({ busy: '' });
      this.applyEnabled(name, wasEnabled);
      wx.showToast({ title: '网络错误，请稍后重试', icon: 'none' });
    });
  },

  /** 就地改某一项的启用状态（同时刷新已启用计数） */
  applyEnabled(name, enabled) {
    const plugins = this.data.plugins.map((item) => (
      item.name === name ? Object.assign({}, item, { enabled }) : item
    ));
    this.setData({
      plugins,
      enabledCount: plugins.filter((item) => item.enabled).length,
    });
  },
});
