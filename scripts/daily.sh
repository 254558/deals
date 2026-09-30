#!/bin/bash
#
# 每天一次：抓价 → 生成两份报告 → 推到 Cloudflare → 备份价格库 → 该提醒就提醒。
#
# 注：**每天定时跑这件事已经搬到 GitHub Actions 了**（.github/workflows/daily.yml）——
# 本机那套只在「Mac 开着、你还登录着」时才跑，出差一周就断档；而且 runner 是临时的，
# 价格库因此进了版本管理，git 历史本身就是带版本的异地备份。
# 这个脚本保留下来，用于「我现在就想跑一轮」，以及万一想退回本机定时
# （install-launchd.sh 还在，两条路都守同一条规矩：先拉库、跑完把库提交回去）。
#
# 想立刻手动跑一次：
#     bash ~/deals/scripts/daily.sh
#
# 每一步为什么在：
#   sync    抓价写库。上市价就是靠这个一天一天攒出来的，漏一天少一天。
#           只写数据库、不碰报告，所以下一步必须跟着。
#   report  生成 reports/<站点>/index.html（本地那份）
#   deploy  把 reports/ 整个目录推到 Cloudflare Pages，线上跟着当天更新。
#           这一步内部会把两份报告**再生成一遍**（交叉入口要改成同域相对路径），
#           所以 report 那步可以理解成「保证本地一定有一份」——deploy 若在上传阶段
#           失败，本地报告照样是新的，不会两头空。
#   backup  这个项目里**只有价格库不可再生**（图片字体 HTML 都能重新抓），
#           而它开着 WAL，直接 cp 不安全，所以交给 `deals backup`（内部是 VACUUM INTO），
#           有 iCloud 就同时写一份到机器之外
#   alert   盯着的商品降价了、或者数据断档了（>36h 没抓成功）就弹系统通知；
#           任何一步失败也弹一条——不然任务挂了只会静静地写在日志里，没人会去看
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
  [ "$(uname)" = "Darwin" ] && osascript -e 'display notification "找不到 node" with title "deals 每日任务没跑起来"'
  exit 1
fi

mkdir -p logs
LOG="$ROOT/logs/daily.log"

# 价格库现在**由 GitHub Actions 每天更新并提交回仓库**（见 .github/workflows/daily.yml）。
# 本机这套是「想立刻跑一轮」时用的备用路径，所以得守同一条规矩：
# 先把仓库拉下来（免得拿旧库抓完再推时打架），跑完再把库提交回去。
# 不这么做的话，本机抓到的快照只留在本机，下一次 CI 跑起来会用它自己那份库覆盖线上。
if [ -d .git ] && git remote get-url origin >/dev/null 2>&1; then
  echo "[$(date '+%F %T')] 先从仓库拉一次（价格库由 CI 维护）"
  git pull --rebase --autostash --quiet || echo "  拉取失败：本地继续跑，跑完的库留给你手动处理"
fi

{
  echo "======================== $(date '+%F %T') ========================"
  echo "node $("$NODE" -v)　仓库 $ROOT"

  "$NODE" src/cli.mjs all sync
  sync_rc=$?

  "$NODE" src/cli.mjs all report --no-open
  report_rc=$?

  # 线上也更新（一个 Pages 项目装两份，与对哪个站点做无关）。
  # 日常只改两个 HTML，素材已在 Cloudflare 上，check-missing 只补变化的文件，几秒钟。
  "$NODE" src/cli.mjs all deploy --target cloudflare
  deploy_rc=$?

  "$NODE" src/cli.mjs backup
  backup_rc=$?

  # 把这次抓到的历史提交回仓库——它才是「库的主人」。没变化就不提交。
  if [ -d .git ]; then
    git add data/deals.db
    if git diff --cached --quiet; then
      echo "价格库没有变化，不提交"
    else
      git -c user.name="deals bot" -c user.email="deals-bot@users.noreply.github.com" \
        commit -q -m "价格快照 $(date '+%Y-%m-%d')（本机手动跑）" && \
        git push -q && echo "价格库已提交并推送" || echo "提交/推送失败（数据仍在本地库里）"
    fi
  fi

  echo "sync 退出码 ${sync_rc}　report 退出码 ${report_rc}　deploy 退出码 ${deploy_rc}　backup 退出码 $backup_rc"
} >>"$LOG" 2>&1

# 出问题要出声。抓取返回 0 件也算出问题——接口改了、被拦了，都会表现为「一件都没抓到」，
# 而这时候报告仍然是「成功生成」的，静悄悄地就没数据了。
if [ "$sync_rc" -ne 0 ] || [ "$report_rc" -ne 0 ] || [ "$deploy_rc" -ne 0 ] || [ "$backup_rc" -ne 0 ]; then
  if [ "$(uname)" = "Darwin" ]; then
    osascript -e "display notification \"sync=$sync_rc report=$report_rc deploy=$deploy_rc backup=${backup_rc}，详见 logs/daily.log\" with title \"deals 每日任务失败\""
  fi
fi

# 降价 / 数据断档的提醒（判定逻辑在 deals alert 里，不在这里解析文本）
"$NODE" src/cli.mjs alert >/dev/null 2>&1

# 给 launchd 的 stdout 留一行短的，方便 `log show` 或者看 launchd.out.log
echo "[$(date '+%F %T')] deals 每日任务结束（sync=$sync_rc report=$report_rc deploy=$deploy_rc backup=${backup_rc}，详情见 logs/daily.log）"
exit $(( sync_rc || report_rc || deploy_rc || backup_rc ))
