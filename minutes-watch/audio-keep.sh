#!/bin/zsh
# 会议源音频入库保留：audio-keep.sh <源音频> <slug>
# 只存源文件（可重新转录/重算声纹）；中间 16k wav 仍需当场删掉，几秒可重建。
set -u
SRC="$1"; SLUG="$2"
A="$HOME/sisyphus-output/meetings/audio"
[ -f "$SRC" ] || { echo "源文件不存在: $SRC"; exit 2; }
mkdir -p "$A"; chmod 700 "$A"
D="$A/$SLUG"; mkdir -p "$D"; chmod 700 "$D"
EXT="${SRC##*.}"
DST="$D/source.$EXT"
mv -f "$SRC" "$DST"
chmod 600 "$DST"
echo "保留: $DST ($(du -h "$DST" | cut -f1))"
