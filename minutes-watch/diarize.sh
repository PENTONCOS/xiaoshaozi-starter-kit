#!/bin/zsh
# 说话人分离统一入口：把「音频 → 带 speaker 的逐字稿」这一步固定下来。
# 用法:
#   ./diarize.sh <audio> [--speakers N] [--transcript <t.json>] [--dir <outdir>] [--base <name>]
#   ./diarize.sh --from-artifacts <artifacts.json> [--dir <outdir>] [--base <name>]
#
# 无音频、只有妙记时用 --from-artifacts（直接读妙记自带 Speaker 标签）。
# 产物（默认与 transcript 同目录，文件名前缀 <base>）:
#   <base>.speakers.txt            人读版逐字稿（[mm:ss] S0: …）
#   <base>.diar.json               原始分段 + 声纹聚类结果
#   <base>.transcript.aligned.json 逐字稿 + 每段 speaker（仅本地音频路线产出）
set -e
cd "$(dirname "$0")"

PY=~/.local/venvs/diar/bin/python
[ -x "$PY" ] || { echo "缺少 diar 环境，先跑 ./diar-setup.sh" >&2; exit 1; }

MODE=audio
if [ "$1" = "--from-artifacts" ]; then MODE=artifacts; shift; fi
SRC="$1"; shift || true

[ -n "$SRC" ] || { echo "用法: ./diarize.sh <audio|--from-artifacts artifacts.json> [opts]" >&2; exit 1; }
SRC="${SRC/#\~/$HOME}"

# 解析 --dir / --base，其余参数透传给 diarize.py
DIR=""; BASE=""; PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --base) BASE="$2"; shift 2 ;;
    *) PASS+=("$1"); shift ;;
  esac
done

if [ -z "$DIR" ]; then DIR="$(dirname "$SRC")"; fi
DIR="${DIR/#\~/$HOME}"
mkdir -p "$DIR"

if [ -z "$BASE" ]; then
  B="$(basename "$SRC")"
  BASE="${B%.*}"
  # 去掉上传时的 UUID 尾巴，保留可读主题
  BASE="${BASE%%---*}"
fi

if [ "$MODE" = artifacts ]; then
  OUT="$DIR/${BASE}.diar.json"
  "$PY" diarize.py --from-artifacts "$SRC" --out-txt "$DIR/${BASE}.speakers.txt" "${PASS[@]}" \
    | tee "$DIR/${BASE}.diar.log"
  exit 0
fi

T="${DIR}/${BASE}.transcript.json"
for p in "${PASS[@]}"; do [ "$p" = "--transcript" ] && T="next"; done
ARGS=("$SRC" --json "$DIR/${BASE}.diar.json" --out-txt "$DIR/${BASE}.speakers.txt")
[ -f "$T" ] && ARGS+=(--transcript "$T")
"$PY" diarize.py "${ARGS[@]}" "${PASS[@]}" | tee "$DIR/${BASE}.diar.log"

echo
echo "产出:"
ls -la "$DIR/${BASE}.speakers.txt" "$DIR/${BASE}.diar.json" 2>/dev/null || true
[ -f "$DIR/${BASE}.transcript.aligned.json" ] && ls -la "$DIR/${BASE}.transcript.aligned.json"
echo "OK"
