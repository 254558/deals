/**
 * 终端输出小工具：颜色、按显示宽度补位、通用表格。
 *
 * 合并前两个仓库各有一份一模一样的 `C` / `width` / `pad` / `truncate`
 * （连正则都逐字相同），只有 `printTable` 的表头与列宽不同 —— 所以这里把
 * 工具留下、把表格变成**由站点描述符声明列**：cli.mjs 只管拿列定义来画，
 * 表格的列（优衣库有月销）全在 src/sites/*.mjs 的
 * `tableColumns` 里。
 */

export const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

/** 中文字符占两个终端宽度，按显示宽度做补位对齐 */
export const width = (s) =>
  [...String(s)].reduce(
    (a, c) =>
      a +
      (/[\u1100-\u115f\u2e80-\ua4cf\ua960-\ua97f\uac00-\ud7ff\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/.test(c)
        ? 2
        : 1),
    0
  );

export const pad = (s, n, right = false) => {
  const str = String(s ?? '');
  const gap = ' '.repeat(Math.max(0, n - width(str)));
  return right ? gap + str : str + gap;
};

export const truncate = (s, n) => {
  const str = String(s ?? '');
  let w = 0,
    out = '';
  for (const c of str) {
    w += width(c);
    if (w > n - 1) return out + '…';
    out += c;
  }
  return out;
};

/**
 * 画一张表。
 *
 * @param {Array<{head:string, w:number, align?:'l'|'r', get:(row:object)=>any, trunc?:boolean}>} columns
 *   站点描述符里的列定义。`w` 是显示宽度，`trunc` 让这一列按宽度截断加省略号。
 * @param {object[]} rows
 */
export function printTable(columns, rows) {
  if (rows.length === 0) {
    console.log(C.dim('  没有符合条件的商品。'));
    return;
  }

  const align = (v, c) => (c.align === 'r' ? pad(v, c.w, true) : pad(v, c.w));

  console.log(C.dim(columns.map((c) => align(c.head, c)).join('  ')));
  console.log(C.dim('─'.repeat(columns.reduce((a, c) => a + c.w + 2, 0))));

  for (const r of rows) {
    const cells = columns.map((c) => {
      let v = c.get(r);
      v = v === undefined || v === null ? '' : String(v);
      if (c.trunc) v = truncate(v, c.w);
      return align(v, c);
    });
    console.log(cells.join('  '));
  }
}
