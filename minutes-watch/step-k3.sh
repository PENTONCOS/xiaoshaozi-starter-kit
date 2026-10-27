#!/bin/zsh
set -u
D="$1"
DIAR_PY="$HOME/.local/venvs/diar/bin/python"
cd ~/my-assistant/minutes-watch || exit 1
echo "[$(date +%H:%M:%S)] 强制 3 人聚类"
"$DIAR_PY" -u diarize.py "$D/k3.wav" \
  --transcript "$D/20261027-rec-6422e5e8.transcript.json" \
  --json "$D/20261027-rec-6422e5e8.k3.diar.json" \
  --out-txt "$D/20261027-rec-6422e5e8.k3.speakers.txt" \
  --speakers 3 --threads 8
RC=$?
echo "[$(date +%H:%M:%S)] 聚类退出码 $RC"
[ $RC -ne 0 ] && exit $RC
echo "[$(date +%H:%M:%S)] 声纹比对（忽略旧 speaker-map）"
"$DIAR_PY" -u voiceprint.py identify "$D/k3.wav" --diar "$D/20261027-rec-6422e5e8.k3.diar.json" --no-map \
  > "$D/20261027-rec-6422e5e8.k3.identify.json" 2> "$D/20261027-rec-6422e5e8.k3.identify.err"
echo "[$(date +%H:%M:%S)] 识别退出码 $?"
cat "$D/20261027-rec-6422e5e8.k3.identify.err"
echo "=== 完成 ==="
