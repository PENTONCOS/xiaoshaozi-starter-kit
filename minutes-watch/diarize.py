#!/usr/bin/env python3
"""说话人分离（diarization）+ 逐字稿对齐。

流程:
  AUDIO (任意格式) --afconvert--> 16k mono wav
        --sherpa-onnx--> pyannote segmentation-3.0 切出语音段
                      --> 3D-Speaker campplus 逐段声纹 embedding
        --> 球面 k-means 扫 k=2..max-k，按「最小说话人占比」过滤后取 silhouette 最优
        --> 段落说话人标签
        --> 按时间重叠把 speaker 写回逐字稿

用法:
  diarize.py AUDIO [--transcript T.json] [--json OUT.json]
                   [--out-txt LABELED.txt] [--speakers N] [--max-k 8] [--min-share 0.15]

说明:
  - 不给 --speakers 时自动定人数
  - 自动结果不满意时用 --speakers 明确指定，最稳
  - 有 --transcript 时把 speaker 写回逐字稿 json，并生成可读的 [S0] 文本
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile
import wave

import numpy as np
import sherpa_onnx

MODEL_DIR = os.path.expanduser("~/.cache/diar")
SEG = os.path.join(MODEL_DIR, "sherpa-onnx-pyannote-segmentation-3-0", "model.onnx")
EMB = os.path.join(MODEL_DIR, "campplus.onnx")

PRESPLIT_CLUSTERS = 16  # 过度切分只为拿语音段边界，此处标签无意义
MIN_EMB_SEC = 0.4       # 短于此的片段不做声纹，最后按时间就近归并
MIN_SHARE = 0.15        # 最小说话人占比，低于此的 k 判为过切


def ensure_wav16k(path):
    """任意格式 -> 16k mono PCM16 wav。已是目标格式则原样返回。"""
    try:
        with wave.open(path, "rb") as w:
            if w.getnchannels() == 1 and w.getframerate() == 16000 and w.getsampwidth() == 2:
                return path
    except Exception:
        pass
    out = os.path.join(tempfile.gettempdir(), f"diar-{os.getpid()}-{abs(hash(path)) % 10**8}.wav")
    r = subprocess.run(["afconvert", "-f", "WAVE", "-d", "LEI16@16000", "-c", "1", path, out],
                       capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"afconvert 失败: {r.stderr.strip() or r.stdout.strip()}")
    return out


def read_wav16k(path):
    with wave.open(path, "rb") as w:
        assert w.getnchannels() == 1, f"需要单声道，实际 {w.getnchannels()}"
        assert w.getframerate() == 16000, f"需要 16k，实际 {w.getframerate()}"
        assert w.getsampwidth() == 2, f"需要 16bit，实际 {w.getsampwidth()*8}bit"
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def make_diar(threshold=0.5, num_threads=2, num_clusters=-1):
    cfg = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=SEG),
            num_threads=num_threads,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=EMB, num_threads=num_threads),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_clusters, threshold=threshold),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not cfg.validate():
        sys.exit("sherpa config 校验失败，检查模型路径")
    return sherpa_onnx.OfflineSpeakerDiarization(cfg)


def embed_segments(samples, segs, threads=2):
    """逐段声纹。返回 (归一化 embeddings, 对应段下标)。"""
    cfg = sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=EMB, num_threads=threads)
    ext = sherpa_onnx.SpeakerEmbeddingExtractor(cfg)
    embs, idx = [], []
    for i, s in enumerate(segs):
        a, b = int(s["start"] * 16000), int(s["end"] * 16000)
        if (b - a) / 16000 < MIN_EMB_SEC:
            continue
        st = ext.create_stream()
        st.accept_waveform(16000, samples[a:b])
        st.input_finished()
        v = np.asarray(ext.compute(st), dtype=np.float64)
        n = np.linalg.norm(v)
        if n <= 0:
            continue
        embs.append(v / n)
        idx.append(i)
    return np.asarray(embs), idx


def cosine_dist(E):
    return np.clip(1.0 - E @ E.T, 0.0, 2.0)


def spherical_kmeans(E, k, restarts=8, iters=200, seed=0):
    """归一化向量上做 k-means（欧氏距离 == 余弦距离）。比层次聚类抗离群点。"""
    rng = np.random.default_rng(seed)
    n = len(E)
    if k >= n:
        return np.arange(n)
    best = None
    for _ in range(restarts):
        c = [int(rng.integers(n))]
        d = np.clip(1 - E @ E[c[0]], 1e-9, None)
        for _ in range(k - 1):
            p = d / d.sum()
            c.append(int(rng.choice(n, p=p)))
            d = np.minimum(d, np.clip(1 - E @ E[c[-1]], 1e-9, None))
        C = E[c].copy()
        lab = None
        for _ in range(iters):
            lab = np.argmax(E @ C.T, axis=1)
            newC = C.copy()
            for j in range(k):
                m = lab == j
                if m.any():
                    v = E[m].mean(0)
                    nv = np.linalg.norm(v)
                    if nv > 0:
                        newC[j] = v / nv
            if np.array_equal(newC, C):
                break
            C = newC
        lab = np.argmax(E @ C.T, axis=1)
        inertia = float(np.sum(1.0 - np.einsum("ij,ij->i", E, C[lab])))
        if best is None or inertia < best[0]:
            best = (inertia, lab)
    return best[1]


def silhouette(D, labels):
    n = len(labels)
    uniq = sorted(set(labels.tolist()))
    if len(uniq) < 2:
        return -1.0
    members = [[j for j in range(n) if labels[j] == c] for c in range(len(uniq))]
    out = []
    for i in range(n):
        ci = labels[i]
        peers = [j for j in members[ci] if j != i]
        if not peers:
            continue
        a = float(np.mean(D[i, peers]))
        b = min(float(np.mean(D[i, members[c]])) for c in range(len(uniq)) if c != ci)
        out.append((b - a) / max(a, b) if max(a, b) > 0 else 0.0)
    return float(np.mean(out)) if out else -1.0


def auto_k(E, dur, kmin=2, kmax=8, min_share=MIN_SHARE):
    """扫 k，过滤掉过切解，取 silhouette 最优。返回 (k, labels, detail)。"""
    D = cosine_dist(E)
    total = float(dur.sum())
    detail, best = [], None
    kmax = min(kmax, len(E))
    for k in range(kmin, kmax + 1):
        lab = spherical_kmeans(E, k)
        shares = [float(dur[lab == c].sum() / total) for c in range(k)]
        sil = silhouette(D, lab)
        valid = min(shares) >= min_share
        detail.append({"k": k, "silhouette": round(sil, 4),
                       "minShare": round(min(shares), 4), "ok": valid})
        if valid and (best is None or sil > best[1]):
            best = (k, sil, lab)
    if best is None:  # 没有合格的多说话人解 -> 判为单人
        return 1, np.zeros(len(E), dtype=int), detail
    return best[0], best[2], detail


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("audio")
    ap.add_argument("--transcript", help="逐字稿 json，写回 speaker 字段")
    ap.add_argument("--json", help="diarization 结果 json")
    ap.add_argument("--out-txt", help="带说话人的可读逐字稿")
    ap.add_argument("--speakers", type=int, default=-1, help="人数；-1=自动")
    ap.add_argument("--max-k", type=int, default=8)
    ap.add_argument("--min-share", type=float, default=MIN_SHARE)
    ap.add_argument("--threads", type=int, default=2)
    a = ap.parse_args()

    wav = ensure_wav16k(a.audio)
    samples = read_wav16k(wav)
    dur_total = len(samples) / 16000
    print(f"audio {dur_total:.1f}s  source={os.path.basename(a.audio)}", flush=True)

    # 1) 过度切分，只为拿语音段边界
    raw = make_diar(num_threads=a.threads, num_clusters=PRESPLIT_CLUSTERS).process(samples).sort_by_start_time()
    segs = [{"start": round(s.start, 2), "end": round(s.end, 2)} for s in raw]
    print(f"segments {len(segs)}", flush=True)

    # 2) 逐段声纹
    E, idx = embed_segments(samples, segs, threads=a.threads)
    if len(E) == 0:
        sys.exit("没有可用于声纹的片段")
    dur = np.array([segs[i]["end"] - segs[i]["start"] for i in idx])
    print(f"embeddings {len(E)} (dim {E.shape[1]})", flush=True)

    # 3) 定人数 + 聚类
    if a.speakers and a.speakers > 0:
        k = a.speakers
        lab = spherical_kmeans(E, k)
        detail = [{"k": k, "silhouette": round(silhouette(cosine_dist(E), lab), 4),
                   "minShare": round(float(min(np.bincount(lab, weights=dur) / dur.sum())), 4), "ok": True}]
    else:
        k, lab, detail = auto_k(E, dur, kmax=a.max_k, min_share=a.min_share)
    sc = next((d["silhouette"] for d in detail if d["k"] == k), None)
    print(f"speakers {k}  silhouette={sc}  auto={'yes' if a.speakers <= 0 else 'no'}", flush=True)
    for d in detail:
        print(f"  k={d['k']} sil={d['silhouette']:+.3f} min={d['minShare']*100:4.1f}% {'ok' if d['ok'] else '--'}", flush=True)

    # 4) 标签铺回所有段：有 emb 的用聚类结果，太短的就近归并
    lab_by_seg = {seg_i: int(lab[p]) for p, seg_i in enumerate(idx)}
    labeled = []
    last = f"S{int(lab[0])}"
    for i, s in enumerate(segs):
        lb = f"S{lab_by_seg[i]}" if i in lab_by_seg else last
        if i in lab_by_seg:
            last = lb
        labeled.append({**s, "speaker": lb})

    # 按发言时长重排编号，S0 说得最多
    tot = {}
    for x in labeled:
        tot[x["speaker"]] = tot.get(x["speaker"], 0) + (x["end"] - x["start"])
    remap = {old: f"S{i}" for i, (old, _) in enumerate(sorted(tot.items(), key=lambda kv: -kv[1]))}
    for x in labeled:
        x["speaker"] = remap[x["speaker"]]
    spk = sorted({x["speaker"] for x in labeled})

    result = {"auto": a.speakers <= 0, "speakers": spk, "silhouette": sc,
              "kDetail": detail, "duration": round(dur_total, 2), "segments": labeled}
    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
        print("json:", a.json, flush=True)

    if not a.transcript:
        for x in labeled:
            print(f"[{x['start']:7.2f} -> {x['end']:7.2f}] {x['speaker']}")
        return

    with open(a.transcript, encoding="utf-8") as f:
        t = json.load(f)
    items = t.get("segments") or t.get("items") or []
    for it in items:
        st, en = float(it["start"]), float(it["end"])
        best_lb, best_ov = None, 0.0
        for x in labeled:
            ov = min(en, x["end"]) - max(st, x["start"])
            if ov > best_ov:
                best_ov, best_lb = ov, x["speaker"]
        it["speaker"] = best_lb or "S?"
    t["segments"] = items
    t["diarization"] = {"speakers": spk, "auto": a.speakers <= 0,
                        "silhouette": sc, "segments": labeled}

    if a.json:
        with open(a.json.replace(".json", ".aligned.json"), "w", encoding="utf-8") as f:
            json.dump(t, f, ensure_ascii=False, indent=2)

    # 合并连续同一说话人，便于阅读
    lines, cur = [], None
    for it in items:
        txt = (it.get("text") or "").strip()
        if not txt:
            continue
        if cur and cur["speaker"] == it["speaker"]:
            cur["text"] += txt
            cur["end"] = it["end"]
        else:
            cur = {"speaker": it["speaker"], "start": it["start"], "end": it["end"], "text": txt}
            lines.append(cur)

    if a.out_txt:
        with open(a.out_txt, "w", encoding="utf-8") as f:
            f.write(f"# 说话人分离逐字稿  ({dur_total/60:.1f} 分钟, {len(spk)} 人, "
                    f"{'自动' if a.speakers <= 0 else '指定'}定人数)\n\n")
            for l in lines:
                mm, ss = divmod(int(l["start"]), 60)
                f.write(f"[{mm:02d}:{ss:02d}] {l['speaker']}: {l['text']}\n")
        print("out-txt:", a.out_txt, flush=True)

    for l in lines:
        print(f"[{l['start']:7.2f}] {l['speaker']}: {l['text'][:80]}")


if __name__ == "__main__":
    main()
