/* 测评页的页面逻辑。
 *
 * 2026-10-06：这一页原来是「有品」市集（卖二手杂物），用户把它换成了测评。
 * 页面逻辑大半是**沿用**的（图片压缩、删除凭据、转移码、收藏夹、弹层开关），
 * 换掉的是中间那块：从「瀑布流 + 详情 + 评论 + 点赞」变成「一条测评 = 商品 + 心得 + 可选图」。
 *
 * 用 defer 加载，等 DOM 解析完再跑。
 */

(() => {
  const $ = (id) => document.getElementById(id);
  const MAX_BYTES = 400 * 1024;
  let image = null;      // 新选的图（data URL，已压过）
  let posting = false;   // 正在提交，防连点
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
    const open = postCard.classList.contains('is-open');
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


  // ══════════════════════════════════════════════════════════════════════
  //  测评
  //  和「市集」的根本区别：**每条测评绑在一件优衣库商品上**。
  //  所以入口在报告卡片上 —— 卡片带 ?productCode=&code=&name= 过来，这一页才让写。
  //  单独进这一页是「看别人写了什么」，不给写（不然「给哪件写」没有答案）。
  // ══════════════════════════════════════════════════════════════════════
  const params = new URLSearchParams(location.search);
  const mineMode = params.get('mine') === '1';
  const subject = {
    productCode: params.get('productCode') || '',
    code: params.get('code') || '',
    name: params.get('name') || '',
  };
  /** 把「正在评的那件」写到表单上（选完或带着 ?productCode= 进来时都走这里） */
  function showSubject() {
    const on = Boolean(subject.productCode);
    $('subject').hidden = !on;
    $('subject').textContent = on
      ? (subject.name || subject.code || '这件商品') + (subject.code ? '　' + subject.code : '')
      : '';
  }
  showSubject();
  // 带着 ?productCode= 进来（比如从别处分享的链接）就直接开表单；否则停在列表页
  if (subject.productCode) setForm(true);

  // ── 搜商品：只搜优衣库全站，选中一件才让发 ──
  let searchTimer = null;
  async function doSearch() {
    const q = $('psearch').value.trim();
    const box = $('presults');
    if (q.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<p class="presults__hint">搜着呢…</p>';
    let data;
    try {
      data = await (await fetch('/api/search?q=' + encodeURIComponent(q))).json();
    } catch {
      box.innerHTML = '<p class="presults__hint">搜不动，过会儿再试</p>';
      return;
    }
    if (!data.ok) { box.innerHTML = '<p class="presults__hint">' + esc(data.error || '搜不动') + '</p>'; return; }
    const items = data.items || [];
    if (!items.length) { box.innerHTML = '<p class="presults__hint">没搜到，换个词试试</p>'; return; }
    box.innerHTML = '';
    for (const it of items.slice(0, 12)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'presult';
      b.innerHTML =
        (it.image ? '<img class="presult__img" src="' + esc(it.image) + '" alt="" loading="lazy">' : '') +
        '<span class="presult__body"><span class="presult__name">' + esc(it.name) + '</span>' +
        '<span class="presult__meta">' + esc(it.code || '') + (it.price != null ? '　¥' + esc(it.price) : '') + '</span></span>';
      b.addEventListener('click', () => {
        subject.productCode = it.productCode;
        subject.code = it.code || '';
        subject.name = it.name || '';
        showSubject();
        box.hidden = true;
        $('body').focus();
      });
      box.appendChild(b);
    }
  }
  $('psearch').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 280); });

  /** 一条测评的 DOM */
  function reviewEl(it) {
    const box = document.createElement('article');
    box.className = 'review';
    const mine = tokens && tokens.has(it.id);
    const img = it.hasImage
      ? '<img class="review__img" src="/api/img/' + esc(it.id) + '" alt="" loading="lazy" decoding="async">'
      : '';
    const name = esc(it.name || it.code || '');
    // 商品名链回榜单：那件商品在榜单上长什么样、现在多少钱，一眼能对上
    const head = it.code
      ? '<a class="review__name" href="/uniqlo/?q=' + encodeURIComponent(it.code) + '" target="_blank" rel="noreferrer">' + name + '</a>'
      : '<span class="review__name">' + name + '</span>';
    box.innerHTML =
      '<div class="review__head">' + head +
        '<span class="review__code">' + esc(it.code || '') + '</span>' +
        '<span class="review__ago">' + ago(it.created_at) + '</span>' +
      '</div>' +
      (img ? '<div class="review__pic">' + img + '</div>' : '') +
      '<p class="review__body">' + esc(it.body).replace(/\n/g, '<br>') + '</p>' +
      (mine ? '<button class="review__del" type="button" data-del="' + esc(it.id) + '">删掉我这条</button>' : '');
    return box;
  }

  /** 拉一页；mine 模式只留自己写过的（认凭据） */
  async function load() {
    $('loading').style.display = 'block';
    try {
      const r = await fetch('/api/reviews');
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || '加载失败');
      let items = data.items || [];
      if (mineMode) items = items.filter((it) => tokens && tokens.has(it.id));

      $('list').innerHTML = '';
      items.forEach((it) => $('list').appendChild(reviewEl(it)));
      $('loading').style.display = 'none';
      $('empty').textContent = mineMode
        ? '你还没写过测评。去榜单上找一件你用过的，点卡片上的「写测评」。'
        : '还没有人写测评。去榜单上找一件你用过的，点卡片上的「写测评」。';
      $('empty').style.display = items.length ? 'none' : 'block';
    } catch (err) {
      $('loading').style.display = 'none';
      $('empty').textContent = '加载失败：' + (err.message || '网络问题');
      $('empty').style.display = 'block';
    }
  }

  // 删自己那条（凭发布时回的 token；服务端只存哈希）
  $('list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    const id = btn.getAttribute('data-del');
    if (!confirm('删掉这条测评？')) return;
    const r = await fetch('/api/review-delete', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, token: tokens && tokens.get ? tokens.get(id) : null }),
    });
    const data = await r.json();
    if (!data.ok) return alert(data.error || '删不掉');
    load();
  });

  // 发布
  $('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (posting) return;
    if (!subject.productCode) return ($('msg').textContent = '先在上面搜一下、选一件你要评的');
    const body = $('body').value.trim();
    if ([...body].length < 4) return ($('msg').textContent = '多写两句吧（至少 4 个字）');
    posting = true;
    $('submit').disabled = true;
    $('msg').textContent = '发布中…';
    try {
      const r = await fetch('/api/reviews', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...subject, body, image, website: $('website').value }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || '发布失败');
      if (data.id && data.token) tokens.set(data.id, data.token);   // 存删除凭据
      $('msg').textContent = '发布好了';
      $('body').value = '';
      clearPhoto();
      setTimeout(() => setForm(false), 700);
      load();
    } catch (err) {
      $('msg').textContent = err.message || '发布失败';
    } finally {
      posting = false;
      $('submit').disabled = false;
    }
  });

  // ---- 抖音式 tab 条：收藏 / 我的测评 / 转移码 ----
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


  load();
})();
