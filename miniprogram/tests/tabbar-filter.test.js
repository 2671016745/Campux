/**
 * tabBar 角色过滤桩化测试：直接复刻 custom-tab-bar/index.js 的 NAV_ITEMS 与 refresh 过滤，
 * 断言每个角色看到的条目与 apps/web 的 navItems.minRole 完全一致。
 * 运行：node tabbar-filter.test.js
 */
const ROLE_RANK = { submitter: 1, broadcaster: 2, reviewer: 3, admin: 4 };

const NAV_ITEMS = [
  { pagePath: '/pages/post/post', label: '投稿', icon: 'home', minRole: 'submitter' },
  { pagePath: '/pages/posts/posts', label: '稿件', icon: 'posts', minRole: 'submitter' },
  { pagePath: '/pages/services/services', label: '服务', icon: 'services', minRole: 'submitter' },
  { pagePath: '/pages/stats/stats', label: '统计', icon: 'stats', minRole: 'reviewer' },
  { pagePath: '/pages/admin/admin', label: '管理', icon: 'admin', minRole: 'admin' },
];

// 与 custom-tab-bar/index.js 的 refresh() 保持一致
function visibleItems(role) {
  if (!role) return NAV_ITEMS.filter((i) => i.minRole === 'submitter');
  const rank = ROLE_RANK[role] || 0;
  return NAV_ITEMS.filter((i) => rank >= (ROLE_RANK[i.minRole] || 0));
}

// 期望值：照 apps/web/src/App.tsx 的 availableNavItems + canAccess
const EXPECT = {
  '': ['投稿', '稿件', '服务'],                                    // 未登录 → 普通用户视图
  submitter: ['投稿', '稿件', '服务'],
  broadcaster: ['投稿', '稿件', '服务'],
  reviewer: ['投稿', '稿件', '服务', '统计'],
  admin: ['投稿', '稿件', '服务', '统计', '管理'],
};

let pass = 0;
let fail = 0;
for (const [role, want] of Object.entries(EXPECT)) {
  const got = visibleItems(role || '').map((i) => i.label);
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  role=${role || '(未登录)'}  期望[${want}]  实际[${got}]`);
  ok ? pass++ : fail++;
}

// 索引断言：各页 setSelected 用的下标必须与过滤后的位置一致
const idx = (role, label) => visibleItems(role).findIndex((i) => i.label === label);
const idxCases = [
  ['', '投稿', 0], ['', '稿件', 1], ['', '服务', 2],
  ['reviewer', '统计', 3],
  ['admin', '统计', 3], ['admin', '管理', 4],
];
for (const [role, label, want] of idxCases) {
  const got = idx(role, label);
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  role=${role}  ${label} 期望索引${want} 实际${got}`);
  ok ? pass++ : fail++;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
