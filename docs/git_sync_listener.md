# Git Sync Listener

## 功能描述
这个后台监听器用于监听系统事件"运行 /Users/cospeyton/my-assistant/scripts/git-sync.sh 脚本来同步Git仓库"，当检测到此事件时，会自动执行 `/Users/cospeyton/my-assistant/scripts/git_sync_handler.js` 脚本。

## 工作原理
1. 监听 `/Users/cospeyton/my-assistant` 目录下的文件变化
2. 监控 `git-sync.sh` 脚本的执行（通过检查进程列表和文件修改时间）
3. 当检测到 `git-sync.sh` 被执行或修改时，自动运行 `git_sync_handler.js` 处理脚本

## 管理命令
- 启动监听器：`./scripts/git_sync_manager.sh start`
- 停止监听器：`./scripts/git_sync_manager.sh stop`
- 重启监听器：`./scripts/git_sync_manager.sh restart`
- 查看状态：`./scripts/git_sync_manager.sh status`
- 查看日志：`./scripts/git_sync_manager.sh logs`

## 日志位置
- 主要日志：`/Users/cospeyton/my-assistant/logs/git_sync_listener.log`
- 标准输出：`/Users/cospeyton/my-assistant/logs/git_sync_listener.stdout.log`
- 错误输出：`/Users/cospeyton/my-assistant/logs/git_sync_listener.stderr.log`

## 技术实现
- 使用 macOS launchd 服务管理后台进程
- 使用 Node.js fs.watch 监听文件系统变化
- 定期检查系统进程列表以检测脚本执行
- 文件修改时间监控作为辅助检测手段