#!/bin/bash
#
# 装（或卸）每天 09:00 的那条 launchd 任务。
#
#     bash scripts/install-launchd.sh              # 安装并加载，每天 09:00 跑一次
#     bash scripts/install-launchd.sh --hour 21    # 想换个点
#     bash scripts/install-launchd.sh --uninstall  # 卸掉
#
# 为什么用 launchd 而不是 crontab：
#  1. 笔记本 9 点多半在睡。cron 错过就直接跳过；launchd 的 StartCalendarInterval
#     会在唤醒后补跑一次。
#  2. crontab 在这台机器上根本读不到项目 —— `~/Desktop` 受 macOS 的 TCC 保护，
#     cron 跑起来是 `ls: .: Operation not permitted`（实测）。除非给 /usr/sbin/cron
#     开「完全磁盘访问权限」，否则 cron 方案不成立。项目现在在 ~/deals，不在保护
#     目录里，launchd 直接就能读写。
#
# plist 是现生成的：仓库路径、node 路径、用户名都取当前机器的，所以这份脚本
# 换台机器、或者仓库换个目录都能直接用。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.$(whoami).deals.daily"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
HOUR=9
MINUTE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --hour) HOUR="$2"; shift 2 ;;
    --minute) MINUTE="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "用法：bash scripts/install-launchd.sh [--hour 9] [--minute 0] [--uninstall]"; exit 1 ;;
  esac
done

if [ -n "${UNINSTALL:-}" ]; then
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "已卸载 $LABEL（plist 也删了）"
  exit 0
fi

# node 在哪：优先 PATH，其次这台机器实际的安装位置
NODE="$(command -v node 2>/dev/null || true)"
for c in "$HOME/.local/bin/node" /opt/homebrew/bin/node /usr/local/bin/node; do
  [ -n "$NODE" ] && break
  [ -x "$c" ] && NODE="$c"
done
[ -n "$NODE" ] || { echo "找不到 node，先装 Node 22+ 再回来"; exit 1; }
NODEDIR="$(dirname "$NODE")"

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs"
chmod +x "$ROOT/scripts/daily.sh"

cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$ROOT/scripts/daily.sh</string>
  </array>

  <!-- launchd 给的 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，node 不在里面 -->
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$NODEDIR:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>

  <key>WorkingDirectory</key>
  <string>$ROOT</string>
  <key>StandardOutPath</key>
  <string>$ROOT/logs/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$ROOT/logs/launchd.err.log</string>

  <!-- 加载时不要立刻跑一次；错过的时间点由 launchd 在唤醒后补跑 -->
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
PLIST_EOF

# 先卸掉旧的（改过时间的话），再装
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl enable "gui/$(id -u)/$LABEL"

echo "已装载：$LABEL"
echo "  时间   每天 $(printf '%02d:%02d' "$HOUR" "$MINUTE")（睡过头会在唤醒后补跑）"
echo "  脚本   $ROOT/scripts/daily.sh"
echo "  node   $NODE"
echo "  plist  $PLIST"
echo "  日志   $ROOT/logs/daily.log"
echo
echo "想立刻试跑一次：launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "看状态：        launchctl print gui/$(id -u)/$LABEL | head -20"
