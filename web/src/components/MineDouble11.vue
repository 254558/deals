<script setup>
/**
 * 「我的 → 双十一指南」：一页照着做就行的双十一行动清单，**每天随报告重新生成**。
 *
 * 用户 2026-10-12 先要了这块 tab（「许愿后面再加一个 tab 页：双十一指南」），
 * 同一天又提了更高一层的要求：「我希望你能每天抓一些信息生成报告，如果抓不到，
 * 就写清楚让用户自己手动去查……用户一点到这个页面，看一下教程，就明白怎么买最划算了」。
 * 内容是两截拼起来的，页面上标出各自的成色：
 *
 *   ① **领取入口**：生成报告时逐个探测过官网能不能打开，这里按结果挂徽标 ——
 *      「今天可达」/「今天没抓到，点这里自己去查」/「本次没探测」。
 *      ⚠️ 探测只说明**页面能打开**，不代表券还在发（见下面那句「以官方页为准」：
 *      平台会拿 200 回一个验证页，所以别把可达读成"券还在"）。
 *   ② **领券的说法 · 凑单规则**：人工整理，在 `content/double11.json` 里维护
 *      （**不在这个组件里**，改内容不用动代码）。所以页脚要标「人工整理 · 更新于 X」。
 *      页顶还有一条置顶说明（`GUIDE.reference.headline`），讲的是"官方口径还没公布、
 *      以官方页为准" —— ⚠️ 那句里的"官方公布之后换成准确版"是**人工改 JSON**，
 *      不是这边自动抓来的（理由见 core/guide.mjs 文件头那段实测：平台的券页抓不到），
 *      所以文案只能写成「会换成准确版 / 以官方页为准」，不能写成"抓到了就准"。
 *
 * ── 用户当天连着删过三轮，删过什么、为什么有些字段还留着 ──────────────
 * 原话一：「删掉一、今天实况随报告每天更新 / 二、时间表：记住 3 个点就够」
 * 原话二（列了要删的文字）：导语、那句「下一个节点」、整节「往年经验」、
 *   整节「三个别踩的坑」、以及结尾那句总结。删完这一页就剩两块：领券、凑单。
 *
 * ⚠️ 删的是**页面上的展示**，`content/double11.json` 里那份内容一个字都没删
 * （`intro` / `schedule` / `timeNotes` / `reference.items` / `reference.note` /
 * `pitfalls` / `summary` 都还在，payload 里也还带着）。理由：那些字是用户自己写的、
 * 别处没有副本，留着随时能摆回页面；要彻底删（连 payload 里也不带）得另说。
 * 别再照着 payload 里的字段去页面里找对应的段落 —— 现在页面上没有。
 *
 * ── 几个容易写错的地方 ──────────────────────────────────────────────
 * · **内容层坏了不该把页面搞没**。JSON 读不到 / 写坏了，后端返回 `guide: null`
 *   （见 core/guide.mjs 的 loadContent），这里给一块逐条都能照做的兜底，
 *   而不是留一个空白页。
 * · **置顶那条说明得跟着窗口过期一起消失**（用 `!expired` 卡着）：双十一都过完半个月了，
 *   顶上还在说"官方口径还没公布"，比不说还糟。
 * · **`now` 那口钟现在只为「窗口过期了没」服务**（倒计时那两节删了之后就没有倒计时了）。
 *   留着 30 秒一跳：页面跨过 expiresAt 那一天还开着的话，那条 ⚠️ 会自己冒出来。
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { GUIDE } from '../lib/site.js';

/**
 * 读者这儿的「现在」。只给 `expired` 用，30 秒一跳就够了 ——
 * 要判的是一件"以天为单位"的事，跳太勤只是白烧电。
 */
const now = ref(Date.now());
let tick = null;
onMounted(() => {
  now.value = Date.now();
  tick = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
});
onBeforeUnmount(() => {
  if (tick) clearInterval(tick);
});

/* ── 窗口过期了没 ──────────────────────────────────────────────── */

/**
 * `expiresAt` 是「到这一天为止」，所以那天当天还算数 —— JSON 里是 `2026-11-13`
 * 这种纯日期，`new Date()` 按 UTC 零点解析，加一天再比就正好。
 *
 * 单独抽成一份是因为有两处要用它：页顶那条 ⚠️，和「官方还没公布」那句置顶说明
 * —— 窗口都过完了还在说"还没公布"，是自相矛盾。
 */
const expired = computed(() => {
  const exp = GUIDE?.expiresAt;
  if (!exp) return false;
  const end = new Date(exp).getTime() + 86_400_000;
  return Number.isFinite(end) && now.value >= end;
});

/** 页顶那条提示：这份指南盯的双十一窗口过完了，里面的券档位和玩法都不作数了 */
const warnings = computed(() =>
  expired.value
    ? [`⚠️ 这份指南针对的双十一窗口（到 ${GUIDE.expiresAt}）已经过去了，券档位和每年的玩法都可能变了样，看个思路就行。`]
    : []
);

/* ── 领取入口的三种成色 ────────────────────────────────────────── */

/**
 * 徽标文案。三种情况分开说，别混成一句「可能可用」：
 *   null  —— 这一趟生成时没联网探测（`--no-probe` / `deals dev`），不是失败；
 *   ok    —— HTTP 打通了（**不代表券还在发**）；
 *   !ok   —— 探测了但没打通（超时 / WAF 拦 / DNS）。
 */
function srcBadge(s) {
  if (!s.url) return { k: 'none', t: '自己去 APP 里找' };
  if (!s.probe) return { k: 'skip', t: '本次没探测' };
  if (s.probe.ok) return { k: 'ok', t: '今天可达' };
  return { k: 'bad', t: '今天没抓到，点这里自己去查' };
}

/** 鼠标停在徽标上能看出「打到了哪个页面 / 为什么没打通」 */
function probeTitle(s) {
  if (!s.probe) return '';
  if (s.probe.ok) return `HTTP ${s.probe.status}${s.probe.title ? `　${s.probe.title}` : ''}`;
  return s.probe.error ? `没打通：${s.probe.error}` : `HTTP ${s.probe.status}`;
}

/** 这份报告是什么时候生成的（页脚要标「机器探的那部分是哪一刻的」） */
const genText = computed(() => (GUIDE?.generatedAt ? new Date(GUIDE.generatedAt).toLocaleString('zh-CN') : '—'));
</script>

<template>
  <div class="mine__pane mine__guide">
    <!-- 置顶说明：官方口径还没出来，这一页整体是「参考版」。单独一条、用 --ref 的样子，
         和下面那条 ⚠️（窗口过了）区分开 —— 那条是"出问题了"，这条是"本来就只能这样"，
         别让人误以为哪里坏了。 -->
    <p v-if="!expired && GUIDE?.reference?.headline" class="mine__gbar mine__gbar--ref">{{ GUIDE.reference.headline }}</p>

    <!-- 窗口过期：这份东西可能不准了 -->
    <p v-for="w in warnings" :key="w" class="mine__gbar">{{ w }}</p>

    <!-- 人工整理的那份内容没读到时的兜底：逐条都能照做，不留下一个空白页 -->
    <section v-if="!GUIDE" class="mine__gsec">
      <h3 class="mine__gh">一、双十一怎么买（这次没能自动生成，照这三条走）</h3>
      <p class="mine__glead">报告里那份人工整理的双十一内容这次没读到（生成时已经跳过，不影响榜单本身）。要买的话，按下面三条自己来：</p>
      <ol class="mine__glist">
        <li><b>几号开始</b>：双十一就是「10 月中下旬开始、11 月 11 日收尾」，预售、开门红、巅峰场各有各的整点。具体的几点，以淘宝 / 天猫 / 京东 APP 首页那个双十一会场里写的时间为准 —— 每年都变。</li>
        <li><b>券在哪领</b>：平台红包就在同一个会场页里领（每天能领一次）；店铺券在你真想买的那家店首页领。微信群和短视频里那些「内部口令」一律别信。</li>
        <li><b>怎么凑最省</b>：把折后价凑到 300 的整数倍（跨店每满 300 减 50，上不封顶）。叠加顺序别反：官方立减 → 店铺券 → 跨店满减 → 会员折扣 → 平台红包。</li>
      </ol>
    </section>

    <template v-else>
      <section class="mine__gsec">
        <h3 class="mine__gh">
          一、优惠券在哪领（按优先级，从省事到费劲）
          <span v-if="GUIDE.probedAt" class="mine__gtag">入口可达性：生成报告时探测</span>
          <span v-else class="mine__gtag">本次生成没联网探测</span>
        </h3>
        <ol class="mine__glist">
          <li v-for="s in GUIDE.sources" :key="s.name">
            <b>{{ s.name }}</b>：{{ s.how }}
            <span class="mine__gbadges">
              <span class="mine__gbadge" :class="`mine__gbadge--${srcBadge(s).k}`" :title="probeTitle(s)">{{ srcBadge(s).t }}</span>
              <a v-if="s.url" class="mine__glink" :href="s.url" target="_blank" rel="noreferrer">{{ s.url.replace(/^https?:\/\//, '') }}</a>
            </span>
          </li>
        </ol>
        <p class="mine__gnote-sm">
          徽标只说明这个入口页今天能不能打开，不代表券还在发、也不代表面额没变 —— 平台会拿一个验证页顶掉
          HTTP 200，谁也没法从外面验。券的档位以你点进去看到的为准。
        </p>
      </section>

      <section class="mine__gsec">
        <h3 class="mine__gh">二、怎么凑满减：一条公式 + 三个品类打法</h3>
        <p v-if="GUIDE.formula" class="mine__gformula"><b>核心公式</b>：{{ GUIDE.formula }}</p>
        <ul v-if="GUIDE.formulaTips.length" class="mine__gnotes">
          <li v-for="t in GUIDE.formulaTips" :key="t">{{ t }}</li>
        </ul>
        <p v-if="GUIDE.stackOrder.length" class="mine__gstack">
          <span class="mine__gstack-lab">叠加顺序</span>
          <template v-for="(s, i) in GUIDE.stackOrder" :key="s">
            <span class="mine__gstack-i">{{ s }}</span><span v-if="i < GUIDE.stackOrder.length - 1" class="mine__gstack-arrow">→</span>
          </template>
        </p>
        <p v-if="GUIDE.stackNote" class="mine__gnote-sm">{{ GUIDE.stackNote }}</p>
        <dl v-if="GUIDE.byCategory.length" class="mine__gdl">
          <template v-for="c in GUIDE.byCategory" :key="c.t">
            <dt>{{ c.t }}</dt>
            <dd>{{ c.d }}</dd>
          </template>
        </dl>
      </section>

      <p class="mine__gfoot">
        上面领券入口和凑单这两块是人工整理的，更新于 {{ GUIDE.updatedAt }}，有效期到 {{ GUIDE.expiresAt || '—' }}；官方随时会改档期和面额，以官方页为准。<template
          v-if="GUIDE.probedAt"
        >那排入口徽标是这份报告生成时（{{ genText }}）机器探的。</template><template v-else>入口可达性这次没探测。</template>
      </p>
    </template>
  </div>
</template>
