<script setup>
/**
 * 导航栏里下来的那只猫 —— 平时满屏跑，往下滚时跟着导航栏一起上去、消失。
 *
 * 2026-10-06 用户：「看看我桌面有个 wNeko-master，用这个，让猫从导航栏下来，
 * 在屏幕跑来跑去」，随后要求把原版**所有状态**都做出来：睡 / 醒 / 挠 / 转身 / 玩 / 待机 / 走。
 *
 * 出处（**必须署名**，素材自带的 COPYRIGHT 全文只有这一句）：
 *   "oneko" is written by Tatsuya Kato, based on "xneko" written by Masayuki Koba.
 * 仓库：wNeko（github.com/kagurazakayashi），代码 MIT；精灵图 376×104、32×32 一格、32 帧。
 * 精灵图与格子坐标在 lib/neko-sprite.js（脚本从桌面 t_neko2.gif 生成，别手改）。
 *
 * ── 状态表 ──
 *   DESCEND  出生后往下走一段（现在出生位置随机、直接起步，这个状态基本用不上了，留着备用）
 *   IDLE     待机：mati3/mati2 慢慢交替（像在眨眼）
 *   WALK     走：八方向 × 两帧
 *   TURN     转身：换方向时先播一下 togi（用**新**方向那组），很短
 *   CHASE    追指针：本质也是走，方向由指针决定
 *   AWAKE    醒：指针一动播一下 awake，然后接着走
 *   DROWSY   困了：指针静够久 → **先挠头思考一会儿**，挠完才睡
 *            （用户 2026-10-06：「不要跑着跑着突然睡，加上挠头思考什么的再睡」）
 *   SLEEP    睡：DROWSY 播完 → 趴下；指针再动就醒
 *   SCRATCH  挠：撞到视口边时**有机会**挠一会儿（原版就是挠窗边）
 *   PLAY     偶尔自己玩一下（jare2）
 *
 * ⚠️ 两条按本站场景加的护栏（原版没有，因为原版猫只在窗口里慢慢晃）：
 *   ① 挠有**冷却**（两次至少隔 5 秒）且只有一半概率 —— 否则满屏乱跑会一直在挠；
 *   ② 转身只在"换方向"时播、且很短（260ms）；**追指针时不转身**（追要跟手）。
 *
 * ⚠️ 往下滚时那两个盒子会收上去，用户要「**朝最近的边跑出去**，不要突然消失」——
 *    所以收起时进 ESCAPE 状态：算出最近的那条边（另一个轴也偏就斜着），
 *    用走路的帧、按 1.9 倍速度一直跑到**整只出画面**才停（这时才不再画）。
 *    导航放回来时**先等一个随机时间（1.5–5 秒）再进场** —— 用户反复上下滑时，
 *    等待会被不断取消/重置，猫就一直在画面外，不会跟着一进一出地闪（RETURN）。
 *    ⚠️ 第一版是把整只**平移一整屏高**（transform）—— 那看着就是"瞬间消失"，
 *      用户报的就是这个：「我一上滑，猫瞬间就消失了」。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { NEKO_SPRITE, NEKO_FRAMES } from '../lib/neko-sprite.js';

const props = defineProps({
  /** 一只猫的像素尺寸（精灵图 32×32 一格，32 = 原尺寸、最清晰） */
  size: { type: Number, default: 32 },
});

const x = ref(0);
const y = ref(0);
const frame = ref('mati3');
/**
 * 要不要真的渲染。
 * ⚠️ 2026-10-06 用户报：「猫消失后，我再往下滑，有时候会卡一个猫消失前的残影，
 *    停留很久」。这是**合成层残影**：元素是 position:fixed，原来还带
 *    will-change: transform —— 浏览器会把它单独提成一层，挪到画面外之后
 *    那一层的贴图不一定被回收，滚动时就留下旧像素。
 *    所以跑出去（OUT）之后改成 display:none：不渲染的东西不会留残影。
 */
const visible = ref(true);

/* ── 帧表 ── */
const WALK = {
  left: ['left1', 'left2'],
  right: ['right1', 'right2'],
  up: ['up1', 'up2'],
  down: ['down1', 'down2'],
  upleft: ['upleft1', 'upleft2'],
  upright: ['upright1', 'upright2'],
  dwleft: ['dwleft1', 'dwleft2'],
  dwright: ['dwright1', 'dwright2'],
};
const DIRS = Object.keys(WALK);
/** 转身帧按方向取（用**新**方向那组；斜向借左右两组） */
const TOGI = {
  left: ['ltogi1', 'ltogi2'],
  right: ['rtogi1', 'rtogi2'],
  up: ['utogi1', 'utogi2'],
  down: ['dtogi1', 'dtogi2'],
  upleft: ['ltogi1', 'ltogi2'],
  dwleft: ['ltogi1', 'ltogi2'],
  upright: ['rtogi1', 'rtogi2'],
  dwright: ['rtogi1', 'rtogi2'],
};
const SLEEP = ['sleep1', 'sleep2'];
const SCRATCH = ['kaki1', 'kaki2'];
const IDLE = ['mati3', 'mati2', 'mati3', 'mati2'];
const AWAKE = ['awake'];
const PLAY = ['jare2'];

/** 撞到某条边之后优先往这几个斜向走（都带横向分量，不会立刻又贴回去） */
const AWAY = {
  left: ['upleft', 'dwleft'],
  right: ['upright', 'dwright'],
  up: ['upleft', 'upright'],
  down: ['dwleft', 'dwright'],
};

/* ── 时长（毫秒）── */
const T_TURN = 260;
const T_AWAKE = 420;
const T_SCRATCH = 1100;   // 挠多久（1.1s → 2.6s → **还原到 1.1s**：用户先说太短、后来说还原）
const T_PLAY = 900;
/** 困了（挠头思考）多久才真正睡下 —— 2026-10-06 用户：「不要跑着跑着突然睡，
 *  加上挠头思考什么的再睡」。用 kaki 那两帧（抬爪的姿势），但放慢到 400ms/帧，
 *  跟"挠窗边"那个急促的挠（150ms/帧）区分开。 */
const T_DROWSY = 1800;
const SLEEP_AFTER = 14000;     // 指针静这么久就睡。曲线：4s → 9s → **14s**（走路拉到 4–9 秒之后，9 秒余量会让猫走半路就睡，看不到完整一趟）
const SCRATCH_COOLDOWN = 2500; // 两次挠之间至少隔这么久（5s → 2.5s → 4s → **还原到 2.5s**：4s 是为了"比 2.6s 的挠更长"才抬的，挠缩回 1.1s 后这个理由不成立了）
const FRAME_MS = 140;          // 走路每个帧播多久（步频）

let raf = 0;
let last = 0;
let acc = 0;
let t = 0;                 // 当前状态已持续多久
let state = 'DESCEND';
let stateUntil = Infinity; // 当前状态何时结束（Infinity = 一直）
let dir = 'down';
let nextDir = 'down';
let descendLeft = 0;
let pointer = { x: -1, y: -1, at: 0 };  // at = 指针最后一次动的时间（0 = 从没动过）
let lastScratch = -1e9;
let escapeDir = 'down';   // 正在往哪条边跑出去（跑回来时要认它）
/** 等导航稳定下来之后，到这个时刻才进场（0 = 没在等）。见 advance 里的防抖 */
let returnAt = 0;

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * 朝**最近的那条边**跑（用户：「猫距离手机的上下左右那边近就跑出去，也可以斜着跑」）。
 * 主方向 = 距离最小的那条边；另一个轴上如果也偏得厉害（离边不到 30%），
 * 就带上那个分量 —— 于是会斜着跑出去，看着更像"跑"而不是"平移"。
 */
function escapeDirFor() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cx = x.value + props.size / 2;
  const cy = y.value + props.size / 2;
  const d = { up: cy, down: H - cy, left: cx, right: W - cx };
  const main = Object.keys(d).sort((a, b) => d[a] - d[b])[0];
  const horiz = cx < W - cx ? 'left' : 'right';
  const vert = cy < H - cy ? 'up' : 'down';
  const vertical = main === 'up' || main === 'down';
  const otherNear = vertical ? Math.min(cx, W - cx) < W * 0.3 : Math.min(cy, H - cy) < H * 0.3;
  const v = vertical ? main : (otherNear ? vert : '');
  const h = vertical ? (otherNear ? horiz : '') : main;
  const KEY = {
    upleft: 'upleft', upright: 'upright',
    downleft: 'dwleft', downright: 'dwright',
    up: 'up', down: 'down', left: 'left', right: 'right',
  };
  return KEY[v + h] || main;
}

/** 整只（连身体）都出画面了吗 */
function isOutside() {
  const W = window.innerWidth;
  const H = window.innerHeight;
  return x.value + props.size <= 0 || x.value >= W || y.value + props.size <= 0 || y.value >= H;
}

/**
 * 导航/工具条是不是收起来了。**哪个先收都算** ——
 * 滚动的早期只有导航先收（工具条要滚过 144px），第一版只认工具条，
 * 那一段猫还留在屏幕上，用户就是那时候被打扰的。
 */
function barsGone() {
  const mh = document.querySelector('.masthead');
  const tb = document.querySelector('.toolbar');
  return Boolean(
    (mh && mh.classList.contains('masthead--up'))
    || (tb && tb.classList.contains('toolbar--up'))
  );
}

function bounds() {
  return {
    minX: 0,
    minY: 0,
    maxX: Math.max(0, window.innerWidth - props.size),
    maxY: Math.max(0, window.innerHeight - props.size),
  };
}


/** 按方向给速度；斜着走乘 √½，不然对角线更快 */
function speedOf(d) {
  const s = 1.15;
  const diag = Math.SQRT1_2 * s;
  switch (d) {
    case 'left': return [-s, 0];
    case 'right': return [s, 0];
    case 'up': return [0, -s];
    case 'down': return [0, s];
    case 'upleft': return [-diag, -diag];
    case 'upright': return [diag, -diag];
    case 'dwleft': return [-diag, diag];
    default: return [diag, diag];
  }
}

/** 跑回来时朝画面里跑 —— 就是把出去的方向反过来 */
function returnDir() {
  const back = {
    left: 'right', right: 'left', up: 'down', down: 'up',
    upleft: 'dwright', dwright: 'upleft', upright: 'dwleft', dwleft: 'upright',
  };
  return back[escapeDir] || 'down';
}

function pickDir() {
  return DIRS[Math.floor(Math.random() * DIRS.length)];
}

/** 进入某个状态；ms = 持续多久（Infinity = 一直） */
function go(next, ms, now) {
  visible.value = next !== 'OUT';   // OUT = 画面外，真的别渲染它
  state = next;
  stateUntil = ms === Infinity ? Infinity : now + ms;
  t = 0;
}

/** 从帧表里按已持续的时间取一帧 */
function frameOf(list, ms) {
  return list[Math.floor(t / ms) % list.length];
}

function onPointer(e) {
  const p = e.touches ? e.touches[0] : e;
  if (!p) return;
  const moved = Math.abs(p.clientX - pointer.x) + Math.abs(p.clientY - pointer.y) > 3;
  pointer.x = p.clientX;
  pointer.y = p.clientY;
  if (moved || !pointer.at) pointer.at = performance.now();
}

function onResize() {
  const b = bounds();
  x.value = clamp(x.value, b.minX, b.maxX);
  y.value = clamp(y.value, b.minY, b.maxY);
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  if (!last) last = now;
  const dt = Math.min(48, now - last);   // 切标签页回来时别一步跳很远
  last = now;
  acc += dt;
  if (acc < 16.7) return;
  const steps = Math.min(3, Math.floor(acc / 16.7));
  acc -= steps * 16.7;
  for (let i = 0; i < steps; i++) advance(now);
}

function advance(now) {
  const b = bounds();
  t += 16.7;

  // ⚠️ 从没动过指针（刚打开、手指还没碰屏幕）时算 **0**，不是 Infinity ——
  //    这一条是实测出来的：第一版用 Infinity，于是 `Infinity > SLEEP_AFTER` 恒真，
  //    猫**一进页面就睡死**，采样 45 秒 100% 在睡。手机上根本不碰鼠标，
  //    所以用户看到的会是一只从头睡到尾的猫。
  /* ── 导航收起 → 朝最近的边**跑出去**（不是瞬间消失）；放回来 → 从同一条边跑回来 ── */
  const gone = barsGone();
  if (gone && state !== 'ESCAPE' && state !== 'OUT') {
    escapeDir = escapeDirFor();
    go('ESCAPE', Infinity, now);
  }
  if (state === 'OUT') {
    if (gone) {
      // 又收回去了 → 取消等待。这就是防抖：用户反复上下滑，只会不停重置这个计时，
      // 猫一直待在画面外，不会跟着一进一出地闪。
      returnAt = 0;
    } else {
      // 导航放回来了：**先等一个随机时间再进场**（用户 2026-10-06：
      // 「猫等一个随机的时间再进场，因为用户如果反复上下滑，猫反复的出来消失很烦」）
      if (!returnAt) returnAt = now + 1500 + Math.random() * 3500;   // 1.5–5 秒
      if (now < returnAt) return;                                    // 还在等，就冻在画面外
      returnAt = 0;
      // 从它跑出去的那条边**外面一点**重新出现，再跑进来
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (escapeDir.includes('left')) x.value = -props.size - 4;
      else if (escapeDir.includes('right')) x.value = W + 4;
      if (escapeDir === 'up' || escapeDir === 'upleft' || escapeDir === 'upright') y.value = -props.size - 4;
      else if (escapeDir === 'down' || escapeDir === 'dwleft' || escapeDir === 'dwright') y.value = H + 4;
      if (x.value >= 0 && x.value <= W) x.value = Math.min(Math.max(x.value, 20), W - props.size - 20);
      if (y.value >= 0 && y.value <= H) y.value = Math.min(Math.max(y.value, 20), H - props.size - 20);
      go('RETURN', 2600, now);
    }
  }

  const idleFor = pointer.at ? now - pointer.at : 0;
  const over = now >= stateUntil;

  // 静够久 → **先挠头思考**（DROWSY），不是直接趴下
  if (state !== 'DESCEND' && state !== 'SLEEP' && state !== 'AWAKE'
      && state !== 'DROWSY' && idleFor > SLEEP_AFTER) {
    go('DROWSY', T_DROWSY, now);
  }
  // 挠完头才真的睡下
  if (state === 'DROWSY' && over) go('SLEEP', Infinity, now);
  // 睡着、或正困着的时候指针一动 → 醒（别让它"困到一半"还是睡下去）
  if ((state === 'SLEEP' || state === 'DROWSY') && idleFor < 200) go('AWAKE', T_AWAKE, now);

  switch (state) {
    case 'ESCAPE': {
      // 用走路的帧，但跑得更快（用户要"一定要是跑出去"）
      const [ex, ey] = speedOf(escapeDir);
      x.value += ex * 1.9;
      y.value += ey * 1.9;
      frame.value = frameOf(WALK[escapeDir] || WALK.down, FRAME_MS * 0.7);
      if (isOutside()) go('OUT', Infinity, now);   // 整只出去了才算完：这时才不渲染它
      return;
    }
    case 'OUT':
      // 已经在画面外：什么都不做，等导航放回来（连位置都冻着）
      return;
    case 'RETURN': {
      const [rx, ry] = speedOf(returnDir());
      x.value += rx * 1.9;
      y.value += ry * 1.9;
      frame.value = frameOf(WALK[returnDir()] || WALK.down, FRAME_MS * 0.7);
      if (over || (x.value > 0 && y.value > 0
          && x.value < window.innerWidth - props.size && y.value < window.innerHeight - props.size)) {
        dir = pickDir();
        go('WALK', 4000 + Math.random() * 5000, now);
      }
      return;
    }
    case 'DESCEND':
      y.value += 1.4;
      descendLeft -= 1.4;
      frame.value = frameOf(WALK.down, FRAME_MS);
      if (descendLeft <= 0) { dir = pickDir(); go('WALK', 4000 + Math.random() * 5000, now); }
      return;
    case 'DROWSY':
      // 挠头思考：慢速播那两帧抬爪的姿势
      frame.value = frameOf(SCRATCH, 400);
      return;
    case 'SLEEP':
      frame.value = frameOf(SLEEP, 900);
      return;
    case 'AWAKE':
      frame.value = AWAKE[0];
      if (over) { dir = pickDir(); go('WALK', 4000 + Math.random() * 5000, now); }
      return;
    case 'PLAY':
      frame.value = PLAY[0];
      if (over) go('WALK', 4000 + Math.random() * 5000, now);
      return;
    case 'SCRATCH':
      frame.value = frameOf(SCRATCH, 150);
      if (over) { dir = pickDir(); go('WALK', 4000 + Math.random() * 5000, now); }
      return;
    case 'TURN':
      frame.value = frameOf(TOGI[nextDir] || TOGI.down, T_TURN / 2);
      if (over) { dir = nextDir; go('WALK', 4000 + Math.random() * 5000, now); }
      return;
    case 'IDLE':
      frame.value = frameOf(IDLE, 520);
      // ⚠️ 换方向先转身。这是用户原话「要换方向时先播一下转身帧」——
      //    第一版只在**撞到边**时才转身，而方向其实每次待机结束都会换，
      //    所以转身那 8 帧几乎看不到（实测 25 秒采样一次都没抓到）。
      if (over) { nextDir = pickDir(); go('TURN', T_TURN, now); }
      return;
    default:
      break;
  }

  /* ── 这里只剩 WALK / CHASE ── */
  const chasing = idleFor < 2500 && pointer.at !== 0;
  if (chasing) {
    const cx = x.value + props.size / 2;
    const cy = y.value + props.size / 2;
    const dx = pointer.x - cx;
    const dy = pointer.y - cy;
    if (Math.hypot(dx, dy) > 22) {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      const near = props.size * 0.6;
      if (ax < near) dir = dy < 0 ? 'up' : 'down';
      else if (ay < near) dir = dx < 0 ? 'left' : 'right';
      else if (dx < 0) dir = dy < 0 ? 'upleft' : 'dwleft';
      else dir = dy < 0 ? 'upright' : 'dwright';
      if (state !== 'CHASE') go('CHASE', Infinity, now);
    } else {
      // 贴到指针旁边了：待机一会儿，别在指针上抖
      go('IDLE', 800 + Math.random() * 1200, now);
      return;
    }
  } else if (state === 'CHASE' || over) {
    // 指针静了 / 到时间了 → 偶尔玩一下，否则待机
    if (Math.random() < 0.25) go('PLAY', T_PLAY, now);
    // 待机 0.4–1.3s → **1.5–4s**（用户：「待机时间太短」）。
    // 它是每个循环里最容易被看到的一段（走完一轮就在这里），所以拉长它。
    else go('IDLE', 1500 + Math.random() * 2500, now);
    return;
  }

  /* ── 挪一步 ── */
  const [sx, sy] = speedOf(dir);
  const wantX = x.value + sx;
  const wantY = y.value + sy;
  const nx = clamp(wantX, b.minX, b.maxX);
  const ny = clamp(wantY, b.minY, b.maxY);
  const hitX = nx !== wantX;
  const hitY = ny !== wantY;
  x.value = nx;
  y.value = ny;

  /* 撞到边：有机会挠一会儿（有冷却），否则转身换向 */
  if (hitX || hitY) {
    const canScratch = !chasing && now - lastScratch > SCRATCH_COOLDOWN;
    if (canScratch && Math.random() < 0.7) {
      lastScratch = now;
      go('SCRATCH', T_SCRATCH, now);
      return;
    }
    const away = [];
    if (nx <= b.minX) away.push('right');
    if (nx >= b.maxX) away.push('left');
    if (ny <= b.minY) away.push('down');
    if (ny >= b.maxY) away.push('up');
    if (!away.length) away.push('left', 'right');
    const want = away[Math.floor(Math.random() * away.length)];
    const diag = AWAY[want] || [];
    nextDir = diag.length ? diag[Math.floor(Math.random() * diag.length)] : want;
    go('TURN', T_TURN, now);
    return;
  }

  frame.value = frameOf(WALK[dir] || WALK.down, FRAME_MS);
}

onMounted(() => {
  if (!NEKO_SPRITE) return;   // 精灵图没生成出来就干脆不出现
  // 出生位置**随机**（2026-10-06 用户：「每次打开这个网站，这个猫的位置随机刷新，
  // 不要老从右上角刷新出来」）。原来固定在报头右端 —— 那是"从导航栏下来"那版的设定，
  // 现在整屏随便跑，固定角落就成了每次都在同一个地方冒出来。
  const b = bounds();
  x.value = b.minX + Math.random() * (b.maxX - b.minX);
  y.value = b.minY + Math.random() * (b.maxY - b.minY);
  // 不再强制"先下来一段"：从哪儿出生就从哪儿开始走
  descendLeft = 0;
  state = 'WALK';
  stateUntil = 0;   // 0 = 立刻到期，第一帧就会去挑方向
  t = 0;
  pointer.at = 0;

  window.addEventListener('pointermove', onPointer, { passive: true });
  window.addEventListener('touchmove', onPointer, { passive: true });
  window.addEventListener('resize', onResize);
  raf = requestAnimationFrame(tick);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('pointermove', onPointer);
  window.removeEventListener('touchmove', onPointer);
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <i
    v-show="visible"
    class="neko"
    :style="{
      width: size + 'px',
      height: size + 'px',
      backgroundImage: NEKO_SPRITE,
      backgroundPosition: NEKO_FRAMES[frame],
      transform: 'translate3d(' + x + 'px,' + y + 'px,0)',
    }"
    aria-hidden="true"
  />
</template>
