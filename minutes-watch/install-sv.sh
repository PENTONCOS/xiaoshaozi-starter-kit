#!/bin/zsh
set -u
V="$HOME/.local/venvs/sv"
IDX="https://pypi.tuna.tsinghua.edu.cn/simple"
echo "[$(date +%H:%M:%S)] venv 已存在，直接装依赖"
"$V/bin/pip" install --upgrade pip -i "$IDX" -q 2>&1 | tail -2
echo "[$(date +%H:%M:%S)] numpy<2 + soundfile"
"$V/bin/pip" install -i "$IDX" -q "numpy<2" soundfile 2>&1 | tail -3
echo "[$(date +%H:%M:%S)] torch 2.2.2 / torchaudio 2.2.2（Intel mac 最后可用版）"
"$V/bin/pip" install -i "$IDX" -q torch==2.2.2 torchaudio==2.2.2 2>&1 | tail -3
echo "[$(date +%H:%M:%S)] modelscope"
"$V/bin/pip" install -i "$IDX" -q modelscope 2>&1 | tail -3
echo "[$(date +%H:%M:%S)] 版本核对"
"$V/bin/python" - <<'PY'
import torch, numpy, modelscope
print("torch", torch.__version__, "| numpy", numpy.__version__, "| modelscope", modelscope.__version__)
print("threads", torch.get_num_threads())
try:
    import soundfile; print("soundfile ok")
except Exception as e: print("soundfile 缺失", e)
PY
echo "=== 完成 ==="
