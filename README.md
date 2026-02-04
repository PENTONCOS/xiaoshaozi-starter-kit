# OpenClaw 工作目录

这是 OpenClaw 的主要工作目录，包含所有配置、脚本和数据文件。

## 目录结构

```
my-assistant/
├── config/           # 配置文件
│   ├── AGENTS.md     # 代理配置
│   ├── BOOTSTRAP.md  # 启动配置
│   ├── HEARTBEAT.md  # 心跳配置
│   ├── IDENTITY.md   # 身份信息
│   ├── SOUL.md       # 人格设定
│   ├── TOOLS.md      # 工具配置
│   └── USER.md       # 用户信息
├── scripts/          # 脚本文件
│   ├── calendar_*.js    # 日历相关脚本
│   ├── check_*.sh       # 检查脚本
│   └── start_*.sh       # 启动脚本
├── calendar/         # 日历功能相关
│   ├── CALENDAR_*.md    # 日历功能说明
│   └── calendar_event_config.json # 日历事件配置
├── docs/             # 文档
│   └── TODO.md       # 待办事项
├── memory/           # 记忆文件
│   └── *.md          # 按日期分隔的记忆文件
├── skills/           # 技能文件
└── README.md         # 本文件
```

## 主要文件

- `MEMORY.md` - 长期记忆文件
- `.gitignore` - Git忽略规则

## 功能模块

### 日历提醒系统
位于 `scripts/` 和 `calendar/` 目录中，实现了智能日历检查和提醒功能。