#!/usr/bin/env python3
"""声纹识别标记：把 diarization 的 S0/S1 映射到真人。

三个子命令：
  build-samples <audio> --diar d.json --out DIR
      按说话人裁剪试听片段（每人 ~45s 连续语音）+ 提取声纹向量，供人工确认身份
  enroll <name> --from-samples DIR|--audio FILE [--label S0]
      把确认后的声纹登记进声纹库 ~/.openclaw/minutes-watch/voices/
  identify <audio> --diar d.json
      用声纹库给 S0/S1 打真人名字（余弦相似度，阈值 0.55）

设计原则：
  - 声纹是生物特征，只存向量不存原始音频；库目录 700，文件 600
  - 匹配相似度低于阈值时保持 S0/S1，不猜名字
"""
import argparse, json, os, subprocess, sys, wave
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
_spec = importlib.util.spec_from_file_location("diar", os.path.join(os.path.dirname(os.path.abspath(__file__)), "diarize.py"))
diar = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(diar)

VOICE_DIR = os.path.expanduser("~/.openclaw/minutes-watch/voices")
SR = 16000
MATCH_THRESHOLD = 0.55


def load_wav(path):
    wav = diar.ensure_wav16k(path)
    with wave.open(wav, "rb") as w:
        n = w.getnframes()
        data = np.frombuffer(w.readframes(n), dtype=np.int16).astype(np.float32) / 32768.0
    return data


def slice_wav(samples, sr, start, end):
    a, b = int(start * sr), int(end * sr)
    return samples[max(0, a):min(len(samples), b)]


def write_wav(path, samples, sr=SR):
    pcm = np.clip(samples, -1, 1)
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((pcm * 32767).astype(np.int16).tobytes())


def cos(a, b):
    a = a / (np.linalg.norm(a) + 1e-9)
    b = b / (np.linalg.norm(b) + 1e-9)
    return float(a @ b)


def cmd_build_samples(a):
    samples = load_wav(a.audio)
    sr = SR
    with open(a.diar, encoding="utf8") as f:
        d = json.load(f)
    segs = d.get("segments") or []
    if not segs:
        sys.exit("diar.json 里没有 segments")
    dur_total = len(samples) / sr
    os.makedirs(a.out, exist_ok=True)

    by = {}
    for s in segs:
        by.setdefault(s["speaker"], []).append(s)

    manifest = {"audio": os.path.abspath(a.audio), "diar": os.path.abspath(a.diar),
                "duration": round(dur_total, 2), "speakers": []}

    for spk in sorted(by):
        ss = sorted(by[spk], key=lambda s: s["start"])
        # 挑最长的若干段凑够目标时长（保留时间顺序）
        picked, acc = [], 0.0
        for s in sorted(ss, key=lambda s: s["end"] - s["start"], reverse=True):
            if acc >= a.seconds:
                break
            if s["end"] - s["start"] < 0.8:
                continue
            picked.append(s); acc += s["end"] - s["start"]
        picked.sort(key=lambda s: s["start"])

        chunks = []
        for i, s in enumerate(picked):
            if i:
                chunks.append(np.zeros(int(0.35 * sr), dtype=np.float32))
            chunks.append(slice_wav(samples, sr, s["start"], s["end"]))
        clip = np.concatenate(chunks) if chunks else np.zeros(sr, dtype=np.float32)

        wav_path = os.path.join(a.out, f"{spk}.wav")
        write_wav(wav_path, clip)
        m4a_path = os.path.join(a.out, f"{spk}.m4a")
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", "64000", wav_path, m4a_path],
                       check=False, capture_output=True)

        # 声纹：对每一段单独取 embedding 再平均（比整段拼起来更稳）
        E, idx = diar.embed_segments(samples, [{"start": s["start"], "end": s["end"]} for s in picked])
        if len(E) == 0:
            print(f"  {spk}: 声纹提取失败（片段太短）", flush=True)
            emb = None
        else:
            emb = E.mean(axis=0)
            emb = emb / (np.linalg.norm(emb) + 1e-9)
        if emb is not None:
            np.save(os.path.join(a.out, f"{spk}.npy"), emb.astype(np.float32))

        total_speech = sum(s["end"] - s["start"] for s in ss)
        manifest["speakers"].append({
            "label": spk,
            "segments": len(ss),
            "speechSec": round(total_speech, 1),
            "share": round(total_speech / max(dur_total, 1e-9), 3),
            "sampleSec": round(len(clip) / sr, 1),
            "sample": f"{spk}.m4a",
            "embedding": f"{spk}.npy" if emb is not None else None,
        })
        print(f"  {spk}: {len(ss)} 段 / 语音 {total_speech:.0f}s / 占比 {total_speech/dur_total:.1%} / 试听 {len(clip)/sr:.1f}s", flush=True)

    with open(os.path.join(a.out, "manifest.json"), "w", encoding="utf8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


def cmd_enroll(a):
    os.makedirs(VOICE_DIR, exist_ok=True)
    os.chmod(VOICE_DIR, 0o700)
    if a.from_samples:
        src = os.path.join(a.from_samples, f"{a.label}.npy")
        if not os.path.exists(src):
            src = os.path.join(a.from_samples, "S0.npy")
        emb = np.load(src)
    else:
        samples = load_wav(a.audio)
        segs = [{"start": 0.0, "end": len(samples) / SR}]
        E, idx = diar.embed_segments(samples, segs)
        if len(E) == 0:
            sys.exit("参考音频里没提取到有效声纹（太短或全是静音）")
        emb = E.mean(axis=0)
        emb = emb / (np.linalg.norm(emb) + 1e-9)

    path = os.path.join(VOICE_DIR, f"{a.name}.npy")
    np.save(path, emb.astype(np.float32))
    os.chmod(path, 0o600)
    with open(os.path.join(VOICE_DIR, "gallery.json"), "r", encoding="utf8") if os.path.exists(
            os.path.join(VOICE_DIR, "gallery.json")) else open(os.devnull) as f:
        pass
    gpath = os.path.join(VOICE_DIR, "gallery.json")
    gal = json.load(open(gpath, encoding="utf8")) if os.path.exists(gpath) else {}
    gal[a.name] = {"file": f"{a.name}.npy", "dim": int(emb.shape[0]), "enrolledAt": __import__("datetime").datetime.now().astimezone().isoformat(timespec="seconds")}
    json.dump(gal, open(gpath, "w", encoding="utf8"), ensure_ascii=False, indent=2)
    os.chmod(gpath, 0o600)
    print(f"已登记声纹: {a.name} (dim {emb.shape[0]}) -> {path}")


def cmd_identify(a):
    gpath = os.path.join(VOICE_DIR, "gallery.json")
    if not os.path.exists(gpath):
        sys.exit(f"声纹库为空：{VOICE_DIR}/gallery.json 不存在，先 enroll")
    gal = json.load(open(gpath, encoding="utf8"))
    names = {k: np.load(os.path.join(VOICE_DIR, v["file"])) for k, v in gal.items()}

    samples = load_wav(a.audio)
    d = json.load(open(a.diar, encoding="utf8"))
    by = {}
    for s in d.get("segments") or []:
        by.setdefault(s["speaker"], []).append(s)

    result = {}
    for spk, ss in sorted(by.items()):
        E, _ = diar.embed_segments(samples, [{"start": s["start"], "end": s["end"]} for s in ss])
        if len(E) == 0:
            result[spk] = {"name": None, "reason": "no embedding"}
            continue
        emb = E.mean(axis=0)
        scores = {n: cos(emb, g) for n, g in names.items()}
        best = max(scores, key=scores.get) if scores else None
        ok = best and scores[best] >= a.threshold
        result[spk] = {"name": best if ok else None,
                       "score": round(scores[best], 4) if best else None,
                       "threshold": a.threshold,
                       "all": {k: round(v, 4) for k, v in sorted(scores.items(), key=lambda x: -x[1])}}
    print(json.dumps(result, ensure_ascii=False, indent=2))


ap = argparse.ArgumentParser()
sub = ap.add_subparsers(dest="cmd", required=True)

p = sub.add_parser("build-samples", help="按说话人裁试听片段 + 存声纹")
p.add_argument("audio"); p.add_argument("--diar", required=True); p.add_argument("--out", required=True)
p.add_argument("--seconds", type=float, default=45)
p.set_defaults(fn=cmd_build_samples)

p = sub.add_parser("enroll", help="登记某人声纹")
p.add_argument("name"); p.add_argument("--from-samples"); p.add_argument("--audio")
p.add_argument("--label", default="S0")
p.set_defaults(fn=cmd_enroll)

p = sub.add_parser("identify", help="用声纹库标真人名")
p.add_argument("audio"); p.add_argument("--diar", required=True)
p.add_argument("--threshold", type=float, default=MATCH_THRESHOLD)
p.set_defaults(fn=cmd_identify)

a = ap.parse_args()
a.fn(a)
