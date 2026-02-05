# Git 每日同步

## 功能
每天 **21:00** 执行一次 `scripts/git-sync.sh`，有改动则 add + commit + push 到 `origin main`。

## 管理命令
- 启用：`./scripts/git_sync_manager.sh start`
- 停止：`./scripts/git_sync_manager.sh stop`
- 重启：`./scripts/git_sync_manager.sh restart`
- 状态：`./scripts/git_sync_manager.sh status`
- 日志：`./scripts/git_sync_manager.sh logs`

## 实现
- 使用 launchd 的 `StartCalendarInterval`，每天 21:00 触发一次。
- 首次执行 `start` 时会从项目复制 `scripts/com.opencalw.git-sync-daily.plist` 到 `~/Library/LaunchAgents/` 并 load；若之前装过「监听器」版本，会先 unload 旧服务。

## 日志位置
- 标准输出：`logs/git_sync_daily.stdout.log`
- 错误输出：`logs/git_sync_daily.stderr.log`
