/**
 * 校验 web/src 下所有 .vue 能不能编译。
 *
 * 为什么要单独跑这一步：迁移期间 .vue 是**写在旁边**的（`vite` 只认 main.jsx 引到的
 * 东西），所以 `npm run build` 根本不会碰它们 —— 写错了也一路绿灯，等到最后切换
 * 才现形。这个脚本用 @vue/compiler-sfc 逐个 parse + compileScript + compileTemplate，
 * 把语法错、模板里引用了不存在的变量这类问题提前抖出来。
 *
 *   node scripts/check-vue.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc';

const ROOT = 'web/src';
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.vue')) out.push(p);
  }
  return out;
}

const files = walk(ROOT);
let bad = 0;
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const id = f.replace(/[^a-z0-9]/gi, '_');
  const errs = [];
  try {
    const { descriptor, errors } = parse(src, { filename: f });
    for (const e of errors) errs.push('parse: ' + (e.message || e));
    if (!errors.length) {
      if (descriptor.scriptSetup || descriptor.script) {
        try { compileScript(descriptor, { id }); } catch (e) { errs.push('script: ' + e.message); }
      }
      if (descriptor.template) {
        const r = compileTemplate({
          source: descriptor.template.content,
          filename: f,
          id,
          compilerOptions: { bindingMetadata: {} },
        });
        for (const e of r.errors || []) errs.push('template: ' + (e.message || e));
      }
    }
  } catch (e) {
    errs.push('crash: ' + e.message);
  }
  if (errs.length) {
    bad++;
    console.log('  ❌ ' + f);
    for (const e of errs) console.log('       ' + String(e).slice(0, 160));
  } else {
    console.log('  ✅ ' + f);
  }
}
console.log('\n  ' + files.length + ' 个 .vue，坏了 ' + bad + ' 个');
process.exit(bad ? 1 : 0);
