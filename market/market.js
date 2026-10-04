/* 尾货市集的页面逻辑。
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
    if (mh) document.documentElement.style.setProperty('--nav-h', Math.ceil(mh.getBoundingClientRect().height) + 'px');
  }
  measureNav();
  window.addEventListener('resize', measureNav);

  const postToggle = $('postToggle');
  const postCard = $('postCard');
  function setForm(open) {
    postCard.classList.toggle('is-open', open);
    postToggle.setAttribute('aria-expanded', String(open));
    if (open) $('postClose').focus?.();
  }
  postToggle.addEventListener('click', () => setForm(true));
  $('postClose').addEventListener('click', () => setForm(false));

  $('cancelEdit').addEventListener('click', () => {
    stopEdit();
    $('msg').textContent = '已取消编辑';
  });

  // ---- 选图 / 拖图 ----
  $('photo').addEventListener('change', (e) => takeFile(e.target.files?.[0]));
  $('swap').addEventListener('click', () => { clearPhoto(); $('photo').click(); });
  const box = $('photoBox');
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('photo--dragover'); });
  box.addEventListener('dragleave', () => box.classList.remove('photo--dragover'));
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    box.classList.remove('photo--dragover');
    const f = e.dataTransfer?.files?.[0];
    if (f) takeFile(f);
  });

  // ---- 列表 ----
  async function load() {
    $('loading').style.display = 'block';
    try {
      const r = await fetch('/api/listings', { headers: { Accept: 'application/json' } });
      const data = await r.json();
      if (!data.ok) throw new Error(data.error || '读取失败');
      render(data.items || []);
      loadAllComments();
    } catch (e) {
      $('loading').textContent = '读不出来了：' + e.message;
      return;
    }
    $('loading').style.display = 'none';
  }

  // 详情里的那一块（图 + 信息 + 动作栏）—— 点开封面时才搭，省得一开始就渲染 15 份
  function detailHtml(it) {
    const likes = Number(it.likes) || 0;
    const saves = Number(it.saves) || 0;
    const mine = !!tokens.get(it.id);
    return `
      <button class="detail__close" type="button" data-close-detail aria-label="关闭">${icon('x', 20)}</button>
      <img class="detail__pic" src="/api/img/${encodeURIComponent(it.id)}" alt="${esc(it.title)}" decoding="async">
      <div class="detail__body">
        <div class="detail__title">${esc(it.title)}</div>
        <div class="detail__price">¥${Number(it.price).toLocaleString('zh-CN')}${it.size ? ' <span class="detail__size">' + esc(it.size) + '</span>' : ''}</div>
        <div class="detail__meta">联系：<b>${esc(it.contact)}</b> · ${ago(it.created_at)}</div>
        ${it.note ? `<div class="detail__note">${esc(it.note)}</div>` : ''}
        <div class="detail__acts">
          <button class="act${it.liked ? ' act--on' : ''}" type="button" data-react="like" data-id="${esc(it.id)}" aria-pressed="${it.liked ? 'true' : 'false'}">
            ${icon('heart', 18)}<span data-count="like">${likes || ''}</span>
          </button>
          <button class="act${it.saved ? ' act--on' : ''}" type="button" data-react="save" data-id="${esc(it.id)}" aria-pressed="${it.saved ? 'true' : 'false'}">
            ${icon('bookmark', 18)}<span data-count="save">${saves || ''}</span>
          </button>
          <button class="act" type="button" data-comments="${esc(it.id)}" aria-expanded="true">
            ${icon('message-circle', 18)}<span data-count="comment">${it.comments || ''}</span>
          </button>
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
    const cols = wall.clientWidth >= 900 ? 4 : 2;
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

  function render(items) {
    lastItems = items;
    const list = $('list');
    list.innerHTML = '';
    $('empty').style.display = items.length ? 'none' : 'block';
    $('listTitle').textContent = items.length ? '大家在出' : '大家在出';
    for (const it of items) {
      // 封面卡：图 + 标题 + 价格 + 赞数。整块是一个按钮（点开详情）
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'note';
      card.setAttribute('data-open', it.id);
      const likes = Number(it.likes) || 0;
      card.innerHTML = `
        <img class="note__pic" src="/api/img/${encodeURIComponent(it.id)}" alt="${esc(it.title)}" loading="lazy" decoding="async">
        <div class="note__title">${esc(it.title)}</div>
        <div class="note__foot">
          <span class="note__price">¥${Number(it.price).toLocaleString('zh-CN')}</span>
          <span class="note__like">${likes ? icon('heart', 13) + likes : ''}</span>
        </div>`;
      const pic = card.querySelector('.note__pic');
      // 图一加载完就重排（这时才知道它多高）；已经缓存好的图 complete 直接为真
      if (pic) pic.addEventListener('load', layoutWall);
      list.appendChild(card);
    }
    // 先按「图还没加载」的状态排一次（至少把左右列分好），图加载完再逐步校正
    requestAnimationFrame(layoutWall);
  }

  // ---- 编辑：把这一件填回表单，提交时走 /api/edit ----
  function openForm() {
    $('postCard').classList.add('is-open');
    $('postToggle').setAttribute('aria-expanded', 'true');
  }

  function startEdit(id) {
    const it = lastItems.find((x) => x.id === id);
    if (!it) return;
    editing = { id };
    openForm();
    $('title').value = it.title || '';
    $('price').value = it.price ?? '';
    $('size').value = it.size || '';
    $('contact').value = it.contact || '';
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
          title: $('title').value, price: $('price').value, size: $('size').value,
          contact: $('contact').value, note: $('note').value,
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
        msg.textContent = '发出去了。要改要删，点这件下面的按钮（凭据存在这个浏览器里）。';
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
    // 默认展开（用户要的），但别让一张卡被评论撑太长：只摆前 3 条
    const expanded = box.dataset.expanded === "1";
    const shown = expanded ? items : items.slice(0, 3);
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
  function openDetail(id) {
    const it = lastItems.find((x) => x.id === id);
    if (!it) return;
    const box = $('detail');
    box.innerHTML = detailHtml(it);
    box.hidden = false;
    document.body.style.overflow = 'hidden'; // 详情打开时别让背后的瀑布流跟着滚
    loadComments(box.querySelector('.cmts'), id);
  }
  function closeDetail() {
    const box = $('detail');
    box.hidden = true;
    box.innerHTML = '';
    document.body.style.overflow = '';
  }

  // ⚠️ 委托挂在 document 上，而不是 #list：
  // 详情（#detail）是 #list 的**兄弟节点**，挂在 #list 上的话，
  // 详情里的点赞 / 收藏 / 评论 / 关闭一个都收不到事件（改版时踩过这个坑）。
  document.addEventListener('click', async (e) => {
    const openBtn = e.target.closest('[data-open]');
    if (openBtn) { openDetail(openBtn.getAttribute('data-open')); return; }
    if (e.target.closest('[data-close-detail]')) { closeDetail(); return; }
    // ---- 点赞 / 收藏：服务端是「切换」语义，回的 on 与计数就是最终状态 ----
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
          const v = kind === 'like' ? data.likes : data.saves;
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
    if (e.target.closest('[data-close-comments]')) {
      const id = e.target.closest('[data-comments]') ? null : null;
      const box = e.target.closest('.cmts');
      if (box) box.hidden = true;
      return;
    }

    const moreBtn = e.target.closest('[data-more]');
    if (moreBtn) {
      const id = moreBtn.getAttribute("data-more");
      const box = document.querySelector('[data-cmts="' + id + '"]');
      box.dataset.expanded = "1"; // 之后再渲染（比如自己删了一条）也保持全展开
      renderComments(box, commentsById[id] || []);
      return;
    }
    if (cmtBtn) {
      const id = cmtBtn.getAttribute("data-comments");
      const box = document.querySelector('[data-cmts="' + id + '"]');
      box.hidden = !box.hidden;
      cmtBtn.setAttribute("aria-expanded", String(!box.hidden));
      const n = (box.querySelectorAll(".cmt").length) || 0;
      cmtBtn.textContent = (box.hidden ? "展开评论" : "收起评论") + (n ? "（" + n + "）" : "");
      if (!box.hidden && box.dataset.loaded !== "1") loadComments(box, id);
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
