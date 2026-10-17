# 界面转换工具：网页端 → 小程序 WXML/WXSS

网页端一改版，小程序端就要人工逐项量取、重写界面——这个工具把这一步自动化：
**让浏览器把真实计算样式交出来，脚本翻译成 WXML/WXSS 草稿，再用逐节点数值比对验收。**

放在仓库根而不是 `miniprogram/` 里，是因为小程序目录下的任何 `.js` 都会被打进小程序包。

## 用法

1. 起网页端：`bun --cwd apps/web dev`（:5180），用有权限的账号登录，进到目标页面。
2. **把浏览器视口设成目标手机宽度（375×812）** —— 网页端是响应式的，只有在目标宽度下量出来的 px
   才能 1:1 落到 WXSS（要 rpx 就整体 ×2）。
3. 把 `dom2wxml.js` 整个文件内容注入页面（devtools 控制台粘贴，或 CDP `Runtime.evaluate`）。
4. 选目标区域并转换：

   ```js
   const root = document.querySelector('<目标区域选择器>');
   const out = window.__d2w(root, { name: 'plugins-card' });
   console.log(out.stats);        // 节点数 / 图标数 / 产出的类数
   copy(out.wxml); copy(out.wxss);
   ```

5. **逐节点验收**：注入 `verify-gen.js`，然后

   ```js
   JSON.stringify(window.__verifyGen({
     originalEl: root, wxml: out.wxml, wxss: out.wxss,
     containerWidth: root.getBoundingClientRect().width,
   }))
   ```

   期望 `passed: true`；有差异会逐条列出（路径 / 标签 / 文字 / 具体哪一项差多少）。不要靠肉眼看截图。

## 实测效果（管理台「插件配置」的插件卡片）

- 143 个节点与原版**一一对应**；宽高差异 0、12 项样式差异 0、文字内容差异 0
- 17 个图标按原样 SVG 转 base64（不是另找一套图标）
- 14 行插件共用 1 个类，共产出 27 个类；WXML 47.8 KB / WXSS 7.1 KB
- 人工量取 0 次。示例产物见 `example/`

## 有意转换（与原版的已知差异，不是 bug）

| 原版 | 生成结果 | 原因 |
| --- | --- | --- |
| `display: grid` | `display: flex` + `column` | WXSS 不支持 grid |
| 卡内滚动（固定高 + `overflow:auto`） | 自然高度、整页滚动 | 小程序没有卡内滚动，滚动交给页面 |
| `oklch()` / `oklab()`（含 `box-shadow` 里的） | `hex` / `rgba()` | WXSS 不认新色彩函数；Tailwind 的 `ring-1` 就是 oklab 写的 |
| 弹性/网格拉伸出来的 `width`/`height` | 不写死 | 那是当次渲染算出来的值，内容一变就溢出 |
| `hidden md:block` 之类按宽度显隐的元素 | 以「当前视口」为准 | 手机宽度下隐藏的就不生成 |

## 已知限制

- **事件与数据不搬**：`bindtap`、数据源要人工接；脚本只搬结构与样式。草稿 = 起点，不是成品。
- 伪元素（`::before/::after`）、伪类（`:hover`）、动画不搬。
- 文本节点与行内元素会合并成一个 `<text>`，DOM 结构与原版不完全同形（渲染结果一致）。
- **目标区域要人工选**：脚本不替你判断「哪一块是这次要转的界面」。
- 文字排版依赖字体环境：把生成结果放到脱离网页端字体的环境里渲染（例如裸 HTML 页面），
  行高/换行可能与原版不同 —— 验收要在**同一文档、同一字体**下做（`verify-gen.js` 就是这么做的）。

## 每次改版的推荐流程

1. 网页端改动合入 → 起本地网页端
2. 对改动的页面跑 `dom2wxml` → 覆盖对应 WXML/WXSS
3. 跑 `verify-gen` 逐节点比对 → 修到 0 差异（或确认剩余差异属于上表「有意转换」）
4. 人工补事件绑定与数据源，进开发者工具看真机效果
