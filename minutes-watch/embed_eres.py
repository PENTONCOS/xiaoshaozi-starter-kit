#!/usr/bin/env python3
"""ERes2Net 声纹提取桥：供 diar venv 调用（本脚本必须用 sv venv 跑）
用法: embed_eres.py <wav16k> --diar <diar.json> --out <out.npz>
输出：每簇每段的 512 维向量（键 = S0/S1/...），以及段起止时间（键 = S0_t ...）
"""
import os, sys, json, argparse, numpy as np, torch, soundfile as sf
from torchaudio.compliance import kaldi
sys.path.insert(0, os.path.expanduser('~/.local/venvs/sv/lib/python3.9/site-packages'))
from modelscope.models.audio.sv.ERes2Net import ERes2Net

CK = os.path.expanduser('~/.cache/sv/eres2net_base.ckpt')
torch.set_num_threads(int(os.environ.get('SV_THREADS', '4')))

ap = argparse.ArgumentParser()
ap.add_argument('wav'); ap.add_argument('--diar', required=True); ap.add_argument('--out', required=True)
ap.add_argument('--min-sec', type=float, default=0.6)
a = ap.parse_args()

m = ERes2Net(embed_dim=512, m_channels=32)
m.load_state_dict(torch.load(CK, map_location='cpu'), strict=True)
m.eval()

def emb(w):
    t = torch.from_numpy(w).float().unsqueeze(0)
    f = kaldi.fbank(t, num_mel_bins=80, sample_frequency=16000)
    f = f - f.mean(dim=0, keepdim=True)
    with torch.no_grad():
        e = m(f.unsqueeze(0))
    v = e.squeeze(0).numpy()
    return v / (np.linalg.norm(v) + 1e-9)

wav, sr = sf.read(a.wav, dtype='float32')
assert sr == 16000, f'需要 16k 单声道，实际 {sr}'
d = json.load(open(a.diar, encoding='utf8'))
by = {}
for s in d.get('segments') or []:
    by.setdefault(s['speaker'], []).append(s)

out = {}
for spk, ss in sorted(by.items()):
    vs, ts = [], []
    for s in sorted(ss, key=lambda x: x['start']):
        if s['end'] - s['start'] < a.min_sec:
            continue
        vs.append(emb(wav[int(s['start']*sr):int(s['end']*sr)]))
        ts.append([s['start'], s['end']])
    if vs:
        out[spk] = np.stack(vs)
        out[spk + '_t'] = np.array(ts, dtype=np.float32)
np.savez(a.out, **out)
print(json.dumps({k: len(v) for k, v in out.items() if not k.endswith('_t')}, ensure_ascii=False))
