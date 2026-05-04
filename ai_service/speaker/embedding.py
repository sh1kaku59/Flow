import numpy as np
import torch
import torchaudio
import os

TARGET_SR = 16000
MIN_EMB_SEC = float(os.getenv("MIN_EMB_SEC", "0.70"))
MIN_EMB_SAMPLES = int(TARGET_SR * MIN_EMB_SEC)
_resamplers = {}


def resample_if_needed(waveform, sr, target_sr=TARGET_SR):
    if sr == target_sr:
        return waveform

    key = (sr, target_sr)
    if key not in _resamplers:
        _resamplers[key] = torchaudio.transforms.Resample(sr, target_sr)

    return _resamplers[key](waveform)


def to_mono(waveform):
    if waveform.dim() == 2 and waveform.size(0) > 1:
        return waveform.mean(dim=0, keepdim=True)
    return waveform


def pooling_and_l2norm(frames):
    v = frames.mean(axis=0)
    v = v / (np.linalg.norm(v) + 1e-9)
    return v.reshape(1, -1)


def compute_embedding_vec(embedding_model, waveform, sr):
    wf = to_mono(waveform)
    wf = resample_if_needed(wf, sr)

    if wf.numel() == 0 or wf.size(-1) < MIN_EMB_SAMPLES:
        raise ValueError("Waveform too short for speaker embedding")

    with torch.no_grad():
        emb_out = embedding_model(
            {
                "waveform": wf,
                "sample_rate": TARGET_SR,
            }
        )

    base = emb_out.data if hasattr(emb_out, "data") else emb_out

    if torch.is_tensor(base):
        arr = base.detach().cpu().numpy()
    else:
        arr = np.asarray(base)

    arr = arr.reshape(-1, arr.shape[-1])
    return pooling_and_l2norm(arr)
