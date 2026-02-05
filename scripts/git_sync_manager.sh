#!/bin/bash

# Git Sync Daily - 每天 12:00 执行一次同步

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="/Users/cospeyton/my-assistant"
LOG_DIR="$REPO_DIR/logs"
PLIST_NAME="com.opencalw.git-sync-daily.plist"
PLIST_SRC="$SCRIPT_DIR/$PLIST_NAME"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_NAME"
LABEL="com.opencalw.git-sync-daily"
OLD_LABEL="com.opencalw.git-sync-listener"

mkdir -p "$LOG_DIR"

case "$1" in
    start)
        echo "启用 Git 每日同步（每天 12:00）..."
        if [[ ! -f "$PLIST_SRC" ]]; then
            echo "错误: 未找到 $PLIST_SRC"
            exit 1
        fi
        cp "$PLIST_SRC" "$PLIST_DEST"
        launchctl unload "$PLIST_DEST" 2>/dev/null || true
        launchctl unload "$HOME/Library/LaunchAgents/$OLD_LABEL.plist" 2>/dev/null || true
        if launchctl load "$PLIST_DEST"; then
            echo "已启用。下次同步时间：今天 12:00。"
        else
            echo "启用失败"
            exit 1
        fi
        ;;
    stop)
        echo "停止 Git 每日同步..."
        launchctl unload "$HOME/Library/LaunchAgents/$OLD_LABEL.plist" 2>/dev/null || true
        if launchctl unload "$PLIST_DEST" 2>/dev/null; then
            echo "已停止"
        else
            echo "未在运行或已停止"
        fi
        ;;
    restart)
        $0 stop
        sleep 1
        $0 start
        ;;
    status)
        if launchctl list | grep -q "$LABEL"; then
            echo "Git 每日同步已启用（每天 12:00 执行）"
        else
            echo "Git 每日同步未运行"
        fi
        ;;
    logs)
        echo "最近输出:"
        tail -n 50 "$LOG_DIR/git_sync_daily.stdout.log" 2>/dev/null || echo "暂无 stdout 日志"
        echo "--- stderr ---"
        tail -n 50 "$LOG_DIR/git_sync_daily.stderr.log" 2>/dev/null || echo "暂无 stderr 日志"
        ;;
    *)
        echo "用法: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac
