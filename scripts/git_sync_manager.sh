#!/bin/bash

# Git Sync Listener Management Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="/Users/cospeyton/my-assistant"
LOG_DIR="$REPO_DIR/logs"

# 确保日志目录存在
mkdir -p "$LOG_DIR"

case "$1" in
    start)
        echo "Starting Git Sync Listener..."
        
        # 加载 launchd 服务
        if launchctl load ~/Library/LaunchAgents/com.opencalw.git-sync-listener.plist; then
            echo "Git Sync Listener started successfully!"
        else
            echo "Failed to start Git Sync Listener"
            exit 1
        fi
        ;;
    stop)
        echo "Stopping Git Sync Listener..."
        
        # 卸载 launchd 服务
        if launchctl unload ~/Library/LaunchAgents/com.opencalw.git-sync-listener.plist; then
            echo "Git Sync Listener stopped successfully!"
        else
            echo "Failed to stop Git Sync Listener"
            exit 1
        fi
        ;;
    restart)
        echo "Restarting Git Sync Listener..."
        $0 stop
        sleep 2
        $0 start
        ;;
    status)
        if launchctl list | grep -q "com.opencalw.git-sync-listener"; then
            echo "Git Sync Listener is running"
        else
            echo "Git Sync Listener is not running"
        fi
        ;;
    logs)
        echo "Showing Git Sync Listener logs:"
        tail -f "$LOG_DIR/git_sync_listener.log" 2>/dev/null || echo "No logs found yet."
        ;;
    *)
        echo "Usage: $0 {start|stop|restart|status|logs}"
        exit 1
        ;;
esac