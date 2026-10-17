/**
 * dom2wxml —— 把「网页端真实渲染出来的 DOM」转换成小程序 WXML + WXSS。
 *
 * 目的：网页端一改版，小程序端不用再人工逐项量取重写，跑一遍脚本出草稿。
 * 用法：把它注入网页端页面（devtools 控制台 / CDP Runtime.evaluate），然后
 *
 *   const root = document.querySelector('<目标区域>');
 *   const out = window.__d2w(root, { name: 'plugins-card' });
 *   copy(out.wxml); copy(out.wxss);   // 或写盘
 *
 * 逐节点验收用同目录的 verify-gen.js（渲染生成结果，与原节点逐项 diff）。
 *
 * 设计取舍（每一条都是踩出来的）：
 * - 样式按「签名」去重成类名 c0/c1/…：14 行插件共用一个类，体积接近手写。
 * - 标签映射：svg→image(base64 data URI)、img→image、行内纯文字→text、其余→view。
 *   网页端的 button 也是样式化 div，统一当 view，避免小程序原生 button 自带样式。
 * - 滚动容器（overflow:auto/scroll）改成自然高度：小程序整页滚动，没有卡内滚动。
 * - grid → flex（WXSS 不支持 grid），单列 grid 直接 flex-direction: column。
 * - 单位保持 px：先让网页端按目标宽度渲染，px 值 1:1 可用（要 rpx 就整体 ×2）。
 * - 计算样式里的 oklch/oklab 一律换成 hex/rgba（WXSS 不认新色彩函数），
 *   box-shadow 里的颜色同样要换（Tailwind 的 ring-1 就是 oklab 写的）。
 * - 「布局派生」的 width/height 不写死：网格/弹性拉伸出来的尺寸是当次渲染算的，
 *   写进 WXSS 后内容一变就溢出。
 * - 空元素不要一律丢：开关的白色圆钮就是「无文字无子节点但有背景」的空节点。
 *   （判据：有没有画东西 —— 背景/边框/阴影）
 * - 不要按 aria-hidden="true" 跳过节点：lucide 等图标库会给图标加这个属性，
 *   跳了正好把图标全丢光（实测 17 个图标全被跳过、卡片里全是空节点）。
 */
(function (global) {
  const PROPS = [
    ['display', 'display'],
    ['flexDirection', 'flex-direction'],
    ['alignItems', 'align-items'],
    ['justifyContent', 'justify-content'],
    ['flexGrow', 'flex-grow'],
    ['flexShrink', 'flex-shrink'],
    ['flexBasis', 'flex-basis'],
    ['gap', 'gap'],
    ['paddingTop', 'padding-top'],
    ['paddingRight', 'padding-right'],
    ['paddingBottom', 'padding-bottom'],
    ['paddingLeft', 'padding-left'],
    ['marginTop', 'margin-top'],
    ['marginRight', 'margin-right'],
    ['marginBottom', 'margin-bottom'],
    ['marginLeft', 'margin-left'],
    ['width', 'width'],
    ['height', 'height'],
    ['minWidth', 'min-width'],
    ['minHeight', 'min-height'],
    ['maxWidth', 'max-width'],
    ['borderRadius', 'border-radius'],
    ['borderTopWidth', 'border-top-width'],
    ['borderRightWidth', 'border-right-width'],
    ['borderBottomWidth', 'border-bottom-width'],
    ['borderLeftWidth', 'border-left-width'],
    ['borderStyle', 'border-style'],
    ['boxShadow', 'box-shadow'],
    ['fontSize', 'font-size'],
    ['fontWeight', 'font-weight'],
    ['lineHeight', 'line-height'],
    ['letterSpacing', 'letter-spacing'],
    ['textAlign', 'text-align'],
    ['whiteSpace', 'white-space'],
    ['textOverflow', 'text-overflow'],
    ['textTransform', 'text-transform'],
    ['opacity', 'opacity'],
    ['overflow', 'overflow'],
    ['position', 'position'],
    ['top', 'top'], ['right', 'right'], ['bottom', 'bottom'], ['left', 'left'],
    ['transform', 'transform'],
    ['zIndex', 'z-index'],
    ['boxSizing', 'box-sizing'],
  ];
  const COLORS = { color: 'color', backgroundColor: 'background-color', borderTopColor: 'border-color' };
  const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'head', 'title']);

  // oklch/lab/rgb → hex（WXSS 不认 oklch）
  const toHex = (() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const ctx = cv.getContext('2d');
    return (css) => {
      if (!css || css === 'rgba(0, 0, 0, 0)' || css === 'transparent' || css === 'none') return null;
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      if (d[3] === 0) return null;
      const h = (v) => v.toString(16).padStart(2, '0');
      return d[3] === 255 ? `#${h(d[0])}${h(d[1])}${h(d[2])}` : `rgba(${d[0]},${d[1]},${d[2]},${(d[3] / 255).toFixed(2)})`;
    };
  })();

  const isDefault = (v, prop) => {
    if (prop === 'display') return v === 'block';
    if (prop === 'flex-direction') return v === 'row';
    if (prop === 'flex-grow' || prop === 'flex-shrink') return v === '0' || v === '1';
    if (prop === 'opacity') return v === '1';
    if (prop === 'overflow') return v === 'visible';
    if (prop === 'position') return v === 'static';
    if (prop === 'box-sizing') return v === 'content-box';
    if (prop === 'border-style') return v === 'none';
    if (prop === 'font-weight') return v === '400';
    if (prop === 'text-align') return v === 'start' || v === 'left';
    if (prop === 'white-space') return v === 'normal';
    if (prop === 'text-overflow') return v === 'clip';
    if (prop === 'letter-spacing') return v === 'normal';
    if (prop === 'text-transform') return v === 'none';
    if (prop === 'transform') return v === 'none';
    if (prop === 'z-index') return v === 'auto';
    if (prop === 'box-shadow') return v === 'none';
    return v === '0px' || v === 'auto' || v === 'normal' || v === 'none' || v === '';
  };

  const styleOf = (el) => {
    const s = getComputedStyle(el);
    const out = {};
    PROPS.forEach(([k, css]) => {
      let v = s[k];
      if (v == null) return;
      if (typeof v === 'string') v = v.trim();
      if (isDefault(v, css)) return;
      if (css === 'display') {
        if (v === 'inline-flex') v = 'flex';
        if (v === 'grid' || v === 'inline-grid') {
          out['display'] = 'flex';
          out['flex-direction'] = 'column';
          return;
        }
        if (v === 'list-item') v = 'block';
      }
      if (css === 'overflow' && (v === 'auto' || v === 'scroll')) { out['overflow'] = 'visible'; out['height'] = 'auto'; return; }
      if (css === 'height' && v === 'auto') return;
      out[css] = v;
    });
    Object.keys(COLORS).forEach((k) => {
      const hex = toHex(s[k]);
      if (hex) out[COLORS[k]] = hex;
    });
    const bgi = s.backgroundImage;
    if (bgi && bgi !== 'none' && bgi.indexOf('url(') !== 0) out['background-image'] = bgi;
    if (out['box-shadow']) {
      out['box-shadow'] = out['box-shadow'].replace(/(oklab|oklch|lab|lch|color)\([^)]*\)/g, (m) => toHex(m) || 'rgba(0,0,0,0)');
      const layers = [];
      let depth = 0, cur = '';
      for (const ch of out['box-shadow']) {
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (ch === ',' && depth === 0) { layers.push(cur); cur = ''; } else cur += ch;
      }
      if (cur.trim()) layers.push(cur);
      const kept = layers.map((l) => l.trim()).filter((l) => {
        if (!l) return false;
        if (/inset/.test(l)) return true;
        const col = l.match(/rgba?\([^)]*\)/);
        if (col) {
          const n = col[0].match(/[\d.]+/g) || [];
          if (n.length >= 4 && parseFloat(n[3]) === 0) return false;
        }
        return true;
      });
      if (kept.length) out['box-shadow'] = kept.join(', ');
      else delete out['box-shadow'];
    }
    const pcs = el.parentElement ? getComputedStyle(el.parentElement) : null;
    if (pcs && /(flex|grid)/.test(pcs.display) && el.children.length) {
      const stretch = pcs.alignItems === 'stretch' || pcs.alignItems === 'normal';
      if (stretch) delete out['height'];
      if (parseFloat(s.flexGrow) > 0 || (pcs.display === 'flex' && pcs.flexDirection === 'column' && stretch)) delete out['width'];
    }
    return out;
  };

  const sig = (style) => Object.keys(style).sort().map((k) => `${k}:${style[k]}`).join(';');
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const svgToDataUri = (svg) => {
    const clone = svg.cloneNode(true);
    clone.removeAttribute('class');
    clone.removeAttribute('style');
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(clone);
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
  };

  function convert(root, opts) {
    opts = opts || {};
    const classes = new Map();
    const classOrder = [];
    const stats = { nodes: 0, icons: 0, images: 0, texts: 0, skipped: 0, classes: 0 };

    const classNameFor = (style) => {
      const key = sig(style);
      if (classes.has(key)) return classes.get(key);
      const name = 'c' + classOrder.length;
      classes.set(key, name);
      classOrder.push({ name, style });
      return name;
    };

    const walk = (el, depth) => {
      if (!el || el.nodeType !== 1) return '';
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) { stats.skipped++; return ''; }
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') { stats.skipped++; return ''; }
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) { stats.skipped++; return ''; }
      stats.nodes++;

      const style = styleOf(el);
      const cls = classNameFor(style);
      const indent = '  '.repeat(depth);
      const attr = ` class="${cls}"`;

      if (tag === 'svg') {
        stats.icons++;
        return `${indent}<image${attr} src="${svgToDataUri(el)}" mode="aspectFit" />`;
      }
      if (tag === 'img') {
        stats.images++;
        return `${indent}<image${attr} src="${esc(el.getAttribute('src') || '')}" mode="aspectFit" />`;
      }

      const kids = [];
      let pending = '';
      const flush = () => {
        if (pending.trim()) kids.push(`${indent}  <text>${esc(pending.trim())}</text>`);
        pending = '';
      };
      Array.from(el.childNodes).forEach((child) => {
        if (child.nodeType === 3) { pending += child.textContent.replace(/\s+/g, ' '); return; }
        if (child.nodeType !== 1) return;
        const ccs = getComputedStyle(child);
        const inlineTextOnly = (ccs.display === 'inline' || ccs.display === 'inline-block')
          && child.children.length === 0 && child.textContent.trim();
        if (inlineTextOnly) { pending += child.textContent; return; }   // 行内文字并进同一个 <text>
        flush();
        const sub = walk(child, depth + 1);
        if (sub) kids.push(sub);
      });
      flush();

      if (!kids.length) {
        const painted = style['background-color'] || style['background-image'] || style['box-shadow']
          || (style['border-top-width'] && style['border-top-width'] !== '0px');
        if (!painted) { stats.nodes--; stats.skipped++; return ''; }
        return `${indent}<view${attr}></view>`;
      }
      return `${indent}<view${attr}>\n${kids.join('\n')}\n${indent}</view>`;
    };

    const wxml = walk(root, 0);
    stats.classes = classOrder.length;
    const wxss = classOrder.map(({ name, style }) => {
      const body = Object.keys(style).map((k) => `  ${k}: ${style[k]};`).join('\n');
      return `.${name} {\n${body}\n}`;
    }).join('\n\n');

    return { wxml, wxss, stats, classes: classOrder };
  }

  global.__d2w = convert;
})(window);
