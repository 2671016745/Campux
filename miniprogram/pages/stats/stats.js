/**
 * 「统计」页 —— 仅审核员及以上可见（服务端 /api/stats/tenant 同样按 reviewer 门控）。
 * 数据形状与 apps/web 的 TenantStats 对齐（apps/web/src/types/app.ts），
 * 区块划分照 apps/web/src/features/stats/StatsPage.tsx，视觉语言照现有页面
 * （posts/services/admin）：白卡片 + 12rpx 圆角 + muted 文案 + #1447e6 主色。
 *
 * 图表：小程序原生不支持内联 SVG，走势/分布用 view 柱子（scroll-view 横滚）表达，
 * 数据与网页端一致（每日新增/已通过、累计/新增用户、24 小时分布、每日访客/好友量）。
 */
const api = require('../../utils/api.js');
const icons = require('../../utils/icons.js');

const ROLE_LABELS = {
  submitter: '用户',
  broadcaster: '广播员',
  reviewer: '审核员',
  admin: '管理员',
};

// 与 custom-tab-bar/index.js 保持一致（审核相关入口按这个判权限）
const ROLE_RANK = { submitter: 1, broadcaster: 2, reviewer: 3, admin: 4 };

// 与网页端 app-model.ts 的 statusLabels 一致
const STATUS_LABELS = {
  pending_approval: '待审核',
  approved: '已通过',
  rejected: '已拒绝',
  cancelled: '已取消',
  publishing: '发布中',
  partially_failed: '部分失败',
  failed: '发布失败',
  waiting_cookies: '等待登录态',
  published: '已发布',
  pending_recall: '待撤回',
  recalled: '已撤回',
};

// 与 StatsPage.tsx 的 publishStatusLabels 一致
const PUBLISH_STATUS_LABELS = {
  queued: '排队中',
  running: '发布中',
  waiting_cookies: '等待登录态',
  succeeded: '成功',
  failed: '失败',
  skipped: '跳过',
};

// 与 StatsPage.tsx 的 auditActionLabels 一致
const AUDIT_ACTION_LABELS = {
  'bot.qzone.cookies.refresh': '刷新登录态',
  'bot.qzone.cookies.auto_refresh': '自动刷新登录态',
  'bot.qzone.cookies.auto_refresh_failed': '自动刷新失败',
  'bot.qzone.cookies.qr_login': '扫码登录',
  'bot_account.create': '创建机器人',
  'bot_account.update': '更新机器人',
  'publish_target.create': '创建发布目标',
  'publish_target.update': '更新发布目标',
  'publish_attempt.retry': '重试发布',
  'member.update_role': '修改成员身份',
  'ban.create': '封禁用户',
};

const SESSION_STATUS_LABELS = { available: '可用', invalid: '失效', expired: '过期' };

// 与 StatsPage.tsx 的 timeRanges 一致；服务端 parseRangeDays 也只认这四个值
const TIME_RANGES = [7, 14, 30, 90];

Page({
  data: {
    icons,
    tenantName: '',
    roleLabel: '',
    loggedOut: false,
    canView: false,
    loading: false,
    days: 14,
    rangeLabel: '近 14 天',
    generatedAtText: '',
    // 4 个 MetricCard
    metrics: [],
    // 稿件概览：状态网格 + 小事实
    statusGrid: [],
    smallFacts: [],
    // 走势（scroll-view 横滚柱子）
    dailyPosts: [],
    dailyUsers: [],
    qzoneCharts: [],
    friendCharts: [],
    // 时段分布
    hourly: [],
    // 用户与审核
    memberTotal: 0,
    memberRoles: '',
    reviewLabel: '近 14 天审核',
    reviewCount: 0,
    reviewDetail: '',
    topCount: 0,
    topDetail: '',
    topAuthors: [],
    // 折叠区块
    bots: [],
    publishByStatus: [],
    publishTargets: [],
    recentFailures: [],
    auditActions: [],
    openBots: false,
    openPublish: false,
    openFails: false,
    openAudit: false,
  },

  onShow() {
    const app = getApp();
    // 未登录不硬跳登录页：弹「去登录 / 随便看看」，页面显示未登录占位（照 posts/services 模式）
    if (!app.globalData.token) {
      this.setData({ loggedOut: true });
      app.promptLogin();
      return;
    }
    if (this.data.loggedOut) {
      this.setData({ loggedOut: false });
    }
    // 冷启动时 /api/me 可能还在飞：等校验完再渲染，否则身份区先空一帧（照 posts.js）
    app.checkSession({ prompt: true }).then((ok) => {
      if (!ok) {
        this.setData({ loggedOut: true });
        return;
      }
      this.renderIdentity();
      this.load();
    });
  },

  /** 页头身份：任务指定从 currentMembership.role 判角色 */
  renderIdentity() {
    const app = getApp();
    const membership = app.globalData.currentMembership || {};
    const rank = ROLE_RANK[membership.role] || 0;
    const tenant = app.globalData.currentTenant || {};
    this.setData({
      tenantName: tenant.name || '校园墙',
      logoUrl: tenant.logoUrl || '',
      roleLabel: ROLE_LABELS[membership.role] || '',
      // 只有 reviewer / admin 能看统计（服务端同样按 reviewer 门控）
      canView: rank >= ROLE_RANK.reviewer,
    });
  },

  goLogin() {
    wx.navigateTo({
      url: '/pages/login/login',
      fail: () => wx.redirectTo({ url: '/pages/login/login' }),
    });
  },

  refresh() {
    this.load();
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },

  /** 切换统计天数（7/14/30/90，与网页端一致） */
  setRange(event) {
    const days = Number(event.currentTarget.dataset.days);
    if (TIME_RANGES.indexOf(days) < 0 || days === this.data.days) {
      return;
    }
    this.setData({ days, rangeLabel: '近 ' + days + ' 天' });
    this.load();
  },

  /** 折叠区块：机器人与发布目标 / 发布质量 / 最近发布失败 / 管理操作 */
  toggleSection(event) {
    const key = event.currentTarget.dataset.key || '';
    if (!key) {
      return;
    }
    const field = 'open' + key.charAt(0).toUpperCase() + key.slice(1);
    this.setData({ [field]: !this.data[field] });
  },

  load() {
    this.setData({ loading: true });
    // 请求序号：快速切天数时先发后到的慢响应不许覆盖当前视图
    this._loadSeq = (this._loadSeq || 0) + 1;
    const seq = this._loadSeq;
    const days = this.data.days;
    wx.showLoading({ title: '正在加载…' });
    // fetchStatsTenant() 固定打无参接口；带天数范围时用 api.request 拼 days
    // （与网页端 StatsPage 的 /api/stats/tenant?days= 一致）
    const req = days === 14
      ? api.fetchStatsTenant()
      : api.request('/api/stats/tenant?days=' + days);
    return req.then((res) => {
      if (seq !== this._loadSeq) {
        wx.hideLoading();
        return null;   // 已经有更新的请求了，丢弃这次结果
      }
      const stats = res.data || {};
      this.applyStats(stats);
      this.setData({ loading: false });
      wx.hideLoading();
      return null;
    }).catch((err) => {
      if (seq !== this._loadSeq) {
        wx.hideLoading();
        return null;
      }
      wx.hideLoading();
      const status = err && err.res && err.res.statusCode;
      // 401 现在也走 reject（api 层已统一清会话 + 引导登录），这里只把页面切到未登录态
      if (status === 401) {
        this.setData({ loggedOut: true });
        return null;
      }
      // 403：服务端只允许 reviewer+ 访问统计接口（requireReadyTenant）
      if (status === 403) {
        this.setData({ canView: false, loading: false });
        return null;
      }
      wx.showToast({ title: api.errorMessage(err, '加载失败，请检查网络'), icon: 'none' });
      return null;
    });
  },

  /** 把服务端 TenantStats 映射成视图数据（字段缺失按 0/暂无 兜底，不报错） */
  applyStats(stats) {
    const overview = stats.overview || {};
    const posts = stats.posts || {};
    const review = stats.review || {};
    const publishing = stats.publishing || {};
    const members = stats.members || {};
    const audit = stats.audit || {};
    const days = (stats.range && stats.range.days) || this.data.days;
    const rangeLabel = '近 ' + days + ' 天';
    const byStatus = posts.byStatus || {};
    const pubByStatus = publishing.byStatus || {};

    // ── 4 个 MetricCard ──────────────────────────────────────────────
    const metrics = [
      { label: '总稿件', value: num(overview.totalPosts), sub: '近 7 天 ' + num(overview.recent7Posts) + ' 条' },
      { label: '投稿用户', value: num(overview.uniqueAuthors), sub: '近 30 天活跃 ' + num(overview.activeAuthors30d) + ' 人' },
      {
        label: '平均审核',
        value: overview.avgReviewMinutes === null || overview.avgReviewMinutes === undefined
          ? '暂无' : overview.avgReviewMinutes + ' 分钟',
        sub: '近 30 天通过/拒绝',
      },
      {
        label: '发布成功率',
        value: formatPercent(publishing.successRate),
        sub: num(pubByStatus.succeeded) + ' 成功 / ' + num(pubByStatus.failed) + ' 失败',
      },
    ];

    // ── 稿件概览：状态网格 ────────────────────────────────────────────
    const statusEntries = Object.keys(byStatus || {})
      .filter((key) => byStatus[key] > 0)
      .map((key) => ({ label: STATUS_LABELS[key] || key, value: num(byStatus[key]) }));

    // ── 小事实卡（与 StatsPage 的 SmallFact 对应） ──────────────────
    const bySource = posts.bySource || {};
    const smallFacts = [
      {
        label: '匿名比例',
        value: formatPercent(posts.anonymousRate !== undefined ? posts.anonymousRate : overview.anonymousRate),
        detail: num(posts.anonymousPosts !== undefined ? posts.anonymousPosts : overview.anonymousPosts) + ' 条匿名稿件',
      },
      {
        label: '配图比例',
        value: formatPercent(posts.imageRate !== undefined ? posts.imageRate : overview.imageRate),
        detail: num(posts.imagesTotal !== undefined ? posts.imagesTotal : overview.imagesTotal)
          + ' 张图，均值 ' + formatNullable(posts.avgImagesPerPost !== undefined ? posts.avgImagesPerPost : overview.avgImagesPerPost),
      },
      {
        label: '投稿来源',
        value: '对话 ' + num(bySource.private) + ' / 网页 ' + num(bySource.web),
        detail: '共 ' + num(posts.totalPosts) + ' 条稿件',
      },
      {
        label: '封禁状态',
        value: num(members.activeBans) + ' 生效中',
        detail: '历史封禁 ' + num(members.totalBans) + ' 条',
      },
    ];

    // ── 走势：每日稿件（新增 / 已通过）────────────────────────────────
    const daily = posts.daily || [];
    const maxDaily = Math.max(1, ...daily.map((day) => num(day.total)));
    const dailyPosts = daily.map((day) => ({
      label: formatDay(day.date),
      passed: num(day.approved) + num(day.published),
      barNew: Math.max(2, Math.round(num(day.total) / maxDaily * 120)),
      barPassed: Math.max(2, Math.round((num(day.approved) + num(day.published)) / maxDaily * 120)),
    }));

    // ── 走势：每日用户（累计 / 新增）─────────────────────────────────
    const userDaily = posts.userDaily || [];
    const maxUser = Math.max(1, ...userDaily.map((day) => num(day.totalMembers)));
    const dailyUsers = userDaily.map((day) => ({
      label: formatDay(day.date),
      barTotal: Math.max(2, Math.round(num(day.totalMembers) / maxUser * 120)),
      barNew: Math.max(2, Math.round(num(day.newMembers) / maxUser * 120)),
    }));

    // ── 走势：QZone 访客（有 targets 按 bot 拆分，否则聚合）──────────
    const qzoneVisitors = stats.qzoneVisitors || {};
    const qzoneTargets = qzoneVisitors.targets || [];
    const qzoneCharts = qzoneTargets.length > 0
      ? qzoneTargets.map((target) => ({
        title: rangeLabel + target.displayName,
        desc: '每日访客与累计总访客（' + target.bot.displayName + ' / QQ ' + target.bot.qqUin + '）',
        daily: toBars((target.daily || []), (day) => [
          { v: num(day.todayCount) },
          { v: num(day.totalCount) },
        ], (day) => formatDay(day.date)),
      }))
      : [{
        title: rangeLabel + 'QZone 访客',
        desc: rangeLabel + '每日访客与累计总访客（来自 cookies 检测接口）',
        daily: toBars(qzoneVisitors.daily || [], (day) => [
          { v: num(day.todayCount) },
          { v: num(day.totalCount) },
        ], (day) => formatDay(day.date)),
      }];

    // ── 走势：机器人好友量 ──────────────────────────────────────────
    const botFriends = stats.botFriends || {};
    const friendBots = botFriends.bots || [];
    const friendCharts = friendBots.length > 0
      ? friendBots.map((bot) => ({
        title: rangeLabel + bot.bot.displayName + '好友量',
        desc: '每日好友总量（' + bot.bot.displayName + ' / QQ ' + bot.bot.qqUin + '），每天自动采集',
        daily: toBars(bot.daily || [], (day) => [{ v: num(day.friendCount) }], (day) => formatDay(day.date)),
      }))
      : [{
        title: rangeLabel + '好友总量',
        desc: rangeLabel + '每日好友总量，每天自动采集',
        daily: toBars(botFriends.daily || [], (day) => [{ v: num(day.friendCount) }], (day) => formatDay(day.date)),
      }];

    // ── 时段分布（24 小时）──────────────────────────────────────────
    const hourly = posts.hourly || [];
    const maxHourly = Math.max(1, ...hourly.map((hour) => num(hour.total)));
    const hourlyView = hourly.map((hour) => ({
      hour: num(hour.hour),
      total: num(hour.total),
      pct: Math.max(4, Math.round(num(hour.total) / maxHourly * 100)),
    }));

    // ── 用户与审核 ──────────────────────────────────────────────────
    const byRole = members.byRole || {};
    const topAuthors = posts.topAuthors30d || [];
    const topMax = Math.max(1, ...topAuthors.map((author) => num(author.count)));

    // ── 折叠：机器人与发布目标 ──────────────────────────────────────
    const bots = (stats.bots || []).map((bot) => {
      const session = bot.qzoneSession;
      const sessionText = session
        ? (SESSION_STATUS_LABELS[session.status] || '未检测') + '，'
          + (session.checkedAt ? formatDateTime(session.checkedAt) : '未检测')
        : '未登录';
      return {
        title: bot.displayName,
        qq: 'QQ ' + bot.qqUin,
        enabled: bot.enabled,
        targetCount: num(bot.publishTargetCount),
        reviewGroup: bot.reviewGroupId || '未配置',
        lastSeen: bot.lastSeenAt ? formatDateTime(bot.lastSeenAt) : '未连接',
        session: sessionText,
      };
    });

    // ── 折叠：发布质量 ──────────────────────────────────────────────
    const publishByStatus = Object.keys(pubByStatus || {})
      .filter((key) => pubByStatus[key] > 0)
      .map((key) => ({ label: PUBLISH_STATUS_LABELS[key] || key, value: num(pubByStatus[key]) }));
    const publishTargets = (publishing.targets || []).map((target) => ({
      title: target.displayName,
      bot: target.bot.displayName + ' / QQ ' + target.bot.qqUin,
      enabled: target.enabled,
      desc: '成功率 ' + formatPercent(target.successRate) + ' · 风控间隔 ' + num(target.delaySeconds)
        + 's · 成功 ' + num(target.counts && target.counts.succeeded)
        + ' / 失败 ' + num(target.counts && target.counts.failed),
    }));

    // ── 折叠：最近发布失败 ──────────────────────────────────────────
    const recentFailures = (publishing.recentFailures || []).map((failure) => ({
      displayId: num(failure.postDisplayId),
      time: formatDateTime(failure.updatedAt),
      text: failure.postText || '',
      error: failure.lastError || '未知错误',
      meta: failure.targetName + ' · ' + failure.botName + ' / QQ ' + failure.botQqUin,
    }));

    // ── 折叠：管理操作 ──────────────────────────────────────────────
    const actions = audit.actions30d || [];
    const auditMax = Math.max(1, ...actions.map((action) => num(action.count)));
    const auditActions = actions.map((action) => ({
      label: AUDIT_ACTION_LABELS[action.action] || action.action,
      count: num(action.count),
      pct: Math.max(3, Math.round(num(action.count) / auditMax * 100)),
    }));

    this.setData({
      rangeLabel,
      generatedAtText: stats.generatedAt ? formatDateTime(stats.generatedAt) : '',
      metrics,
      statusGrid: statusEntries,
      smallFacts,
      dailyPosts,
      dailyUsers,
      qzoneCharts,
      friendCharts,
      hourly: hourlyView,
      memberTotal: num(members.total),
      memberRoles: '用户 ' + num(byRole.submitter) + ' / 审核员 ' + num(byRole.reviewer) + ' / 管理员 ' + num(byRole.admin),
      reviewLabel: rangeLabel + '审核',
      reviewCount: num(review.reviewed30d),
      reviewDetail: '通过 ' + num(review.approved30d) + ' / 拒绝 ' + num(review.rejected30d),
      topCount: topAuthors.length,
      topDetail: topAuthors.length ? '按' + rangeLabel + '投稿量排序' : '暂无活跃投稿',
      topAuthors: topAuthors.map((author) => {
        const user = author.user;
        const name = (user && user.displayName) || (user ? 'QQ ' + user.qqUin : shortId(author.authorId));
        const meta = user ? 'QQ ' + user.qqUin : '用户 ID ' + shortId(author.authorId);
        return {
          name,
          meta,
          count: num(author.count),
          pct: Math.max(4, Math.round(num(author.count) / topMax * 100)),
        };
      }),
      bots,
      publishByStatus,
      publishTargets,
      recentFailures,
      auditActions,
    });
  },
});

function num(value) {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

/**
 * 把每日序列转成柱子视图：{ label, bars: [{v, h}] }
 * h 为占最大值的百分比高度（最小 2rpx，保证 0 值也能看见一条细线）
 */
function toBars(list, pick, labelOf) {
  const values = (list || []).flatMap((day) => pick(day).map((item) => num(item.v)));
  const max = Math.max(1, ...values);
  return (list || []).map((day) => ({
    label: labelOf(day),
    bars: pick(day).map((item) => ({
      v: num(item.v),
      h: Math.max(2, Math.round(num(item.v) / max * 120)),
    })),
  }));
}

function formatPercent(value) {
  if (value === null || value === undefined) {
    return '暂无';
  }
  return value + '%';
}

function formatNullable(value) {
  if (value === null || value === undefined) {
    return '暂无';
  }
  return String(value);
}

function formatDateTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    return '';
  }
  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate()
    + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function formatDay(value) {
  if (!value) {
    return '';
  }
  return String(value).replace(/-/g, '/');
}

function shortId(id) {
  const text = String(id || '');
  return text.length > 10 ? text.slice(0, 6) + '...' + text.slice(-4) : text;
}
