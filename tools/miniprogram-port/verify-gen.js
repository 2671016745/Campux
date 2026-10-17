/**
 * verify-gen —— 把「dom2wxml 生成的 WXML」渲染出来，与网页端原节点逐项比对。
 *
 * 关键：原版侧的遍历规则必须与转换器**完全一致**，否则两边结构错位、比对结果全是假的
 * （第一版就踩了：原版侧钻进了 <svg> 内部的 <path>，229 个节点 vs 生成侧 118 个，
 * 之后所有比对都是拿 A 的第 i 个比 B 的第 i 个，全对不上）。
 *
 * 一致的三条：① svg/img 当叶子；② 行内且只含文字的元素被合并（跳过）；③ 隐藏/零尺寸/script-style 跳过。
 * 另外两条也会造成假差异：
 * - 颜色：浏览器对 oklch 写的 color 会原样回显 oklch，两边都要归一成 hex 再比。
 * - 文字：textContent 会把 display:none 的隐藏文字也算进来 → 用 innerText。
 *
 * 用法：
 *   window.__verifyGen({ originalEl, wxml, wxss, containerWidth })
 *   → { originalNodes, generatedNodes, mismatchCount, mismatches, iconCount, passed }
 */
(function (global) {
  const PROPS = ['backgroundColor', 'color', 'fontSize', 'fontWeight', 'lineHeight', 'borderRadius',
    'paddingTop', 'paddingLeft', 'gap', 'borderTopWidth', 'flexDirection', 'alignItems'];
  const SKIP_TAGS = new Set(['script', 'style', 'link', 'meta', 'noscript', 'head', 'title']);

  const toHex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const ctx = cv.getContext('2d');
    return (css) => {
      if (!css || !/^(rgb|oklch|oklab|lab|lch|color|hsl|#)/i.test(css)) return css || '';
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      const h = (v) => v.toString(16).padStart(2, '0');
      return d[3] === 255 ? `#${h(d[0])}${h(d[1])}${h(d[2])}` : `rgba(${d[0]},${d[1]},${d[2]},${(d[3] / 255).toFixed(2)})`;
    };
  })();

  const htmlFromWxml = (wxml) => wxml
    .replace(/<view([^>]*)>/g, '<div$1>').replace(/<\/view>/g, '</div>')
    // <text> 打上 data-wtext：它在 DOM 里是真实元素，但原版侧对应的只是「文字」不是节点，
    // 不跳过的话生成侧每个文字都多算一个节点，两边从第一个文字起就错位。
    .replace(/<text([^>]*)>/g, '<span data-wtext$1>').replace(/<\/text>/g, '</span>')
    .replace(/<image([^>]*)\/>/g, '<img$1>')
    .replace(/ mode="aspectFit"/g, ' style="object-fit:contain"');

  const prefix = (s) => s.replace(/class="(c\d+)"/g, 'class="g$1"').replace(/\.(c\d+)\b/g, '.g$1');

  const nodes = (root) => {
    const out = [];
    const walk = (el, path) => {
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag)) return;
      if (el.hasAttribute && el.hasAttribute('data-wtext')) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 && r.height < 1) return;
      out.push({ path, el, cs, rect: r, tag });
      if (tag === 'svg' || tag === 'img') return;
      const inlineTextOnly = (cs.display === 'inline' || cs.display === 'inline-block')
        && el.children.length === 0 && el.textContent.trim();
      if (inlineTextOnly) return;
      let i = 0;
      Array.from(el.children).forEach((c) => { walk(c, path + '.' + i); i++; });
    };
    walk(root, '0');
    return out;
  };

  /** 是否处在可滚动区域内：原版卡内滚动 → 小程序整页滚动，高度差属预期内，不参与比对 */
  const inScrollArea = (el) => {
    let e = el;
    while (e && e !== document.body) {
      const o = getComputedStyle(e).overflowY;
      if (o === 'auto' || o === 'scroll') return true;
      e = e.parentElement;
    }
    return false;
  };

  const val = (n, p) => {
    const v = n.cs[p];
    if (p === 'boxShadow') return String(v || '').replace(/(oklab|oklch|lab|lch|color)\([^)]*\)/g, (m) => toHex(m) || 'rgba(0,0,0,0)');
    return p.toLowerCase().indexOf('color') >= 0 ? toHex(v) : v;
  };

  function run({ originalEl, wxml, wxss, containerWidth }) {
    const old = document.getElementById('__gen_verify');
    if (old) old.remove();
    const host = document.createElement('div');
    host.id = '__gen_verify';
    host.style.cssText = `position:fixed;left:-3000px;top:0;width:${containerWidth}px;background:#fff;`;
    const style = document.createElement('style');
    style.textContent = prefix(wxss);
    host.appendChild(style);
    const mount = document.createElement('div');
    mount.innerHTML = htmlFromWxml(prefix(wxml));
    host.appendChild(mount);
    document.body.appendChild(host);

    const A = nodes(originalEl);
    const B = nodes(mount.firstElementChild);
    const mismatches = [];
    let compared = 0, textMismatch = 0;
    for (let i = 0; i < Math.min(A.length, B.length); i++) {
      compared++;
      const a = A[i], b = B[i];
      const issues = [];
      if (a.tag === 'svg' || a.tag === 'img') {
        if (Math.abs(a.rect.width - b.rect.width) > 1.01) issues.push(`图标宽 ${a.rect.width}→${b.rect.width.toFixed(1)}`);
        if (Math.abs(a.rect.height - b.rect.height) > 1.01) issues.push(`图标高 ${a.rect.height}→${b.rect.height.toFixed(1)}`);
      } else {
        if (Math.abs(a.rect.width - b.rect.width) > 1.01) issues.push(`宽 ${a.rect.width.toFixed(1)}→${b.rect.width.toFixed(1)}`);
        if (Math.abs(a.rect.height - b.rect.height) > 1.01 && !inScrollArea(a.el)) {
          issues.push(`高 ${a.rect.height.toFixed(1)}→${b.rect.height.toFixed(1)}`);
        }
        PROPS.forEach((p) => {
          if (a.cs.display === 'grid' && (p === 'flexDirection' || p === 'alignItems')) return;  // grid→flex 是有意转换
          const av = String(val(a, p) || '').replace(/\s+/g, ' ').trim();
          const bv = String(val(b, p) || '').replace(/\s+/g, ' ').trim();
          if (av !== bv) issues.push(`${p} ${av}→${bv}`);
        });
        const at = (a.el.innerText || '').replace(/\s+/g, '');
        const bt = (b.el.innerText || '').replace(/\s+/g, '');
        if (at !== bt) { textMismatch++; issues.push(`文字「${at.slice(0, 16)}」→「${bt.slice(0, 16)}」`); }
      }
      if (issues.length) mismatches.push({ path: a.path, tag: a.tag, text: (a.el.textContent || '').trim().slice(0, 20), issues });
    }
    const imgs = Array.from(mount.querySelectorAll('img'));
    const report = {
      originalNodes: A.length,
      generatedNodes: B.length,
      compared,
      mismatchCount: mismatches.length,
      textMismatch,
      mismatches: mismatches.slice(0, 20),
      iconCount: imgs.length,
      iconsNotLoaded: imgs.filter((im) => !im.complete).length,
      rootRect: B.length ? { w: +B[0].rect.width.toFixed(1), h: +B[0].rect.height.toFixed(1) } : null,
    };
    report.passed = report.mismatchCount === 0 && A.length === B.length;
    return report;
  }

  global.__verifyGen = run;
})(window);
