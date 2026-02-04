#!/bin/bash

# 设置Google账户
export GOG_ACCOUNT="jpd515327098@gmail.com"

# 获取今天的日期范围
TODAY_START=$(date -u +"%Y-%m-%dT00:00:00Z")
TODAY_END=$(date -u +"%Y-%m-%dT23:59:59Z")

# 查询今天的日历事件
EVENTS=$(gog calendar events --from "$TODAY_START" --to "$TODAY_END" --json 2>/dev/null)

# 检查是否有事件
EVENT_COUNT=$(echo "$EVENTS" | jq 'length' 2>/dev/null)

if [ "$EVENT_COUNT" -gt 0 ]; then
  echo "早上好！您今天有 $EVENT_COUNT 个安排："
  echo "$EVENTS" | jq -r '.[] | "- \(.start.dateTime // .start.date) : \(.summary)"'
else
  echo "今天没有安排任何事件，祝您有美好的一天！"
fi