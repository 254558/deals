/**
 * CSS 语法自检：注释必须成对、花括号必须配平。
 *
 * 为什么要这个测试 —— 2026-10-06 踩的坑：
 *   我用「按索引切整个字符串」改 styles.css 时切错了位置，把**整份文件顶部**
 *   复制进了中间（380 行），同时把一条注释的**结尾符号**弄丢了。
 *   后果非常隐蔽：
 *     · 花括号数量仍然是配平的（副本自带配平）；
 *     · 注释开头和结尾的**数量也配平**（一个多出来的结尾，正好抵消一个没闭合的开头）；
 *     · 构建照常成功（PostCSS 能从垃圾里恢复）；
 *     · 站点看起来正常（副本里重复的 @import 被忽略、:root 令牌重复定义无害）；
 *   唯一坏掉的是**被那段注释吞掉的那一条规则**（`.card__now .now__sym`）——
 *   价格前面那个图标的 display / vertical-align / margin 全不生效，
 *   而且是**线上才看得出来、本地怎么看都正常**（探针每次都是全新的浏览器配置）。
 *
 *   教训：光数「注释开头和结尾的数量是否相等」是不够的 —— 一个多出来的结尾，
 *   正好能抵消一个没闭合的开头。所以这里做的是**逐行扫描深度**：
 *   深度永远不能为负，扫完必须回到 0。
 *
 * （写这个文件时我又连着踩了两次同一个坑：注释里**字面**写出了注释的起止符号，
 *   于是注释在那一行就提前结束，后面全被当成代码。结论：注释里不要出现那两个
 *   字符的字面写法 —— 要用就写成"注释开头/注释结尾"这样的话。）
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const dir = new URL('../web/src/', import.meta.url).pathname;
const files = readdirSync(dir).filter((n) => n.endsWith('.css'));

test('web/src 下能找到 CSS 文件', () => {
  assert.ok(files.length > 0, 'web/src 下应该至少有一个 .css');
});

for (const f of files) {
  test(f + ' 的注释成对、花括号配平', () => {
    const src = readFileSync(join(dir, f), 'utf8');
    const lines = src.split('\n');

    // 逐行扫描注释深度：负 = 出现了没开过的结尾，收尾不为 0 = 有开头没闭合
    let depth = 0;
    const orphanClose = [];
    const openedAt = [];
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\/\*|\*\//g)) {
        if (m[0] === '/*') {
          depth++;
          openedAt.push(i + 1);
        } else {
          depth--;
          if (depth < 0) {
            orphanClose.push(i + 1);
            depth = 0;
          } else {
            openedAt.pop();
          }
        }
      }
    });

    assert.deepEqual(orphanClose, [], f + ' 这些行有多出来的注释结尾：' + orphanClose.join(', '));
    assert.deepEqual(openedAt, [], f + ' 这些行的注释开头没闭合：' + openedAt.join(', '));

    // 花括号（去掉注释后再数，避免注释里的括号干扰）
    const noComment = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const open = (noComment.match(/\{/g) || []).length;
    const close = (noComment.match(/\}/g) || []).length;
    assert.equal(open, close, f + ' 花括号不配平：左 ' + open + ' 个，右 ' + close + ' 个');
  });
}
