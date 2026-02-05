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
        
        # 停止当前网关
        echo "正在重启OpenClaw网关..."
        openclaw gateway restart
        
        if [ $? -eq 0 ]; then
            echo "OpenClaw网关已成功重启"
        else
            echo "警告：网关重启失败，请手动重启"
        fi
    else
        echo "升级失败"
    fi
else
    echo "已经是最新版本，无需升级"
fi