/**
 * Neko 的精灵图与格子坐标 —— **由脚本从桌面的 wNeko 里读出来生成**，别手改。
 *
 * 出处（素材自带的 COPYRIGHT 全文就只有这一句，所以这里照抄一遍）：
 *   "oneko" is written by Tatsuya Kato, based on "xneko" written by Masayuki Koba.
 * 仓库：wNeko（github.com/kagurazakayashi），代码 MIT。
 *
 * 精灵图 376×104、32×32 一格、2px 起点、34px 间距 —— 坐标直接照抄 texture/neko2/neko2.css。
 * 转成 base64 内联是为了让报告保持单文件、不请求任何外部资源（gif 只有 3.4KB）。
 *
 * 一共 32 帧、17 组：
 *   待机 mati2 mati3（2）· 醒 awake（1）· 八方向行走 ×2 帧（16）
 *   转身 togi 四方向 ×2 帧（8）· 挠 kaki1 kaki2（2）· 玩 jare2（1）· 睡 sleep1 sleep2（2）
 * 现在只用了其中 8 帧（四正 + 四斜的行走）。其余三组（转身 / 挠 / 睡）是现成的，
 * 想加行为时直接取用 —— 见 Neko.vue 里的 WALK 表。
 * （第一版这里只有 24 帧：抄表时漏了 togi 那 8 帧，是用户问"有多少种"才发现的。）
 *
 * ⚠️ 元素尺寸要和精灵图**同比例**：默认 32px 是原尺寸、最清晰。
 *    改尺寸得连 background-size 和下面所有坐标一起按比例改（现在没做，所以别改）。
 */
export const NEKO_SPRITE = 'url("data:image/gif;base64,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")';

/** 格子的 background-position（已经是 CSS 能直接用的字符串） */
export const NEKO_FRAMES = {
  mati3: '-2px -2px',
  mati2: '-2px -36px',
  awake: '-342px -36px',
  left1: '-138px -70px',
  left2: '-138px -36px',
  right1: '-308px -2px',
  right2: '-104px -36px',
  up1: '-274px -36px',
  up2: '-274px -2px',
  down1: '-308px -70px',
  down2: '-206px -36px',
  upleft1: '-240px -70px',
  upleft2: '-240px -36px',
  upright1: '-240px -2px',
  upright2: '-206px -70px',
  dwleft1: '-172px -36px',
  dwleft2: '-308px -36px',
  dwright1: '-342px -2px',
  dwright2: '-172px -2px',
  ltogi1: '-138px -2px',
  ltogi2: '-104px -70px',
  rtogi1: '-104px -2px',
  rtogi2: '-274px -70px',
  utogi1: '-36px -36px',
  utogi2: '-36px -2px',
  dtogi1: '-206px -2px',
  dtogi2: '-172px -70px',
  sleep1: '-70px -2px',
  sleep2: '-36px -70px',
  kaki1: '-70px -70px',
  kaki2: '-70px -36px',
  jare2: '-2px -70px',
};
