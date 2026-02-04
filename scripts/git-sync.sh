#!/bin/bash

# 自动同步脚本 - 将更改提交到Git仓库

cd /Users/cospeyton/my-assistant

# 检查是否有更改
if [[ -n $(git status --porcelain) ]]; then
    echo "检测到更改，正在同步到Git..."
    
    # 添加所有更改
    git add .
    
    # 提交更改
    git commit -m "自动同步: $(date '+%Y-%m-%d %H:%M:%S')"
    
    # 推送到远程仓库
    git push origin main
    
    echo "同步完成"
else
    echo "没有更改需要同步"
fi