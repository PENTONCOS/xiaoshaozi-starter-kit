#!/bin/zsh
# 妙记音频 → 本地转录 → 说话人聚类 → 声纹比对，一条龙
# 用法: ./run-voiceprint-pipeline.sh <audio> <workdir>
set -u
AUDIO="$1"
DIR="$2"
BASE="$(basename "$AUDIO")"; BASE="${BASE%.*}"
ASR_PY="$HOME/.local/venvs/asr/bin/python"
DIAR_PY="$HOME/.local/venvs/diar/bin/python"
ROOT="$(cd "$(dirname "$0")" && pwd)"
TRANSCRIBE="$HOME/.openclaw/agents/main/agent/workshop-skills/meeting-audio-transcription/scripts/transcribe.py"

mkdir -p "$DIR"
cd "$ROOT" || exit 1

log() { echo "[$(date +%H:%M:%S)] $*"; }

log "=== step 1/3 转录（faster-whisper medium） ==="
"$ASR_PY" -u "$TRANSCRIBE" "$AUDIO" \
  --out-txt "$DIR/$BASE.transcript.txt" \
  --out-json "$DIR/$BASE.transcript.json" \
  --model medium --language zh --threads 8
RC=$?
log "转录退出码 $RC"
[ $RC -ne 0 ] && { log "转录失败，终止"; exit $RC; }

log "=== step 2/3 说话人聚类（fewest-first） ==="
"$DIAR_PY" -u diarize.py "$AUDIO" \
  --transcript "$DIR/$BASE.transcript.json" \
  --json "$DIR/$BASE.diar.json" \
  --out-txt "$DIR/$BASE.speakers.txt" \
  --threads 8
RC=$?
log "聚类退出码 $RC"
[ $RC -ne 0 ] && { log "聚类失败，终止"; exit $RC; }

log "=== step 3/3 声纹比对 ==="
"$DIAR_PY" -u voiceprint.py identify "$AUDIO" --diar "$DIR/$BASE.diar.json" \
  > "$DIR/$BASE.identify.json" 2> "$DIR/$BASE.identify.err"
log "识别退出码 $?"
log "--- identify stderr ---"
cat "$DIR/$BASE.identify.err"

log "=== 完成 ==="
ls -lh "$DIR"
