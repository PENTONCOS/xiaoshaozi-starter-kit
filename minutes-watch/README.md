# minutes-watch

飞书妙记 / 本地录音 → 会议纪要 → 推群 + 归档。

## 归档策略（2026-10-19 定案）

**只放本地，不上飞书云文档。** 后续如有额外需求再改（云端需要 `docx:document` + `drive:drive`，当前 bot 无文档类权限）。

位置：`~/sisyphus-output/meetings/archive/YYYY-MM/<YYYYMMDD>-<slug>/`

每场会议固定包含：

| 文件 | 内容 |
|---|---|
| `*.data.md` | 结构化纪要（主文件，带表格） |
| `*.data.json` | 结构化数据源，渲染的输入 |
| `*.data.card.json` | 群里那张飞书卡片的快照 |
| `*.transcript.txt` / `.json` | 逐字稿（纯文本 / 带时间戳） |
| `*.artifacts.json` | 妙记原始 AI 产物 |
| `meta.json` | 日期、标题、归档时间、文件清单 |

索引：`archive/INDEX.md`，按日期倒序，含可点击的纪要链接。

## 命令

```bash
# 渲染 + 推送 + 自动归档
node render-minutes.mjs <data.json> --send <chat_id>

# 只渲染（同样自动归档）
node render-minutes.mjs <data.json>

# 渲染但不归档（调试用）
node render-minutes.mjs <data.json> --no-archive

# 批量补归档历史 + 重建索引
node archive.mjs --all

# 只重建索引
node archive.mjs --index
```

归档行为：`render-minutes.mjs` 在推送成功后自动调用 `archive.mjs`，把该会议全部产物移进归档目录并重建索引。**推送失败则不归档**，产物留在 `meetings/` 原地，避免"归档了但没发出去"。

## 渲染

- `lib/render.mjs` — 同一份数据渲染两种产物：`toMarkdown()` 存档用标准表格，`toCard()` 飞书卡片用 `lark_md` + `<text_tag>`（卡片不支持表格）
- 卡片结构：元信息 → 关键词 → caveat → 一句话结论 → ✅ 决议 → 📌 待办 → 🗂 议题讨论 → ⚠️ 风险与未决 → 🧭 解读 → note 页脚
- 卡片体积上限 `CARD_LIMIT = 26000`，超限从尾部删减议题细节
