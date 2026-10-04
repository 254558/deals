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
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- 展开 / 收起发帖表单（平时就一行「我要出一件」）----
  const postToggle = $('postToggle');
  postToggle.addEventListener('click', () => {
    const open = postToggle.getAttribute('aria-expanded') === 'true';
    postToggle.setAttribute('aria-expanded', String(!open));
    $('postBody').hidden = open;
    // 不自动聚焦「商品名」：手机上会立刻弹出键盘、还会把页面顶一下，展开就是展开
  });

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

  function render(items) {
    lastItems = items;
    const list = $('list');
    list.innerHTML = '';
    $('empty').style.display = items.length ? 'none' : 'block';
    $('listTitle').textContent = items.length ? `上下滑着看（${items.length}）` : '上下滑着看';
    for (const it of items) {
      const el = document.createElement('article');
      el.className = 'slot';
      const mine = !!tokens.get(it.id);
      const likes = Number(it.likes) || 0;
      const saves = Number(it.saves) || 0;
      // 一屏一条：图铺满、信息压在底部、动作栏贴右边。
      // 评论面板还是原来那套 DOM（.cmts），只是 CSS 把它变成底部弹层 ——
      // 所以加载/分页/删除那条链路一行都不用改。
      el.innerHTML = `
        <img class="slot__pic" src="/api/img/${encodeURIComponent(it.id)}" alt="${esc(it.title)}" loading="lazy" decoding="async">
        <div class="rail">
          <button class="rail__btn${it.liked ? ' rail__btn--on' : ''}" type="button" data-react="like" data-id="${esc(it.id)}" aria-pressed="${it.liked ? 'true' : 'false'}" aria-label="点赞">
            <span class="rail__ico" aria-hidden="true">♥</span>
            <span class="rail__n" data-count="like">${likes || ''}</span>
          </button>
          <button class="rail__btn${it.saved ? ' rail__btn--on' : ''}" type="button" data-react="save" data-id="${esc(it.id)}" aria-pressed="${it.saved ? 'true' : 'false'}" aria-label="收藏">
            <span class="rail__ico" aria-hidden="true">★</span>
            <span class="rail__n" data-count="save">${saves || ''}</span>
          </button>
          <button class="rail__btn" type="button" data-comments="${esc(it.id)}" aria-expanded="false" aria-label="评论">
            <span class="rail__ico" aria-hidden="true">💬</span>
            <span class="rail__n" data-count="comment">${it.comments || ''}</span>
          </button>
        </div>
        <div class="slot__info">
          <div class="slot__title">${esc(it.title)}</div>
          <div class="slot__price">¥${Number(it.price).toLocaleString('zh-CN')}${it.size ? ' <span class="slot__size">' + esc(it.size) + '</span>' : ''}</div>
          <div class="slot__meta">联系：<b>${esc(it.contact)}</b></div>
          ${it.note ? `<div class="slot__note">${esc(it.note)}</div>` : ''}
          <div class="slot__foot">
            <span>${ago(it.created_at)}</span>
            ${mine
              ? `<button class="btn btn--ghost btn--sm" data-edit="${esc(it.id)}">编辑</button><button class="btn btn--ghost btn--sm" data-del="${esc(it.id)}">下架</button>`
              : `<button class="btn btn--ghost btn--sm" data-report="${esc(it.id)}">举报</button>`}
          </div>
        </div>
        <div class="cmts" data-cmts="${esc(it.id)}" hidden>
          <div class="cmts__head">评论<button class="cmts__close" type="button" data-close-comments aria-label="收起">×</button></div>
          <div class="cmts__list"></div>
          <div class="cmts__form">
            <input type="text" maxlength="200" placeholder="说点什么…（别人也看得到）" aria-label="评论">
            <button class="btn btn--sm" type="button" data-send>发表</button>
          </div>
        </div>`;
      list.appendChild(el);
    }
  }

  // ---- 编辑：把这一件填回表单，提交时走 /api/edit ----
  function openForm() {
    $('postToggle').setAttribute('aria-expanded', 'true');
    $('postBody').hidden = false;
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
  $('list').addEventListener('click', async (e) => {
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
          reactBtn.classList.toggle('rail__btn--on', !!data.on);
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
