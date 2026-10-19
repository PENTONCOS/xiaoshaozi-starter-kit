set -e
V=~/.local/venvs/diar
echo "== python =="; which python3; python3 -V
[ -d "$V" ] || python3 -m venv "$V"
"$V/bin/pip" install -q --upgrade pip
"$V/bin/pip" install -q sherpa-onnx
"$V/bin/python" -c "import sherpa_onnx; print('sherpa-onnx', sherpa_onnx.__version__ if hasattr(sherpa_onnx,'__version__') else 'ok')"
M=~/.cache/diar
mkdir -p "$M" && cd "$M"
[ -f sherpa-onnx-pyannote-segmentation-3-0/model.onnx ] || {
  curl -sL -o seg.tar.bz2 https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2
  tar xjf seg.tar.bz2
}
[ -f 3dspeaker.onnx ] || curl -sL -o 3dspeaker.onnx https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx
ls -la "$M"
echo SETUP_OK
