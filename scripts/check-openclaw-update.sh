#!/bin/bash

# 自动检查并升级OpenClaw脚本

echo "正在检查OpenClaw版本..."

# 获取当前版本
CURRENT_VERSION=$(npm list -g openclaw --depth=0 2>/dev/null | grep openclaw | sed 's/.*@//')

# 获取最新版本
LATEST_VERSION=$(npm view openclaw version)

echo "当前版本: $CURRENT_VERSION"
echo "最新版本: $LATEST_VERSION"

if [ "$CURRENT_VERSION" != "$LATEST_VERSION" ]; then
    echo "发现新版本，开始升级..."
    
    # 升级OpenClaw
    npm install -g openclaw@$LATEST_VERSION
    
    # 检查升级是否成功
    if [ $? -eq 0 ]; then
        echo "OpenClaw已升级到 $LATEST_VERSION"
        
        # 更新配置以启用重启
        CONFIG_FILE="$HOME/.openclaw/openclaw.json"
        if [ -f "$CONFIG_FILE" ]; then
            # 备份原配置
            cp "$CONFIG_FILE" "$CONFIG_FILE.backup"
            
            # 使用jq更新配置（如果系统有jq）或使用sed
            if command -v jq &> /dev/null; then
                jq '.commands.restart = true' "$CONFIG_FILE" > "$CONFIG_FILE.tmp" && mv "$CONFIG_FILE.tmp" "$CONFIG_FILE"
            else
                # 如果没有jq，使用node来更新JSON
                node -e "
                    const fs = require('fs');
                    const config = JSON.parse(fs.readFileSync('$CONFIG_FILE', 'utf8'));
                    if (!config.commands) config.commands = {};
                    config.commands.restart = true;
                    fs.writeFileSync('$CONFIG_FILE', JSON.stringify(config, null, 2));
                "
            fi
        fi
        
        # 停止当前网关
        echo "正在重启OpenClaw网关..."
        openclaw gateway restart
        
        if [ $? -eq 0 ]; then
            echo "OpenClaw网关已成功重启"
        else
            echo "警告：网关重启失败，尝试直接重启命令"
            # 如果重启命令失败，尝试其他方式
            pkill -f openclaw || true
            sleep 2
            # 启动新实例
            nohup openclaw gateway > /dev/null 2>&1 &
        fi
    else
        echo "升级失败"
    fi
else
    echo "已经是最新版本，无需升级"
fi