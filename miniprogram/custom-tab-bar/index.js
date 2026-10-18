/**
 * 自定义 tabBar —— 对齐 apps/web/src/features/shell/MobileTabBar.tsx
 *   容器：h-64px、白底、上边框 1px #e2e8f0、内边距 6px 12px 8px
 *   条目：h-52px、竖排、图标 20px + 文字 12px/500、间距 4px
 *   选中：文字 #1447e6（blue-700）；底部 3px 圆角蓝条 #155dfc，左右各内缩 12px
 *   按角色过滤：与 app-model.ts 的 navItems.minRole 一致（管理需 admin）
 */
const icons = require('../utils/icons.js');

const ROLE_RANK = { submitter: 1, broadcaster: 2, reviewer: 3, admin: 4 };

const NAV_ITEMS = [
  { pagePath: '/pages/post/post', label: '投稿', icon: 'home', minRole: 'submitter' },
  { pagePath: '/pages/posts/posts', label: '稿件', icon: 'posts', minRole: 'submitter' },
  { pagePath: '/pages/services/services', label: '服务', icon: 'services', minRole: 'submitter' },
  { pagePath: '/pages/admin/admin', label: '管理', icon: 'admin', minRole: 'admin' },
];

Component({
  data: {
    items: [],
    selected: 0,
    indicatorLeft: 0,
    indicatorWidth: 0,
  },

  attached() {
    this.refresh();
  },

  methods: {
    /** 按当前身份重算可见条目（对应网页端按 minRole 过滤）。 */
    refresh() {
      const app = getApp();
      const role = (app && app.globalData && app.globalData.currentMembership
        && app.globalData.currentMembership.role) || 'submitter';
      const rank = ROLE_RANK[role] || 0;
      const items = NAV_ITEMS.filter((item) => rank >= (ROLE_RANK[item.minRole] || 0)).map((item) => ({
        pagePath: item.pagePath,
        label: item.label,
        icon: icons[item.icon] ? icons[item.icon].gray : '',
        iconActive: icons[item.icon] ? icons[item.icon].blue : '',
      }));
      this.setData({ items }, () => this.computeIndicator());
    },

    computeIndicator() {
      const items = this.data.items;
      if (!items.length) {
        return;
      }
      let width = 375;
      try {
        // getSystemInfoSync 已废弃，优先用 getWindowInfo
        const info = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
        width = (info && info.windowWidth) || 375;
      } catch (e) {
        width = 375;
      }
      const inner = width - 24;
      const itemWidth = inner / items.length;
      this.setData({
        indicatorLeft: 12 + this.data.selected * itemWidth + 12,
        indicatorWidth: itemWidth - 24,
      });
    },

    setSelected(index) {
      this.setData({ selected: index }, () => this.computeIndicator());
    },

    onTap(event) {
      const index = event.currentTarget.dataset.index;
      const item = this.data.items[index];
      if (!item) {
        return;
      }
      if (index === this.data.selected) {
        return;
      }
      this.setData({ selected: index }, () => this.computeIndicator());
      wx.switchTab({ url: item.pagePath });
    },
  },
});
