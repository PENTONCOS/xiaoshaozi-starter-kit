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
| `*.speakers.txt` | 说话人分离逐字稿（`[mm:ss] S0: …`） |
| `*.transcript.aligned.json` | 逐字稿 + 每段 speaker |
| `*.diar.json` | 说话人分离原始结果（分段 + 声纹聚类） |
| `*.artifacts.json` | 妙记原始 AI 产物 |
| `meta.json` | 日期、标题、归档时间、文件清单 |

索引：`archive/INDEX.md`，按日期倒序，含可点击的纪要链接。

## 说话人分离（diarization）

本地运行，纯 CPU、离线、不需要 HF token：sherpa-onnx + pyannote 分段 + 3D-Speaker campplus 声纹。模型在 `~/.cache/diar/`（约 34MB），venv 在 `~/.local/venvs/diar/`。

```bash
# 本地录音（任意格式，内部用 afconvert 转 16k mono）
python diarize.py <audio> \
  --transcript <base>.transcript.json \
  --json <base>.diar.json \
  --out-txt <base>.speakers.txt \
  [--speakers N]          # 不填=自动定人数

# 只有妙记、没有音频：直接用妙记自带的 Speaker 标签
python diarize.py --from-artifacts <base>.artifacts.json --out-txt <base>.speakers.txt
```

判定人数的方式：球面 k-means 扫 `k=2..8`，先按「最小说话人占比」(默认 15%) 过滤过切解，再取 silhouette 最优。

注意：
- 自动定人数对会议录音够用，但不保证；不满意就 `--speakers N`，最稳
- 只能给 `S0/S1/S2`，认不出真名（要认名字还得单独做声纹注册）
- 抢话、重叠语音会判给主导那一方
- 妙记路线不需要音频，但它自己的标签也会过切（阿里云那场 59 分钟标了 7 人）

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
