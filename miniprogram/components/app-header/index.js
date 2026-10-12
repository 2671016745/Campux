/**
 * 顶部 Header 组件 —— 对齐 apps/web/src/features/shell/Header.tsx
 * 结构：logo 方框(36×36, 圆角 14px, 1px #e2e8f0 边框) + Campux 字标(18px/700)
 *       + 当前校园墙名(14px #62748e)；右侧显示当前身份。
 */
Component({
  properties: {
    tenantName: { type: String, value: '' },
    logoUrl: { type: String, value: '' },
    roleLabel: { type: String, value: '' },
  },

  data: {
    initial: '',
  },

  observers: {
    tenantName(value) {
      this.setData({ initial: (value || '墙').slice(0, 1) });
    },
  },
});
