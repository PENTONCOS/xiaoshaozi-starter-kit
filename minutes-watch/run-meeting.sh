#!/bin/zsh
# 一条龙：源音频 → 转录 → 聚类 → 声纹 → 保留源音频 30 天
# 用法: ./run-meeting.sh <源音频> <slug> [--speakers N] [--dry]
set -u
SRC="$1"; SLUG="$2"; shift 2
SPK=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --speakers) SPK="$2"; shift 2;;
    --dry) DRY=1; shift;;
    *) shift;;
  esac
done
D="$HOME/sisyphus-output/meetings/$SLUG"
WAV="$D/$SLUG.wav"
ASR_PY="$HOME/.local/venvs/asr/bin/python"
echo "[$(date +%H:%M:%S)] 准备 $SLUG"
echo "  源: $SRC"
echo "  工作目录: $D"
echo "  强制人数: ${SPK:-自动}"
if [ $DRY -eq 1 ]; then
  echo "[dry] 步骤: 转 wav → 转录+聚类+声纹 → audio-keep 保留源文件 → 删中间 wav"
  exit 0
fi
mkdir -p "$D"
"$ASR_PY" - "$SRC" "$WAV" <<'PY'
import av,wave,sys,time
src,out=sys.argv[1],sys.argv[2]
t0=time.time(); c=av.open(src); st=c.streams.audio[0]
res=av.AudioResampler(format='s16',layout='mono',rate=16000); n=0
with wave.open(out,'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(16000)
    for fr in c.decode(st):
        for rf in res.resample(fr):
            b=rf.to_ndarray().tobytes(); w.writeframes(b); n+=len(b)
print(f"wav ok: {n/2/16000:.1f}s {n/1048576:.1f}MB {time.time()-t0:.1f}s")
PY
RC=$?; [ $RC -ne 0 ] && { echo "转 wav 失败"; exit $RC; }

EXTRA=""
[ -n "$SPK" ] && EXTRA="--speakers $SPK"
./run-voiceprint-pipeline.sh "$WAV" "$D" $EXTRA
RC=$?
[ $RC -ne 0 ] && { echo "流水线失败($RC)，源音频保留未动: $SRC"; exit $RC; }

echo "[$(date +%H:%M:%S)] 保留源音频 30 天"
./audio-keep.sh "$SRC" "$SLUG"
echo "[$(date +%H:%M:%S)] 删中间 wav"
rm -f "$WAV"
echo "=== 完成 ==="
