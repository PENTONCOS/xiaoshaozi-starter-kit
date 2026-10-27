#!/bin/zsh
# 会议音频过期清理：默认 30 天，--dry 只打印
set -u
A="$HOME/sisyphus-output/meetings/audio"
DAYS="${DAYS:-30}"
LOG="$HOME/.openclaw/logs/audio-gc.log"
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
mkdir -p "$(dirname "$LOG")"
[ -d "$A" ] || { echo "$(date '+%F %T') 目录不存在，跳过: $A" >> "$LOG"; exit 0; }
n=0; freed=0
while IFS= read -r f; do
  sz=$(stat -f%z "$f")
  if [ $DRY -eq 1 ]; then
    echo "[dry] 将删除 $f ($((sz/1048576)) MB)"
  else
    rm -f "$f"; n=$((n+1)); freed=$((freed+sz))
    echo "$(date '+%F %T') 删除 $f ($((sz/1048576)) MB)" >> "$LOG"
  fi
done < <(find "$A" -type f \( -name '*.m4a' -o -name '*.wav' -o -name '*.mp3' -o -name '*.mp4' \) -mtime +$DAYS 2>/dev/null)
[ $DRY -eq 1 ] && { echo "[dry] 完成，未删除"; exit 0; }
# 清掉空目录
find "$A" -mindepth 1 -type d -empty -delete 2>/dev/null
echo "$(date '+%F %T') 完成: 删除 $n 个文件，释放 $((freed/1048576)) MB (阈值 ${DAYS} 天)" >> "$LOG"
