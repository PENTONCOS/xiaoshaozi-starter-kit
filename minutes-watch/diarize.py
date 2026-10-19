#!/usr/bin/env python3
"""说话人分离：sherpa-onnx（pyannote segmentation + 3D-Speaker embedding）+ 与逐字稿按时间重叠对齐。

用法:
  diarize.py <16k mono wav> [--json out.json] [--transcript transcript.json]
输出:
  无 --transcript: 打印 speaker 时间段
  有 --transcript: 打印 [speaker] 文本，并写回 json
"""
import argparse
import json
import os
import sys
import wave

import numpy as np
import sherpa_onnx


def read_wav16k(path):
    """读 16k mono PCM16 → float32 numpy 数组（sherpa-onnx 1.13 的 process 直接吃 samples）"""
    with wave.open(path, 'rb') as w:
        assert w.getnchannels() == 1, f"需要单声道，实际 {w.getnchannels()}"
        assert w.getframerate() == 16000, f"需要 16k，实际 {w.getframerate()}"
        assert w.getsampwidth() == 2, f"需要 16bit，实际 {w.getsampwidth()*8}bit"
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0

SEG = os.path.expanduser("~/.cache/diar/sherpa-onnx-pyannote-segmentation-3-0/model.onnx")
EMB = os.path.expanduser("~/.cache/diar/campplus.onnx")


def build(threshold=0.5, num_threads=2, num_clusters=-1):
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
        sys.exit("config 校验失败，检查模型路径")
    return sherpa_onnx.OfflineSpeakerDiarization(cfg)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("wav")
    ap.add_argument("--json")
    ap.add_argument("--transcript")
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--num-clusters", type=int, default=-1, help="固定说话人数；-1 则按 threshold 自动聚类")
    a = ap.parse_args()

    samples = read_wav16k(a.wav)
    dur = len(samples) / 16000
    print(f"audio {dur:.1f}s  threshold={a.threshold}  num_clusters={a.num_clusters}", flush=True)

    sd = build(a.threshold, num_clusters=a.num_clusters)
    print("processing...", flush=True)
    result = sd.process(samples).sort_by_start_time()

    segs = [
        {"start": round(s.start, 2), "end": round(s.end, 2), "speaker": f"S{s.speaker}"}
        for s in result
    ]
    spk = sorted({s["speaker"] for s in segs})
    print(f"segments {len(segs)}  speakers {len(spk)}: {', '.join(spk)}", flush=True)

    if a.json:
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump({"threshold": a.threshold, "numClusters": a.num_clusters, "duration": dur, "speakers": spk, "segments": segs}, f, ensure_ascii=False, indent=2)
        print("json:", a.json, flush=True)

    if not a.transcript:
        for s in segs:
            print(f"[{s['start']:7.2f} -> {s['end']:7.2f}] {s['speaker']}")
        return

    with open(a.transcript, encoding="utf-8") as f:
        t = json.load(f)
    items = t.get("segments") or t.get("items") or []
    out = []
    for it in items:
        st, en = float(it["start"]), float(it["end"])
        best, best_ov = None, 0.0
        for s in segs:
            ov = min(en, s["end"]) - max(st, s["start"])
            if ov > best_ov:
                best_ov, best = ov, s["speaker"]
        it["speaker"] = best or "S?"
        out.append(it)

    t["segments"] = out
    t["diarization"] = {"speakers": spk, "segments": segs, "threshold": a.threshold, "numClusters": a.num_clusters}
    if a.json:
        with open(a.json.replace(".json", ".aligned.json"), "w", encoding="utf-8") as f:
            json.dump(t, f, ensure_ascii=False, indent=2)

    # 连续同一说话人合并成段，便于阅读
    lines, cur = [], None
    for it in out:
        txt = (it.get("text") or "").strip()
        if not txt:
            continue
        if cur and cur["speaker"] == it["speaker"]:
            cur["text"] += txt
            cur["end"] = it["end"]
        else:
            cur = {"speaker": it["speaker"], "start": it["start"], "end": it["end"], "text": txt}
            lines.append(cur)
    for l in lines:
        print(f"[{l['start']:7.2f}] {l['speaker']}: {l['text']}")


if __name__ == "__main__":
    main()
