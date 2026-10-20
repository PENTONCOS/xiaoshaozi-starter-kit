#!/bin/zsh
set -u
W="$1"
DIAR_PY="$HOME/.local/venvs/diar/bin/python"
cd ~/my-assistant/minutes-watch || exit 1
echo "[$(date +%H:%M:%S)] step2 聚类 输入: $W/audio16k.wav"
"$DIAR_PY" -u diarize.py "$W/audio16k.wav" \
  --transcript "$W/20261019-alicloud-kb-memory.transcript.json" \
  --json "$W/20261019-alicloud-kb-memory.diar.json" \
  --out-txt "$W/20261019-alicloud-kb-memory.speakers.txt" \
  --threads 8
RC=$?
echo "[$(date +%H:%M:%S)] 聚类退出码 $RC"
[ $RC -ne 0 ] && exit $RC
echo "[$(date +%H:%M:%S)] step3 声纹比对"
"$DIAR_PY" -u voiceprint.py identify "$W/audio16k.wav" --diar "$W/20261019-alicloud-kb-memory.diar.json" > "$W/20261019-alicloud-kb-memory.identify.json" 2> "$W/20261019-alicloud-kb-memory.identify.err"
echo "[$(date +%H:%M:%S)] 识别退出码 $?"
echo "=== 完成 ==="
