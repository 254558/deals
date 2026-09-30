#!/bin/bash
#
# 每天抓一次价、生成两份报告。由 launchd 在 09:00 调起（安装见 scripts/install-launchd.sh）。
#
# 想立刻手动跑一次：
#     bash ~/deals/scripts/daily.sh
#
# 为什么不只跑 sync：sync 只写数据库，报告是另一个文件。两份都做，第二天打开
# reports/<站点>/index.html 才是当天的。
#
# 这份脚本**不假设仓库在哪**：目录由脚本自身的位置推出来，所以仓库搬家、
# 改目录名都不用动它。node 也是现找的（launchd 给的 PATH 里没有 node）。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || { echo "进不去仓库目录：$ROOT"; exit 1; }

# 依次找 node：PATH 里的 → ~/.local/bin（这台机器的 node 就装在这儿）
# → Homebrew → nvm 里版本号最新的那个。
NODE="$(command -v node 2>/dev/null || true)"
for c in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -n "$NODE" ] && break
  [ -x "$c" ] && NODE="$c"
done
if [ -z "$NODE" ]; then
  NODE="$(ls -1 "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1)"
fi
if [ -z "$NODE" ] || [ ! -x "$NODE" ]; then
  echo "[$(date '+%F %T')] 找不到 node，什么都不做"
  exit 1
fi

mkdir -p logs
LOG="$ROOT/logs/daily.log"

{
  echo "======================== $(date '+%F %T') ========================"
  echo "node $("$NODE" -v)　仓库 $ROOT"

  "$NODE" src/cli.mjs all sync
  sync_rc=$?

  "$NODE" src/cli.mjs all report --no-open
  report_rc=$?

  echo "sync 退出码 $sync_rc　report 退出码 $report_rc"
} >>"$LOG" 2>&1

# 给 launchd 的 stdout 留一行短的，方便 `log show` 或者看 launchd.out.log
echo "[$(date '+%F %T')] deals 每日任务结束（sync=$sync_rc report=$report_rc，详情见 logs/daily.log）"
exit $(( sync_rc || report_rc ))
