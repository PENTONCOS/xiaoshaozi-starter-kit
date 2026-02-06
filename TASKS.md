# 每日中国独立开发者报告任务

## 目的
生成每日报告，总结中国独立开发者社区（https://github.com/1c7/chinese-independent-developer）的最新动态。

## 执行时间
每天上午 8:00（上海时间）

## 脚本位置
/Users/cospeyton/my-assistant/scripts/github_daily_report.sh

## 输出位置
/Users/cospeyton/Desktop/daily-briefs/YYYY-MM-DD_chinese-indie-dev-report.md

## 手动运行方式
```bash
cd /Users/cospeyton/my-assistant
./scripts/github_daily_report.sh
```

## 注意事项
- 脚本会优雅处理 API 速率限制和网络问题
- 即使无法获取数据时也会生成报告（附带说明）
- 每个报告的文件名包含当前日期
