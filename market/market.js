/* 有品的页面逻辑。
 *
 * 2026-10-01 从 index.html 拆出来。它用 defer 加载（原来内联在 body 末尾），
 * 执行时机一样：等 DOM 解析完再跑。
 */

(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_BYTES = 400 * 1024;
  let image = null;      // 新选的图（data URL，已压过）。编辑时为 null 表示「沿用库里那张」
  let posting = false;
  let editing = null;    // 正在编辑哪一件：{ id }；null = 新发一件
  let lastItems = [];    // 最近一次载入的列表（编辑时按 id 取回内容）

  /** 把照片压到 400KB 以内：最长边 1200px，质量从 0.72 往下退 */
  async function compress(file) {
    if (!file.type.startsWith('image/')) throw new Error('这不是图片');
    const bmp = await createImageBitmap(file);           // 会带上 EXIF 方向
    const max = 1200;
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    let q = 0.72, out = cv.toDataURL('image/jpeg', q);
    while (out.length * 0.75 > MAX_BYTES && q > 0.36) { q -= 0.08; out = cv.toDataURL('image/jpeg', q); }
    if (out.length * 0.75 > MAX_BYTES) throw new Error('这张图压不下来，换一张试试');
    return out;
  }

  async function takeFile(file) {
    const msg = $('msg');
    if (!file) return;
    msg.className = 'msg';
    msg.textContent = '正在压缩…';
    try {
      image = await compress(file);
      $('previewImg').src = image;
      $('previewImg').hidden = false;
      $('pick').hidden = true;
      $('swap').hidden = false;
      $('photoBox').classList.add('photo--has');
      msg.textContent = `图片压好了（${Math.round((image.length * 0.75) / 1024)}KB）`;
    } catch (err) {
      image = null;
      msg.className = 'msg msg--err';
      msg.textContent = err.message;
    }
  }

  function clearPhoto() {
    image = null;
    $('photo').value = '';
    $('previewImg').hidden = true;
    $('previewImg').removeAttribute('src');
    $('pick').hidden = false;
    $('swap').hidden = true;
    $('photoBox').classList.remove('photo--has');
  }

  // ---- 我的删除凭据（只存在这个浏览器里）----
  const tokens = {
    all: () => { try { return JSON.parse(localStorage.getItem('market.tokens') || '{}'); } catch { return {}; } },
    set: (id, token) => { const t = tokens.all(); t[id] = token; localStorage.setItem('market.tokens', JSON.stringify(t)); },
    get: (id) => tokens.all()[id] || null,
  };

  const ago = (iso) => {
    const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return '刚刚';
    if (m < 60) return m + ' 分钟前';
    const h = Math.floor(m / 60);
    if (h < 24) return h + ' 小时前';
    return Math.floor(h / 24) + ' 天前';
  };
  /* ------------------------------------------------------------------
   * 图标：全部取自 **lucide**（项目本来就依赖 lucide-react，报告卡片在用）。
   * 市集页是纯 JS（不是 React），所以这里把它同一份 SVG 路径原样内联，
   * 不再引一个 vanilla 包 —— 图标本来就只是几段 path。
   *
   * 统一成一套：24×24 视框、currentColor 描边、stroke-width 2、圆头圆角。
   * 之前这里是 emoji（💬）和文字符号（♥ ★ × ＋）混着 —— 字形来自不同字体、
   * 粗细与基线都不一致，所以「点进去图标风格大不统一」（用户 2026-10-01）。
   * ------------------------------------------------------------------ */
  const LUCIDE = {
    heart: '<path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>',
    bookmark: '<path d="M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z"/>',
    'message-circle': '<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    // 详情动作栏用的三个：编辑 / 下架 / 举报（同样取自 lucide）
    pencil: '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>',
    'circle-x': '<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
    flag: '<path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/>',
  };
  const icon = (name, size = 20) =>
    '<svg class="ico" viewBox="0 0 24 24" width="' + size + '" height="' + size +
    '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (LUCIDE[name] || '') + '</svg>';

  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- 发帖弹层：开关都走这里 ----
  // 报头是常驻 sticky 的，feed 的高度要用「视口 − 报头」算，所以量一次写进 --nav-h
  // （和报告那边的 Masthead 同一个套路，只是这里不需要 ResizeObserver）
  function measureNav() {
    const mh = document.querySelector('.masthead');
    // ⚠️ 记的是导航栏的**下沿在文档里的位置**，不是它的高度。
    // 高度只有 31px，而它上面还有 26px 的上边距（手机端）——
    // 用高度当偏移，表单页会从 31px 开始、把导航栏下半截盖住（截图里量出来的）。
    // 顺带：瀑布流高度用同一个值算，也就不会再多出那 26px 了。
    if (mh) {
      const r = mh.getBoundingClientRect();
      document.documentElement.style.setProperty('--nav-h', Math.ceil(r.bottom + window.scrollY) + 'px');
    }
  }
  measureNav();
  window.addEventListener('resize', measureNav);

  const postToggle = $('postToggle');
  const postCard = $('postCard');

  /**
   * 弹层开着的时候，别让滚动穿透到背后的瀑布流 ——
   * 用户 2026-10-01：「我点我要出一件的时候，上下滑动的时候，并不是出一件页面在滑，
   * 而是有品的商品在滑」。原因是只有详情锁了 body 滚动，表单弹层没锁。
   * 现在两个弹层共用这一个判断：**只要有一个开着就锁**（所以关掉其中一个、
   * 另一个还开着的时候不会误开）。
   */
  function syncScrollLock() {
    const open = postCard.classList.contains('is-open') || !$('detail').hidden;
    document.body.style.overflow = open ? 'hidden' : '';
  }

  function setForm(open) {
    postCard.classList.toggle('is-open', open);
    postToggle.setAttribute('aria-expanded', String(open));
    syncScrollLock();
    if (open) $('postClose').focus?.();
  }
  postToggle.addEventListener('click', () => setForm(true));
  $('postClose').addEventListener('click', () => setForm(false));

  $('cancelEdit').addEventListener('click', () => {
    stopEdit();
    $('msg').textContent = '已取消编辑';
  });

  /* ------------------------------------------------------------------
   * 上传前压图（用户 2026-10-01：「做一下上传前压缩图片」）。
   *
   * 手机拍的原图动辄 3~5MB，而接口上限 400KB（图直接存进 D1 的 BLOB，越省越好）。
   * 以前是让用户自己撞上限报错；现在先在浏览器里缩到长边 1400px、JPEG 质量 0.82，
   * 还超就逐档降（0.7 / 0.6 / 0.5）。
   *
   * 压完包成一个新的 File 交给 takeFile —— 它对拿到的 File 一视同仁，
   * 所以「预览、提交、编辑回填」三条路径全都自动用上压过的图，不用改别处。
   *
   * imageOrientation: 'from-image' 是必须的：createImageBitmap 默认**不看** EXIF 方向，
   * 少了它，手机横拍的照片压完就躺下了。
   * ------------------------------------------------------------------ */
  const MAX_EDGE = 1400;
  const TARGET_BYTES = 360 * 1024; // 给 base64 留余量（接口上限 400KB）
  async function compressImage(file) {
    if (!file || !/^image\//.test(file.type)) return file;
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      return file; // 解不开就原样交出去，让接口去报格式错误
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
    if (bmp.close) bmp.close();
    const toBlob = (q) => new Promise((res) => cv.toBlob(res, 'image/jpeg', q));
    let blob = await toBlob(0.82);
    for (const q of [0.7, 0.6, 0.5]) {
      if (blob && blob.size <= TARGET_BYTES) break;
      blob = await toBlob(q);
    }
    if (!blob || blob.size >= file.size) return file; // 压完反而更大就别换
    $('msg').textContent =
      '照片已压缩：' + Math.round(file.size / 1024) + 'KB → ' + Math.round(blob.size / 1024) + 'KB' +
      '（' + w + '×' + h + '）';
    return new File([blob], (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }
  async function takeCompressed(file) {
    if (!file) return;
    $('msg').textContent = '正在压缩照片…';
    takeFile(await compressImage(file));
  }

  // ---- 选图 / 拖图 ----
  $('photo').addEventListener('change', (e) => takeCompressed(e.target.files?.[0]));
  $('swap').addEventListener('click', () => { clearPhoto(); $('photo').click(); });
  const box = $('photoBox');
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('photo--dragover'); });
  box.addEventListener('dragleave', () => box.classList.remove('photo--dragover'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('photo--dragover');
    const f = e.dataTransfer?.files?.[0];
    if (f) takeCompressed(f);
  });

  // ---- 列表 ----
  // ---- 「我的」视图：/market/?mine=1 ----
  // 只列自己发过的（凭据在 localStorage 的 tokens 里），发帖入口也只在这页出现。
  const mineMode = new URLSearchParams(location.search).get('mine') === '1';
  if (mineMode) {
    document.body.classList.add('mine');
    const navMine = document.getElementById('navMine');
    if (navMine) navMine.setAttribute('aria-current', 'page');
    // 「我要出一件」已挪到「有品」页（用户 2026-10-05 要求），「我的」页不再显示它。
    // 表单本身还在 DOM 里 —— 从详情点「编辑」照样能打开它。
    $('postToggle').style.display = 'none';
    // 「我的」页是管理页（收藏 / 作品 / 转移码），交易规则那几段留给「有品」页 ——
    // 那里才是发帖和交易发生的地方，免责声明放那儿更合适。
    const mineFoot = document.querySelector('footer');
    if (mineFoot) mineFoot.style.display = 'none';
  }

  // ---- 抖音式 tab 条：作品 / 转移码 / 收藏 ----
  if (mineMode) {
    const tabs = $('mineTabs');
    const paneWorks = $('paneWorks');
    const paneTransfer = $('paneTransfer');
    const paneFavs = $('paneFavs');
    if (tabs) {
      tabs.hidden = false;
      const showTab = (name) => {
        if (paneWorks) paneWorks.hidden = name !== 'works';
        if (paneTransfer) paneTransfer.hidden = name !== 'transfer';
        if (paneFavs) paneFavs.hidden = name !== 'favs';
        tabs.querySelectorAll('.mine-tab').forEach((b) => {
          const on = b.dataset.tab === name;
          b.classList.toggle('mine-tab--on', on);
          b.setAttribute('aria-selected', String(on));
        });
      };
      tabs.addEventListener('click', (e) => {
        const b = e.target.closest('.mine-tab');
        if (b) showTab(b.dataset.tab);
      });
      showTab('favs');
    }
  }

  // ---- 「我的」收藏的商品（报告页点过爱心，快照见 App.jsx 的 saveFavorite）----
  if (mineMode) {
    const FAV_KEY = 'deals.favorites';
    let favs = [];
    try { favs = JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch {}
    if (!Array.isArray(favs)) favs = [];
    const favSection = $('favs');
    const favList = $('favsList');
    const favEmpty = $('favsEmpty');
    const renderFavs = () => {
      if (!favList) return;
      if (!favs.length) {
        if (favSection) favSection.hidden = true;
        if (favEmpty) favEmpty.hidden = false;
        return;
      }
      if (favSection) favSection.hidden = false;
      if (favEmpty) favEmpty.hidden = true;
      favList.innerHTML = favs.map((f) => {
        const u = esc(f.url), img = esc(f.image), nm = esc(f.name), fid = esc(f.id);
        const cur = esc(f.currency || '¥'), pr = esc(String(f.price));
        return '<div class="fav"><a class="fav__link" href="' + u + '" target="_blank" rel="noreferrer">'
          + '<img class="fav__img" src="' + img + '" alt="" loading="lazy">'
          + '<div class="fav__body"><div class="fav__name">' + nm + '</div>'
          + '<div class="fav__price">' + cur + pr + '</div></div></a>'
          + '<button class="fav__del" type="button" data-favdel="' + fid + '" aria-label="取消收藏">×</button></div>';
      }).join('');
    };
    renderFavs();
    // 取消收藏：删快照，并同步报告页的 picks/dropped（让那边的爱心也跟着灭）
    favList?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-favdel]');
      if (!btn) return;
      e.preventDefault();
      const id = btn.getAttribute('data-favdel');
      const f = favs.find((x) => x.id === id);
      if (f && f.prefix) {
        try {
          const pk = f.prefix + '.picks';
          const dk = f.prefix + '.dropped';
          const picks = new Set(JSON.parse(localStorage.getItem(pk) || '[]'));
          const dropped = new Set(JSON.parse(localStorage.getItem(dk) || '[]'));
          picks.delete(id);
          dropped.add(id);
          localStorage.setItem(pk, JSON.stringify([...picks]));
          localStorage.setItem(dk, JSON.stringify([...dropped]));
        } catch {}
      }
      favs = favs.filter((x) => x.id !== id);
      try { localStorage.setItem(FAV_KEY, JSON.stringify(favs)); } catch {}
      renderFavs();
    });
  }

  // ---- 「我的」转移码 ----
  // 凭据（能改能删的钥匙）只存在这一个浏览器里，换手机或清缓存就找不回来 ——
  // 服务端只存哈希，救不回。所以给一个把它搬走的出口：
  // 把本地那份凭据打成一串码，在别的设备上粘回来。
  //
  // ⚠️ 它不是账号：**谁拿到这串码，谁就能删你发的东西**。文案里要把这点说清楚。
  // 之所以能零服务端改动做完，是因为凭据本来就是客户端持有的 —— 这里只是让它可以搬。
  const TX_PREFIX = 'GP1.';
  const b64e = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const b64d = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
  function txCode() {
    return TX_PREFIX + b64e(JSON.stringify(tokens.all()));
  }
  function txApply(code) {
    const raw = String(code || '').trim().replace(/\s+/g, '');
    if (!raw.startsWith(TX_PREFIX)) return '这段码不对（应该以 GP1. 开头）';
    let obj;
    try {
      obj = JSON.parse(b64d(raw.slice(TX_PREFIX.length)));
    } catch {
      return '这段码读不出来，可能复制时缺了字符';
    }
    if (!obj || typeof obj !== 'object') return '这段码里没有凭据';
    // 合并：已有的不动（同一台设备重复导入不会出问题）
    const all = tokens.all();
    let n = 0;
    for (const [id, token] of Object.entries(obj)) {
      if (typeof id === 'string' && typeof token === 'string' && id && !all[id]) {
        all[id] = token;
        n++;
      }
    }
    localStorage.setItem('market.tokens', JSON.stringify(all));
    return n ? '导入了 ' + n + ' 条，马上刷新…' : '这段码里的帖子，这台设备上已经有了';
  }
  if (mineMode) {
    const txBox = $('transfer');
    if (txBox) {
      // 平时只占一行（那颗按钮），点开才展开整个面板
      const ta = $('transferCode');
      const hint = $('transferHint');
      $('exportBtn').addEventListener('click', () => {
        ta.readOnly = true;
        ta.value = txCode();
        ta.select();
        $('importGo').hidden = true;
        $('copyCode').hidden = false;
        hint.textContent = '这串码就是钥匙，别公开贴。发到新设备（微信传给自己就行），在那台设备的这一页点「从别的设备导入」再粘进去。';
      });
      $('importBtn').addEventListener('click', () => {
        ta.readOnly = false;
        ta.value = '';
        ta.focus();
        $('importGo').hidden = false;
        $('copyCode').hidden = true;
        hint.textContent = '把旧设备上生成的那串码粘进来，再点「导入」。';
      });
      $('copyCode').addEventListener('click', async () => {
        ta.select();
        try {
          await navigator.clipboard.writeText(ta.value);
          hint.textContent = '已复制 ✅';
        } catch {
          try {
            document.execCommand('copy');
            hint.textContent = '已复制 ✅';
          } catch {
            hint.textContent = '自动复制不行，手动选中复制吧';
          }
        }
      });
      $('importGo').addEventListener('click', () => {
        const msg = txApply(ta.value);
        hint.textContent = msg;
        if (msg.startsWith('导入了')) setTimeout(() => location.reload(), 900);
      });
    }
  }

  async function load() {
    $('loading').style.display = 'block';
    try {
      const r = await fetch('/api/listings', { headers: { Accept: 'application/json' } });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || '读取失败');
      const items = data.items || [];
      if (mineMode) {
        // 自己发的：本地凭据里记着 id。市场一次只给 60 条，
        // 更早发的那些按 id 单条补回来（接口支持 ?id=）。
        const myTokens = tokens.all(); // { id: 凭据 }
        const mineIds = Object.keys(myTokens);
        const have = items.filter((x) => myTokens[x.id]);
        const missing = mineIds.filter((id) => !items.some((x) => x.id === id));
        const extra = await Promise.all(missing.map((id) =>
          fetch('/api/listings?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
            .then((r) => r.json())
            .then((d) => (d.items || [])[0])
            .catch(() => null)
        ));
        const mine = have.concat(extra.filter(Boolean));
        mine.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        render(mine);
      } else {
        render(items);
      }
      loadAllComments();
    } catch (e) {
      $('loading').textContent = '读不出来了：' + e.message;
      return;
    }
    $('loading').style.display = 'none';
  }

  // 详情里的那一块（图 + 信息 + 动作栏）—— 点开封面时才搭，省得一开始就渲染 15 份
  // 详情动作栏：**没有点赞和评论按钮**（用户 2026-10-01：「点进详情，不需要点赞和
  // 评论的 logo」）—— 那两个数字封面上已经有，详情里再摆一排图标只是噪音。
  // 编辑 / 下架 / 举报：**用文字按钮**。中途试过换成纯图标（pencil / circle-x / flag），
  // 用户看过之后要求换回来（2026-10-01：「把编辑和下架的图标换成之前的文字版的按钮」）——
  // 图标确实更整齐，但「编辑 / 下架」是**动作**，中文两个字比一个笔尖更好认。
  // 「举报」也一起换回文字：它和这两个在同一行，只换两个会变成一行里混着图标与文字。
  //
  // ⚠️ 模板字符串里**只能**用 ${} 插值：写 {/* … */} 会被当成正文原样渲染出来
  // （这个坑我在这一个文件里踩了三次，所以下面加了一条测试盯着它）。
  //
  // 详情里的按钮：点赞 / 评论 / 举报（收藏按钮 2026-10-01 按用户要求去掉，
  // 接口与数据都还在 —— /api/react 仍接受 kind=save，只是详情里不再有入口；
  // 模板字符串里**不能**写 {/* … */}，那不是注释、会原样渲染出来）。
  function detailHtml(it) {
    const likes = Number(it.likes) || 0;
    const mine = !!tokens.get(it.id);
    return `
      <button class="detail__close" type="button" data-close-detail aria-label="关闭">${icon('x', 20)}</button>
      <img class="detail__pic" src="/api/img/${encodeURIComponent(it.id)}" alt="${esc(it.title)}" decoding="async">
      <div class="detail__body">
        <div class="detail__title">${esc(it.title)}</div>
        <div class="detail__price">¥${Number(it.price).toLocaleString('zh-CN')}${it.size ? ' <span class="detail__size">' + esc(it.size) + '</span>' : ''}</div>
        <div class="detail__meta">${it.contact ? '联系：<b>' + esc(it.contact) + '</b> · ' : ''}${ago(it.created_at)}</div>
        ${it.note ? `<div class="detail__note">${esc(it.note)}</div>` : ''}
        <div class="detail__acts">
          ${mine
            ? `<button class="btn btn--ghost btn--sm" data-edit="${esc(it.id)}">编辑</button><button class="btn btn--ghost btn--sm" data-del="${esc(it.id)}">下架</button>`
            : `<button class="btn btn--ghost btn--sm" data-report="${esc(it.id)}">举报</button>`}
        </div>
        <div class="cmts" data-cmts="${esc(it.id)}">
          <div class="cmts__list"></div>
          <div class="cmts__form">
            <input type="text" maxlength="200" placeholder="说点什么…（别人也看得到）" aria-label="评论">
            <button class="btn btn--sm" type="button" data-send>发表</button>
          </div>
        </div>
      </div>`;
  }

  /**
   * 瀑布流（小红书那种）：**每张封面按图片自己的比例**排，两列各自往下堆。
   *
   * 所以左右两列不对齐、图片也一张都不用裁 —— 用户发什么比例都行。
   *
   * 为什么用 JS 定位而不是 CSS 的 `column-count`：后者会把顺序变成「竖着排」
   * （最新的 8 张全挤在左列），这个页面按时间倒序，那样读起来是乱的。
   * 定位用绝对坐标，容器高度自己算出来。
   *
   * 图片是异步加载的，加载完高度才会对，所以每张图 onload 都重排一次
   * （先乱一下再定格，小红书也是这个行为）。
   */
  function layoutWall() {
    const wall = $('list');
    const notes = [...wall.querySelectorAll('.note')];
    if (!notes.length) return;
    const gap = 8;
    // 列数按「一张封面大约多宽」算，而不是写死 2/4：
    // 页面壳放宽到 1560 之后，写死 4 列会让每张封面 380px 宽（太大了）。
    // 目标 250px 一张 → 1440 的窗口约 5~6 列，和手机上的观感一致。
    const cols = Math.max(2, Math.round(wall.clientWidth / 250));
    const colW = Math.floor((wall.clientWidth - gap * (cols - 1)) / cols);
    const heights = new Array(cols).fill(0);
    for (const n of notes) {
      n.style.width = colW + 'px';
      let col = 0;
      for (let i = 1; i < cols; i++) if (heights[i] < heights[col]) col = i;
      n.style.left = col * (colW + gap) + 'px';
      n.style.top = heights[col] + 'px';
      heights[col] += n.offsetHeight + gap;
    }
    wall.style.height = Math.max(...heights) + 'px';
  }

  // 视口变了要重排（列数、列宽都会变）；图片加载完也要（这时高度才是真的）
  window.addEventListener('resize', layoutWall);
  window.addEventListener('load', layoutWall);

  // 一次只渲染这么多张（用户 2026-10-01：「不需要一下加载那么多，边刷边加载就行了」）。
  // 数据仍是整批取回的（接口一次给 60 条），只是**先渲染 12 张**，
  // 滚到快到底再多放一页 —— 首屏要画的卡片、要发的图片请求都少得多。
  const PAGE = 12;
  let shown = 0;
  window.addEventListener('scroll', () => {
    if (shown >= lastItems.length) return;
    if (window.innerHeight + window.scrollY < document.body.scrollHeight - 700) return;
    appendPage();
  }, { passive: true });

  /**
   * 造一张封面卡。抽出来是为了「追加」——原来翻页是整墙重渲染，
   * 屏幕会白闪一下、图片也要重新挂一遍；现在只往墙上再贴几张。
   */
  function makeCard(it) {
        const card = document.createElement('article');
        card.className = 'note';
        const liked = !!it.liked;
        const likes = Number(it.likes) || 0;
        card.innerHTML = `
          <a class="note__open" href="?item=${encodeURIComponent(it.id)}" data-open="${esc(it.id)}">
            <img class="note__pic" src="/api/img/${encodeURIComponent(it.id)}" alt="${esc(it.title)}" loading="lazy" decoding="async">
            <div class="note__title">${esc(it.title)}</div>
          </a>
          <div class="note__foot">
            <span class="note__price">¥${Number(it.price).toLocaleString('zh-CN')}</span>
            <button class="note__like${liked ? ' is-on' : ''}" type="button" data-react="like" data-id="${esc(it.id)}" aria-pressed="${liked ? 'true' : 'false'}" aria-label="点赞">
              ${icon('heart', 14)}<span data-count="like">${likes || ''}</span>
            </button>
          </div>`;
        const pic = card.querySelector('.note__pic');
        // 图一加载完就重排（这时才知道它多高）；已经缓存好的图 complete 直接为真
        if (pic) pic.addEventListener('load', layoutWall);
    return card;
  }

  /** 再放一页（PAGE 张）到墙上 */
  function appendPage() {
    const list = $('list');
    for (const it of lastItems.slice(shown, shown + PAGE)) {
      list.appendChild(makeCard(it));
      shown++;
    }
    requestAnimationFrame(layoutWall);
  }

  function render(items) {
    lastItems = items;
    const list = $('list');
    list.innerHTML = '';
    $('empty').style.display = items.length ? 'none' : 'block';
    $('empty').textContent = mineMode
      ? '你还没发过东西。点上面的「我要出一件」发一件试试。'
      : '还没有人发。你要是在店里捡到漏，点上面的「我的」去发一件。';
    shown = 0;
    appendPage(); // 第一页
    maybeOpenFromUrl(); // 分享进来的深链
  }

  // ---- 编辑：把这一件填回表单，提交时走 /api/edit ----
  function openForm() {
    $('postCard').classList.add('is-open');
    $('postToggle').setAttribute('aria-expanded', 'true');
    syncScrollLock();
  }

  function startEdit(id) {
    const it = lastItems.find((x) => x.id === id);
    if (!it) return;
    editing = { id };
      // ⚠️ 先把详情关掉再开表单。详情是整屏覆盖（z-index 50）、表单在它下面（45），
      // 不关的话表单确实打开了，但被详情整个盖住 —— 用户看到的就是「点编辑没反应」
      // （2026-10-05 用户报的；实测点了之后屏幕中央命中的仍然是详情）。
      closeDetail();
      openForm();
    $('title').value = it.title || '';
    $('price').value = it.price ?? '';
    // 尺码与联系方式不再是表单字段（都写进详情里），所以编辑时也不再回填 ——
    // 它们仍然存在库里，详情页照常显示。
    $('note').value = it.note || '';
    // 不换图：image 留 null，预览直接显示库里那张，提交时后端沿用
    image = null;
    $('previewImg').src = '/api/img/' + encodeURIComponent(id);
    $('previewImg').hidden = false;
    $('pick').hidden = true;
    $('swap').hidden = false;
    $('photoBox').classList.add('photo--has');
    $('submit').textContent = '保存修改';
    $('cancelEdit').hidden = false;
    const msg = $('msg');
    msg.className = 'msg';
    msg.textContent = '正在修改：' + it.title;
    $('form').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function stopEdit() {
    editing = null;
    $('submit').textContent = '发布';
    $('cancelEdit').hidden = true;
    $('form').reset();
    clearPhoto();
    $('msg').className = 'msg';
    $('msg').textContent = '';
  }

  // ---- 发布 ----
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (posting) return;
    const msg = $('msg');
    // 编辑时 image 为 null 是正常的（= 沿用库里那张），只有新发才必须要图
    if (!image && !editing) { msg.className = 'msg msg--err'; msg.textContent = '先选一张照片'; return; }
    posting = true;
    $('submit').disabled = true;
    msg.className = 'msg';
    msg.textContent = '发布中…';
    try {
      const editingId = editing?.id || null;
      const r = await fetch(editingId ? '/api/edit' : '/api/listings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: $('title').value, price: $('price').value,
          size: '', contact: '', note: $('note').value,
          // 编辑时不换图就别带 image：后端沿用库里那张（不用重传一遍图）
          ...(editingId && !image ? {} : { image }),
          ...(editingId ? { id: editingId, token: tokens.get(editingId) } : { website: $('website').value }),
        }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || (editingId ? '保存失败' : '发布失败'));
      if (editingId) {
        stopEdit();
        msg.className = 'msg msg--ok';
        msg.textContent = '改好了。';
      } else {
        if (data.token && data.id) tokens.set(data.id, data.token);
        msg.className = 'msg msg--ok';
        msg.textContent = '发出去了。要改要删，点开这件、进去就能改或删（凭据存在这个浏览器里）。';
        $('form').reset();
        clearPhoto();
      }
      load();
    } catch (err) {
      msg.className = 'msg msg--err';
      msg.textContent = err.message;
    } finally {
      posting = false;
      $('submit').disabled = false;
    }
  });

  // ---- 评论 ----
  // 发评论时回的凭据也只存在这个浏览器里，用来删自己那条
  const cmtTokens = {
    all: () => { try { return JSON.parse(localStorage.getItem("market.commentTokens") || "{}"); } catch { return {}; } },
    set: (id, token) => { const t = cmtTokens.all(); t[id] = token; localStorage.setItem("market.commentTokens", JSON.stringify(t)); },
    get: (id) => cmtTokens.all()[id] || null,
  };

  // 一件商品的评论缓存：默认只渲染前 3 条，点「还有 N 条」再全渲染
  const commentsById = {};

  function renderComments(box, items) {
    const list = box.querySelector(".cmts__list");
    const id = box.getAttribute("data-cmts");
    commentsById[id] = items;
    if (!items.length) { list.innerHTML = '<div class="cmts__empty">还没有人评论</div>'; return; }
    const expanded = box.dataset.expanded === "1";
    // 默认展开（用户要的），但别让一张卡被评论撑太长：只摆前 3 条。
    // ⚠️ **自己发的评论永远要显示**（用户 2026-10-05：「发出去的评论本人要能删除」）：
    //    自己的评论排在 3 条之后时，本人根本看不见，也就找不到那颗「删除」按钮 ——
    //    功能其实是好的，是「看不见」让它等于没有。
    const shown = expanded ? items : items.filter((c, i) => i < 3 || cmtTokens.get(c.id));
    const rest = items.length - shown.length;
    list.innerHTML = shown.map((c) => {
      const mine = !!cmtTokens.get(c.id);
      return '<div class="cmt" data-cid="' + esc(c.id) + '">' +
        '<div class="cmt__body">' + esc(c.body) + "</div>" +
        '<div class="cmt__meta"><span>' + ago(c.created_at) + "</span>" +
        (c.bySeller ? '<span class="cmt__seller">卖家</span>' : "") +
        (mine ? '<button class="cmt__del" type="button" data-cdel="' + esc(c.id) + '">删除</button>' : "") +
        "</div></div>";
    }).join("") +
      (rest > 0
        ? '<button class="cmt__more" type="button" data-more="' + esc(id) + '">还有 ' + rest + ' 条评论</button>'
        : "");
  }

  /**
   * 进页面时**一趟**把全部可见评论取回来，按 listing_id 分组填进各张卡片。
   * 默认展开之后如果还按卡片各发一个请求，一屏几十张卡就是几十个请求。
   */
  async function loadAllComments() {
    const boxes = document.querySelectorAll('.cmts');
    if (!boxes.length) return;
    boxes.forEach((b) => { b.querySelector('.cmts__list').innerHTML = '<div class="cmts__empty">加载中…</div>'; });
    try {
      const r = await fetch('/api/comments');
      const data = await r.json();
      const byListing = {};
      for (const c of data.items || []) (byListing[c.listingId] ||= []).push(c);
      for (const box of boxes) {
        const id = box.getAttribute('data-cmts');
        renderComments(box, byListing[id] || []);
        box.dataset.loaded = '1';
      }
    } catch (err) {
      boxes.forEach((b) => { b.querySelector('.cmts__list').innerHTML = '<div class="cmts__empty">读不出来了</div>'; });
    }
  }

  async function loadComments(box, id) {
    const list = box.querySelector(".cmts__list");
    list.innerHTML = '<div class="cmts__empty">加载中…</div>';
    try {
      const r = await fetch("/api/comments?listingId=" + encodeURIComponent(id));
      const data = await r.json();
      renderComments(box, data.items || []);
      box.dataset.loaded = "1";
    } catch (err) {
      list.innerHTML = '<div class="cmts__empty">读不出来了</div>';
    }
  }

  function bumpCount(id, delta) {
    const btn = document.querySelector('[data-comments="' + id + '"]');
    const box = document.querySelector('[data-cmts="' + id + '"]');
    if (!btn || !box) return;
    // 动作栏上的按钮由图标 + 数字两块组成，所以只改那个数字，
    // 别像原来那样把整个按钮的文字重写一遍（那会把图标也冲掉）
    const n = Math.max(0, box.querySelectorAll('.cmt').length + delta);
    const out = btn.querySelector('[data-count="comment"]');
    if (out) out.textContent = n ? String(n) : '';
  }

  // ---- 下架 / 举报 ----
  // ---- 点封面 → 打开详情（整屏覆盖）；关掉就是把 hidden 放回去 ----
  // ---- 分享用的深链 ----
  // 封面里那个 <a href="?item=…">：点它被下面 preventDefault 拦下，改成页面内打开
  // （不整页刷新），同时 pushState 把地址栏改成 ?item=<id> —— 于是「打开的那一条」
  // 和「地址栏里那一条」永远一致，复制地址发给别人就能直达。
  let deepLinkOpened = false;
  function maybeOpenFromUrl() {
    if (deepLinkOpened) return;
    const id = new URLSearchParams(location.search).get('item');
    if (!id || deepLinkOpened) return;
    deepLinkOpened = true;
    if (lastItems.some((x) => x.id === id)) {
      openDetail(id);
      return;
    }
    // 不在已取回的这一批里（别人分享的链接可能指向很旧的一条）→ 单独按 id 取回来
    fetch('/api/listings?id=' + encodeURIComponent(id), { headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((d) => {
        const one = (d.items || [])[0];
        if (!one) return;
        lastItems.unshift(one);
        openDetail(id);
      })
      .catch(() => {});
  }
  // 浏览器前进/后退也跟着走
  window.addEventListener('popstate', () => {
    const id = new URLSearchParams(location.search).get('item');
    if (id) openDetail(id);
    else closeDetail();
  });

  function openDetail(id) {
    const it = lastItems.find((x) => x.id === id);
    if (!it) return;
    if (new URLSearchParams(location.search).get('item') !== id) {
      history.pushState({}, '', (mineMode ? '?mine=1&' : '?') + 'item=' + encodeURIComponent(id));
    }
    const box = $('detail');
    box.innerHTML = detailHtml(it);
    box.hidden = false;
    syncScrollLock(); // 详情打开时别让背后的瀑布流跟着滚
    loadComments(box.querySelector('.cmts'), id);
  }
  function closeDetail() {
    const box = $('detail');
    box.hidden = true;
    box.innerHTML = '';
    if (location.search) history.pushState({}, '', mineMode ? '?mine=1' : location.pathname);
    syncScrollLock();
  }

  // ⚠️ 委托挂在 document 上，而不是 #list：
  // 详情（#detail）是 #list 的**兄弟节点**，挂在 #list 上的话，
  // 详情里的点赞 / 收藏 / 评论 / 关闭一个都收不到事件（改版时踩过这个坑）。
  document.addEventListener('click', async (e) => {
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) {
      // 它是个真链接（便于复制地址），但点击不整页刷新，改成页面内打开
      e.preventDefault();
      openDetail(openBtn.getAttribute('data-open'));
      return;
    }
    if (e.target.closest('[data-close-detail]')) { closeDetail(); return; }
    // ---- 点赞：服务端是「切换」语义，回的 on 与计数就是最终状态 ----
    const reactBtn = e.target.closest('[data-react]');
    if (reactBtn) {
      const id = reactBtn.getAttribute('data-id');
      const kind = reactBtn.getAttribute('data-react');
      reactBtn.disabled = true;
      try {
        const r = await fetch('/api/react', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId: id, kind }),
        });
        const data = await r.json();
        if (data.ok) {
          reactBtn.classList.toggle('is-on', !!data.on);
          reactBtn.setAttribute('aria-pressed', data.on ? 'true' : 'false');
          const n = reactBtn.querySelector('[data-count="' + kind + '"]');
            const v = data.likes;
          if (n) n.textContent = v ? String(v) : '';
        }
      } catch (err) {
        // 点不动就算了，不弹窗打断「刷」这个动作
      }
      reactBtn.disabled = false;
      return;
    }

    const cmtBtn = e.target.closest('[data-comments]');
    const sendBtn = e.target.closest('[data-send]');
    const delBtn = e.target.closest('[data-cdel]');
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    const rep = e.target.closest('[data-report]');
    const moreBtn = e.target.closest('[data-more]');
    if (moreBtn) {
      const id = moreBtn.getAttribute("data-more");
      const box = document.querySelector('[data-cmts="' + id + '"]');
      box.dataset.expanded = "1"; // 之后再渲染（比如自己删了一条）也保持全展开
      renderComments(box, commentsById[id] || []);
      return;
    }
    if (cmtBtn) {
      // **评论永远展开**（用户 2026-10-01：「不要展开评论这个，永远展开」），
      // 所以这个按钮不再是开关 —— 点它只是把光标送到输入框。
      //
      // 顺带修掉一笔旧账：这里原先是 `cmtBtn.textContent = '展开评论（3）'`，
      // 把按钮里的内容**整段重写**。换成 lucide 图标之后那个写法更明显 ——
      // 点一下图标就没了。现在只操作输入框，按钮原样不动。
      const id = cmtBtn.getAttribute('data-comments');
      const box = document.querySelector('[data-cmts="' + id + '"]');
      if (!box) return;
      if (box.dataset.loaded !== '1') loadComments(box, id);
      const input = box.querySelector('input');
      if (input) input.focus();
      return;
    }
    if (sendBtn) {
      const box = sendBtn.closest(".cmts");
      const id = box.getAttribute("data-cmts");
      const input = box.querySelector("input");
      const text = input.value.trim();
      if (!text) { input.focus(); return; }
      sendBtn.disabled = true;
      try {
        const r = await fetch("/api/comments", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ listingId: id, body: text, website: document.getElementById("website").value }),
        });
        const data = await r.json();
        if (!data.ok) throw new Error(data.error || "评论失败");
        if (data.token) cmtTokens.set(data.id, data.token);
        input.value = "";
        await loadComments(box, id);
        bumpCount(id, 1);
      } catch (err) {
        alert(err.message);
      } finally {
        sendBtn.disabled = false;
      }
      return;
    }
    if (delBtn) {
      const cid = delBtn.getAttribute("data-cdel");
      if (!confirm("删掉自己这条评论？")) return;
      const r = await fetch("/api/comment-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: cid, token: cmtTokens.get(cid) }),
      });
      const data = await r.json();
      if (!data.ok) { alert(data.error || "删不掉"); return; }
      const box = delBtn.closest(".cmts");
      delBtn.closest(".cmt").remove();
      bumpCount(box.getAttribute("data-cmts"), -1);
      if (!box.querySelectorAll(".cmt").length) box.querySelector(".cmts__list").innerHTML = '<div class="cmts__empty">还没有人评论</div>';
      return;
    }
    if (edit) startEdit(edit.getAttribute('data-edit'));
    if (del) {
      const id = del.getAttribute('data-del');
      if (!confirm('下架这件？凭据丢了就找不回来了。')) return;
      const r = await fetch('/api/delete', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, token: tokens.get(id) }),
      });
      const data = await r.json();
      alert(data.ok ? '已下架' : (data.error || '失败'));
      if (data.ok) load();
    }
    if (rep) {
      const id = rep.getAttribute('data-report');
      if (!confirm('举报这件？（盗图、假货、已经卖了…）')) return;
      await fetch('/api/report', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      rep.textContent = '已举报';
      rep.disabled = true;
    }
  });

  load();
})();
