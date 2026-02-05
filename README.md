# 我的 AI 助手

> 基于 [OpenClaw](https://openclaw.ai) 的 AI 私人助手配置

## 📁 文件结构

```
my-assistant/
├── AGENTS.md          # 助手的行为准则和工作流程
├── SOUL.md            # 灵魂文件：性格、语气、边界
├── USER.md            # 用户画像：让助手了解你
├── IDENTITY.md        # 身份设定：名字、形象、Vibe
├── HEARTBEAT.md       # 心跳检查项：助手定期自动执行
├── MEMORY.md          # 长期记忆：重要事件和经验
├── TOOLS.md           # 工具笔记：本地配置速查
├── TODO.md            # 任务清单
├── memory/            # 每日记忆文件
│   └── .gitkeep
├── content/           # 内容输出目录
│   └── .gitkeep
└── docs/
    └── SKILLS-GUIDE.md  # 推荐技能清单和安装指南
```

## 📁 文件结构

```
my-assistant/
├── AGENTS.md          # 助手的行为准则和工作流程
├── SOUL.md            # 灵魂文件：性格、语气、边界
├── USER.md            # 用户画像：让助手了解你
├── IDENTITY.md        # 身份设定：名字、形象、Vibe
├── HEARTBEAT.md       # 心跳检查项：助手定期自动执行
├── MEMORY.md          # 长期记忆：重要事件和经验
├── TOOLS.md           # 工具笔记：本地配置速查
├── TODO.md            # 任务清单
├── memory/            # 每日记忆文件
│   └── .gitkeep
├── content/           # 内容输出目录
│   └── .gitkeep
└── docs/
    └── SKILLS-GUIDE.md  # 推荐技能清单和安装指南
```

## 📚 文档说明

- **AGENTS.md** - 助手工作指南，包含文档体系和使用流程
- **SOUL.md** - 助手的性格、说话风格、行为准则
- **USER.md** - 用户信息和工作习惯
- **IDENTITY.md** - 助手的身份设定
- **MEMORY.md** - 长期记忆，重要事件和经验
- **TOOLS.md** - 工具配置和速查
- **docs/SKILLS-GUIDE.md** - 推荐技能安装指南

## 🔒 安全提醒

- ⚠️ 不要把 API Key 提交到 Git（使用 `.env` 或环境变量）
- ⚠️ 安装 Skill 前检查源码
- ⚠️ `clawdbot.json` 配置文件权限建议设为 `chmod 600`
- ⚠️ 定期检查和清理 `MEMORY.md` 中的敏感信息