import json
import logging
import os
import shutil
import tempfile
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import requests
import soundfile as sf
import torch
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydub import AudioSegment, silence
from pyannote.audio import Inference, Model

from ai_service.analysis.topic import extract_topic_and_keywords, warmup_topic_runtime
from ai_service.analysis.summary import summarize_vi
from ai_service.analysis.semantic_search import encode as encode_semantic_text
from ai_service.asr.speech_recognition import load_asr_model, transcribe_chunks
from ai_service.audio.chunking import split_audio_chunks
from ai_service.audio.noise_reduction import denoise
from ai_service.speaker.diarization import run_diarization
from ai_service.speaker.embedding import compute_embedding_vec
from ai_service.speaker.overlap_detection import detect_overlap

# ----------------------------
# ENV
# ----------------------------
load_dotenv(Path(__file__).resolve().parent / ".env")
## Đã bỏ backend cũ, không cần fallback env này nữa
load_dotenv(
    Path(__file__).resolve().parents[1] / "backend-node" / ".env"
)  # fallback for node env

HF_TOKEN = os.getenv("HF_TOKEN", "").strip()
FRONTEND_ORIGIN = os.getenv(
    "FRONTEND_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173"
)
ALLOWED_ORIGINS = [x.strip() for x in FRONTEND_ORIGIN.split(",") if x.strip()]
MAX_AUDIO_MB = int(os.getenv("MAX_MEETING_FILE_MB", "100"))

# Guard cho speaker embedding
MIN_EMB_SEC = float(os.getenv("MIN_EMB_SEC", "0.70"))
FALLBACK_SEGMENT_SEC = float(os.getenv("FALLBACK_SEGMENT_SEC", "3.0"))
MATCH_MIN_SCORE = float(os.getenv("MATCH_MIN_SCORE", "0.38"))
MATCH_MIN_MARGIN = float(os.getenv("MATCH_MIN_MARGIN", "0.012"))
MATCH_FORCE_BEST = os.getenv("MATCH_FORCE_BEST", "0").strip() in {
    "1",
    "true",
    "yes",
    "on",
}
MATCH_LEGACY_TOP1_MODE = os.getenv("MATCH_LEGACY_TOP1_MODE", "1").strip() in {
    "1",
    "true",
    "yes",
    "on",
}
DIAR_DEFAULT_MIN_SPEAKERS = int(os.getenv("DIAR_DEFAULT_MIN_SPEAKERS", "1"))
DIAR_DEFAULT_MAX_SPEAKERS = int(os.getenv("DIAR_DEFAULT_MAX_SPEAKERS", "6"))
ENABLE_LABEL_LEVEL_MATCH = os.getenv("ENABLE_LABEL_LEVEL_MATCH", "0").strip() in {
    "1",
    "true",
    "yes",
    "on",
}
EMB_MIN_SILENCE_LEN_MS = int(os.getenv("EMB_MIN_SILENCE_LEN_MS", "160"))
EMB_SILENCE_THRESH_DBFS = float(os.getenv("EMB_SILENCE_THRESH_DBFS", "-40"))
EMB_MIN_SPEECH_CHUNK_MS = int(os.getenv("EMB_MIN_SPEECH_CHUNK_MS", "400"))
SEMANTIC_MIN_SEGMENT_SEC = float(os.getenv("SEMANTIC_MIN_SEGMENT_SEC", "0.40"))
SEMANTIC_HIGH_INTENSITY_PERCENTILE = float(
    os.getenv("SEMANTIC_HIGH_INTENSITY_PERCENTILE", "85")
)
OVERLAP_THRESHOLD = float(os.getenv("OVERLAP_THRESHOLD", "0.5"))
OVERLAP_MIN_DURATION = float(os.getenv("OVERLAP_MIN_DURATION", "0.20"))

AUDIO_EXTS = {
    ".aac",
    ".adts",
    ".amr",
    ".mp3",
    ".wav",
    ".flac",
    ".ogg",
    ".opus",
    ".m4a",
    ".mp4",
    ".3gp",
    ".webm",
    ".wma",
    ".aif",
    ".aiff",
    ".caf",
}


app = FastAPI(title="AI Service", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------------------
# Lazy models
# ----------------------------
_asr_pipeline = None
_embedding_model = None
logger = logging.getLogger(__name__)
ARTIFACT_ROOT = Path(tempfile.gettempdir()) / "ai_queue_artifacts"
ARTIFACT_ROOT.mkdir(parents=True, exist_ok=True)


@app.on_event("startup")
def warmup_models_on_startup():
    # Preload topic runtime so the first /process-meeting call is not blocked by model init.
    try:
        topic_ready = warmup_topic_runtime()
        if topic_ready:
            logger.info("[startup] Topic runtime warmed up")
        else:
            logger.warning(
                "[startup] Topic runtime warmup skipped (optional deps missing)"
            )
    except Exception as e:
        logger.warning("[startup] Topic runtime warmup failed: %s", e)


def free_memory(module_name, var_names):
    import sys
    import gc
    import torch

    if module_name in sys.modules:
        mod = sys.modules[module_name]
        for v in var_names:
            if hasattr(mod, v):
                val = getattr(mod, v)
                if isinstance(val, dict):
                    val.clear()
                else:
                    setattr(mod, v, None)
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()


def get_asr():
    global _asr_pipeline
    if _asr_pipeline is None:
        _asr_pipeline = load_asr_model()
    return _asr_pipeline


def get_embedding_model():
    global _embedding_model
    if _embedding_model is None:
        if not HF_TOKEN:
            raise RuntimeError("Thiếu HF_TOKEN để load pyannote embedding.")
        _embedding_model = Inference(
            Model.from_pretrained("pyannote/embedding", use_auth_token=HF_TOKEN),
            window="whole",
        )
    return _embedding_model


# ----------------------------
# Helpers
# ----------------------------
def send_progress_callback(
    callback_url: str | None,
    meeting_id: str | None,
    stage: str,
    status: str,
    message: str | None = None,
):
    if not callback_url:
        return

    payload = {
        "meeting_id": meeting_id,
        "stage": stage,
        "status": status,
        "message": message,
    }

    try:
        requests.post(callback_url, json=payload, timeout=2)
    except Exception:
        # Progress callback failure should never break AI processing.
        pass


def parse_metadata(metadata: str | None) -> dict[str, Any]:
    if not metadata:
        return {}

    try:
        val = json.loads(metadata)
        return val if isinstance(val, dict) else {}
    except Exception:
        return {}


def artifact_dir(artifact_id: str) -> Path:
    aid = str(artifact_id or "").strip()
    if not aid:
        raise RuntimeError("artifact_id missing")
    p = ARTIFACT_ROOT / aid
    p.mkdir(parents=True, exist_ok=True)
    return p


def write_json(path: Path, payload: dict[str, Any]):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def validate_input(audio: UploadFile, raw: bytes):
    content_type = str(audio.content_type or "").lower().strip()
    ext = Path(audio.filename or "").suffix.lower().strip()
    looks_like_audio = bool(content_type.startswith("audio/")) or bool(
        ext in AUDIO_EXTS
    )

    if not looks_like_audio:
        raise HTTPException(status_code=400, detail="File không phải audio.")

    if not raw:
        raise HTTPException(status_code=400, detail="File rỗng.")

    max_bytes = MAX_AUDIO_MB * 1024 * 1024
    if len(raw) > max_bytes:
        raise HTTPException(status_code=400, detail=f"File vượt quá {MAX_AUDIO_MB}MB.")


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9
    return float(np.dot(a, b) / denom)


def best_match_speaker(
    emb_vec: np.ndarray,
    speaker_refs: dict[str, Any],
    threshold: float | None = None,
    min_margin: float | None = None,
) -> tuple[str, float]:
    best_name = "UNKNOWN"
    best_score = -1.0
    second_score = -1.0

    for name, vec in speaker_refs.items():
        try:
            ref = np.asarray(vec, dtype=np.float32).reshape(-1)
            if ref.size != emb_vec.size:
                continue
            score = cosine(emb_vec, ref)
            if score > best_score:
                second_score = best_score
                best_name = str(name)
                best_score = score
            elif score > second_score:
                second_score = score
        except Exception:
            continue

    if best_name == "UNKNOWN":
        return "UNKNOWN", best_score

    if threshold is not None and best_score < threshold:
        return "UNKNOWN", best_score

    if min_margin is not None and second_score > -1.0:
        if (best_score - second_score) < min_margin:
            return "UNKNOWN", best_score

    return best_name, best_score


def decode_audio_to_waveform(
    raw: bytes, filename: str | None = None
) -> tuple[torch.Tensor, int]:
    """Decode arbitrary input audio to mono waveform tensor suitable for embedding."""
    with tempfile.TemporaryDirectory(prefix="ai_embedding_") as tmpdir:
        ext = Path(filename or "sample.wav").suffix or ".wav"
        raw_path = os.path.join(tmpdir, f"raw{ext}")
        norm_path = os.path.join(tmpdir, "norm.wav")

        with open(raw_path, "wb") as f:
            f.write(raw)

        ffmpeg_bin = shutil.which("ffmpeg")
        target_path = raw_path
        if ffmpeg_bin:
            try:
                import subprocess

                subprocess.run(
                    [
                        ffmpeg_bin,
                        "-y",
                        "-hide_banner",
                        "-loglevel",
                        "error",
                        "-i",
                        raw_path,
                        "-ac",
                        "1",
                        "-ar",
                        "16000",
                        norm_path,
                    ],
                    check=True,
                )
                target_path = norm_path
            except Exception:
                target_path = raw_path

        import soundfile as sf

        data, sr = sf.read(target_path, dtype="float32")
        if data.ndim == 1:
            data = data[None, :]
        else:
            data = data.T
        if data.shape[0] > 1:
            data = np.mean(data, axis=0, keepdims=True)

        waveform = torch.from_numpy(np.asarray(data, dtype=np.float32))
        return waveform, int(sr)


def _l2_normalize(v: np.ndarray) -> np.ndarray:
    denom = float(np.linalg.norm(v)) + 1e-9
    return (v / denom).astype(np.float32)


def _speech_ranges_from_chunk(y: np.ndarray, sr: int) -> list[tuple[int, int]]:
    if y is None:
        return []

    audio = np.asarray(y, dtype=np.float32).reshape(-1)
    if audio.size == 0 or sr <= 0:
        return []

    audio = np.clip(audio, -1.0, 1.0)
    pcm16 = (audio * 32767.0).astype(np.int16)
    seg = AudioSegment(
        data=pcm16.tobytes(),
        sample_width=2,
        frame_rate=int(sr),
        channels=1,
    )

    silent_ranges = silence.detect_silence(
        seg,
        min_silence_len=EMB_MIN_SILENCE_LEN_MS,
        silence_thresh=EMB_SILENCE_THRESH_DBFS,
    )

    total_ms = len(seg)
    if total_ms <= 0:
        return []

    if not silent_ranges:
        return [(0, total_ms)] if total_ms >= EMB_MIN_SPEECH_CHUNK_MS else []

    speech_ranges: list[tuple[int, int]] = []
    prev_end = 0
    for start_ms, end_ms in silent_ranges:
        s = max(0, int(start_ms))
        e = min(total_ms, int(end_ms))
        if s > prev_end and (s - prev_end) >= EMB_MIN_SPEECH_CHUNK_MS:
            speech_ranges.append((prev_end, s))
        prev_end = max(prev_end, e)

    if prev_end < total_ms and (total_ms - prev_end) >= EMB_MIN_SPEECH_CHUNK_MS:
        speech_ranges.append((prev_end, total_ms))

    return speech_ranges


def compute_chunk_embedding_refined(
    embedding_model: Any, y: np.ndarray, sr: int
) -> np.ndarray | None:
    audio = np.asarray(y, dtype=np.float32).reshape(-1)
    if audio.size == 0:
        return None

    speech_ranges = _speech_ranges_from_chunk(audio, sr)
    emb_list: list[np.ndarray] = []

    if speech_ranges:
        for start_ms, end_ms in speech_ranges:
            start = int((start_ms / 1000.0) * sr)
            end = int((end_ms / 1000.0) * sr)
            if end <= start:
                continue
            sub = audio[start:end]
            if sub.size < int(sr * MIN_EMB_SEC):
                continue
            wf = torch.from_numpy(sub).unsqueeze(0)
            emb = compute_embedding_vec(embedding_model, wf, sr)
            emb_list.append(np.asarray(emb, dtype=np.float32).reshape(-1))

    if not emb_list:
        if audio.size < int(sr * MIN_EMB_SEC):
            return None
        wf = torch.from_numpy(audio).unsqueeze(0)
        emb = compute_embedding_vec(embedding_model, wf, sr)
        return _l2_normalize(np.asarray(emb, dtype=np.float32).reshape(-1))

    pooled = np.mean(np.stack(emb_list, axis=0), axis=0)
    return _l2_normalize(pooled)


def interval_overlap(
    a_start: float, a_end: float, b_start: float, b_end: float
) -> float:
    return max(
        0.0, min(float(a_end), float(b_end)) - max(float(a_start), float(b_start))
    )


def merge_time_segments(
    segments: list[dict[str, Any]],
    min_duration: float = SEMANTIC_MIN_SEGMENT_SEC,
) -> list[dict[str, Any]]:
    if not segments:
        return []

    normed: list[dict[str, Any]] = []
    for s in segments:
        try:
            start = float(s.get("start", 0.0))
            end = float(s.get("end", 0.0))
        except Exception:
            continue
        if end <= start:
            continue
        normed.append(
            {
                "start": start,
                "end": end,
                "has_overlap": bool(s.get("has_overlap", False)),
                "has_high_intensity": bool(s.get("has_high_intensity", False)),
                "scores": [float(s.get("intensity_score", 0.0))],
            }
        )

    if not normed:
        return []

    normed.sort(key=lambda x: (x["start"], x["end"]))
    merged = [normed[0]]
    for cur in normed[1:]:
        prev = merged[-1]
        if cur["start"] <= prev["end"]:
            prev["end"] = max(float(prev["end"]), float(cur["end"]))
            prev["has_overlap"] = bool(prev["has_overlap"] or cur["has_overlap"])
            prev["has_high_intensity"] = bool(
                prev["has_high_intensity"] or cur["has_high_intensity"]
            )
            prev["scores"].extend(cur["scores"])
        else:
            merged.append(cur)

    out: list[dict[str, Any]] = []
    for m in merged:
        dur = float(m["end"]) - float(m["start"])
        if dur < min_duration:
            continue
        scores = [float(x) for x in m.get("scores", [])]
        avg_score = float(np.mean(scores)) if scores else 0.0
        out.append(
            {
                "start": float(m["start"]),
                "end": float(m["end"]),
                "has_overlap": bool(m["has_overlap"]),
                "has_high_intensity": bool(m["has_high_intensity"]),
                "intensity_score": avg_score,
            }
        )
    return out


def build_semantic_segments(
    transcript_segments: list[dict[str, Any]],
    overlaps: list[dict[str, Any]],
    intensity_threshold: float,
) -> list[dict[str, Any]]:
    candidate_ranges: list[dict[str, Any]] = []
    for item in transcript_segments:
        start = float(item.get("start", 0.0))
        end = float(item.get("end", 0.0))
        if end <= start:
            continue

        turn_overlap = any(
            interval_overlap(
                start, end, float(o.get("start", 0.0)), float(o.get("end", 0.0))
            )
            > 0.0
            for o in overlaps
        )
        score = float(item.get("intensity_score", 0.0))
        high_intensity = score >= intensity_threshold
        if not turn_overlap and not high_intensity:
            continue

        candidate_ranges.append(
            {
                "start": start,
                "end": end,
                "has_overlap": turn_overlap,
                "has_high_intensity": high_intensity,
                "intensity_score": score,
            }
        )

    merged = merge_time_segments(candidate_ranges)
    semantic_segments: list[dict[str, Any]] = []

    for seg in merged:
        seg_start = float(seg["start"])
        seg_end = float(seg["end"])
        supporting_indexes: list[int] = []
        content_parts: list[str] = []
        speakers: list[str] = []

        for idx, turn in enumerate(transcript_segments):
            t_start = float(turn.get("start", 0.0))
            t_end = float(turn.get("end", 0.0))
            if interval_overlap(seg_start, seg_end, t_start, t_end) <= 0.0:
                continue
            supporting_indexes.append(idx)
            text = str(turn.get("text", "")).strip()
            if text:
                content_parts.append(text)
            speaker_name = str(turn.get("speaker", "UNKNOWN")).strip() or "UNKNOWN"
            speakers.append(speaker_name)

        content = " ".join(content_parts).strip()
        if not content:
            continue

        semantic_segments.append(
            {
                "content": content,
                "start_time": seg_start,
                "end_time": seg_end,
                "has_overlap": bool(seg.get("has_overlap", False)),
                "has_high_intensity": bool(seg.get("has_high_intensity", False)),
                "intensity_score": float(seg.get("intensity_score", 0.0)),
                "speaker_labels": sorted(set(speakers)),
                "supporting_segment_indexes": supporting_indexes,
            }
        )

    return semantic_segments


def build_speaker_statistics(
    transcript_segments: list[dict[str, Any]],
    semantic_segments: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    stats: dict[str, dict[str, int | str]] = {}

    for seg in transcript_segments:
        speaker_name = str(seg.get("speaker", "UNKNOWN")).strip() or "UNKNOWN"
        if speaker_name not in stats:
            stats[speaker_name] = {
                "speaker": speaker_name,
                "number_of_speech": 0,
                "lively_discussion": 0,
            }
        stats[speaker_name]["number_of_speech"] = (
            int(stats[speaker_name]["number_of_speech"]) + 1
        )

    for seg in transcript_segments:
        speaker_name = str(seg.get("speaker", "UNKNOWN")).strip() or "UNKNOWN"
        start = float(seg.get("start", 0.0))
        end = float(seg.get("end", 0.0))
        if end <= start:
            continue

        in_lively = any(
            interval_overlap(
                start,
                end,
                float(s.get("start_time", 0.0)),
                float(s.get("end_time", 0.0)),
            )
            > 0.0
            for s in semantic_segments
        )
        if in_lively and speaker_name in stats:
            stats[speaker_name]["lively_discussion"] = (
                int(stats[speaker_name]["lively_discussion"]) + 1
            )

    return sorted(stats.values(), key=lambda x: str(x.get("speaker", "")))


def build_search_index_rows(
    transcript_segments: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], int | None]:
    payloads: list[dict[str, Any]] = []
    text_indexes: list[int] = []
    text_values: list[str] = []

    for idx, seg in enumerate(transcript_segments):
        text = str(seg.get("text", "")).strip()
        if not text:
            continue
        text_indexes.append(idx)
        text_values.append(text)

    if not text_values:
        return payloads, None

    embedding_dim: int | None = None
    try:
        vectors = encode_semantic_text(text_values)
        if (
            vectors is not None
            and len(vectors.shape) == 2
            and vectors.shape[0] == len(text_indexes)
        ):
            embedding_dim = int(vectors.shape[1])
            for local_i, seg_idx in enumerate(text_indexes):
                vec = np.asarray(vectors[local_i], dtype=np.float32).reshape(-1)
                payloads.append(
                    {
                        "transcript_segment_index": int(seg_idx),
                        "content": str(
                            transcript_segments[seg_idx].get("text", "")
                        ).strip(),
                        "start_time": float(
                            transcript_segments[seg_idx].get("start", 0.0)
                        ),
                        "end_time": float(transcript_segments[seg_idx].get("end", 0.0)),
                        "embedding_vector": vec.astype(float).tolist(),
                    }
                )
    except Exception:
        # Semantic embedder is optional; returning empty keeps pipeline available.
        return [], None

    return payloads, embedding_dim


# ----------------------------
# API
# ----------------------------
@app.get("/health")
def health():
    return {"ok": True, "service": "ai_service"}


@app.post("/compute-embedding")
async def compute_embedding(audio: UploadFile = File(...)):
    raw = await audio.read()
    validate_input(audio, raw)

    try:
        waveform, sr = decode_audio_to_waveform(raw, audio.filename)
        duration_seconds = float(waveform.shape[-1]) / float(sr) if sr > 0 else 0.0
        emb_model = get_embedding_model()
        emb = compute_embedding_vec(emb_model, waveform, sr)
        emb_vec = np.asarray(emb, dtype=np.float32).reshape(-1).astype(float).tolist()

        if not emb_vec:
            raise RuntimeError("embedding rong")

        return {
            "embedding": emb_vec,
            "dim": len(emb_vec),
            "duration_seconds": duration_seconds,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Khong tinh duoc embedding: {e}")


@app.post("/embed-text")
async def embed_text(payload: dict[str, Any]):
    texts_raw = payload.get("texts")
    if isinstance(texts_raw, str):
        texts = [texts_raw]
    elif isinstance(texts_raw, list):
        texts = [str(x).strip() for x in texts_raw if str(x).strip()]
    else:
        texts = []

    if not texts:
        raise HTTPException(status_code=400, detail="texts is required.")

    try:
        vectors = encode_semantic_text(texts)
        if vectors is None or len(vectors.shape) != 2 or vectors.shape[0] != len(texts):
            raise RuntimeError("invalid embedding payload")

        return {
            "embeddings": [
                np.asarray(v, dtype=np.float32).reshape(-1).astype(float).tolist()
                for v in vectors
            ],
            "dim": int(vectors.shape[1]),
        }
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f"Khong tinh duoc text embedding: {e}"
        )


@app.post("/summarize")
async def summarize_text(payload: dict[str, Any]):
    text = str((payload or {}).get("text", "")).strip()
    if not text:
        raise HTTPException(status_code=400, detail="Thieu text de tom tat.")

    try:
        summary = summarize_vi(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Loi tao summary: {e}") from e

    return {
        "summary": str(summary or "").strip(),
    }


@app.post("/process-meeting/preprocessing")
async def process_meeting_preprocessing(
    audio: UploadFile = File(...),
    metadata: str | None = Form(default=None),
):
    raw = await audio.read()
    validate_input(audio, raw)
    meta = parse_metadata(metadata)
    meeting_id = str(meta.get("meeting_id", "")).strip() or str(uuid.uuid4())
    callback_url = str(meta.get("progress_callback_url", "")).strip()
    artifact_id = str(uuid.uuid4())
    adir = artifact_dir(artifact_id)

    ext = Path(audio.filename or "meeting.wav").suffix or ".wav"
    raw_path = adir / f"raw{ext}"
    norm_path = adir / "norm.wav"
    with open(raw_path, "wb") as f:
        f.write(raw)

    send_progress_callback(
        callback_url,
        meeting_id,
        "preprocessing",
        "processing",
        "Da luu file am thanh dau vao",
    )

    ffmpeg_bin = shutil.which("ffmpeg")
    converted = False
    if ffmpeg_bin:
        try:
            import subprocess

            subprocess.run(
                [
                    ffmpeg_bin,
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(raw_path),
                    "-ac",
                    "1",
                    "-ar",
                    "16000",
                    str(norm_path),
                ],
                check=True,
            )
            converted = True
        except Exception:
            converted = False
    if not converted:
        shutil.copyfile(str(raw_path), str(norm_path))

    duration_seconds = 0.0
    try:
        duration_seconds = float(sf.info(str(norm_path)).duration or 0.0)
    except Exception:
        duration_seconds = 0.0

    min_speakers = DIAR_DEFAULT_MIN_SPEAKERS if DIAR_DEFAULT_MIN_SPEAKERS > 0 else None
    max_speakers = DIAR_DEFAULT_MAX_SPEAKERS if DIAR_DEFAULT_MAX_SPEAKERS > 0 else None
    try:
        segments = run_diarization(
            str(norm_path),
            HF_TOKEN,
            min_speakers=min_speakers,
            max_speakers=max_speakers,
        )
    except Exception:
        segments = []
    free_memory("ai_service.speaker.diarization", ["_DIARIZATION_PIPELINE"])
    if not segments:
        segments = [
            {"start": 0.0, "end": FALLBACK_SEGMENT_SEC, "speaker": "SPEAKER_00"}
        ]

    chunks = split_audio_chunks(str(norm_path), segments)
    speaker_refs = meta.get("speaker_embeddings", {}) if isinstance(meta, dict) else {}
    threshold = MATCH_MIN_SCORE
    min_margin = MATCH_MIN_MARGIN
    legacy_top1_mode = MATCH_LEGACY_TOP1_MODE
    candidate_refs: dict[str, np.ndarray] = {}
    for name, vec in (speaker_refs or {}).items():
        try:
            ref = np.asarray(vec, dtype=np.float32).reshape(-1)
            if ref.size > 0:
                candidate_refs[str(name)] = ref
        except Exception:
            continue

    chunk_match_info: dict[int, dict[str, Any]] = {}
    if candidate_refs:
        emb_model = None
        try:
            emb_model = get_embedding_model()
        except Exception:
            emb_model = None
        if emb_model is not None:
            for i, c in enumerate(chunks):
                speaker_name = c.get("speaker") or "SPEAKER_00"
                score = None
                emb_dim = None
                matched_key = None
                is_identified = False
                try:
                    y = c.get("audio")
                    sr = int(c.get("sr", 16000))
                    emb_vec = (
                        compute_chunk_embedding_refined(
                            emb_model, np.asarray(y, dtype=np.float32), sr
                        )
                        if y is not None
                        else None
                    )
                    if emb_vec is not None and emb_vec.size > 0:
                        emb_dim = int(emb_vec.size)
                        if legacy_top1_mode:
                            best_name = "UNKNOWN"
                            best_score = -1.0
                            for ref_name, ref_vec in candidate_refs.items():
                                if ref_vec.size != emb_vec.size:
                                    continue
                                sim = cosine(emb_vec, ref_vec)
                                if sim > best_score:
                                    best_score = sim
                                    best_name = ref_name
                            score = best_score
                            if best_name != "UNKNOWN":
                                speaker_name = best_name.split("|")[0]
                                matched_key = best_name
                                is_identified = True
                        else:
                            matched, sim = best_match_speaker(
                                emb_vec,
                                speaker_refs,
                                threshold=threshold,
                                min_margin=min_margin,
                            )
                            score = sim
                            if matched != "UNKNOWN":
                                speaker_name = matched.split("|")[0]
                                matched_key = matched
                                is_identified = True
                except Exception:
                    pass
                chunk_match_info[i] = {
                    "speaker": speaker_name,
                    "score": score,
                    "embedding_dim": emb_dim,
                    "matched_key": matched_key,
                    "is_identified": is_identified,
                }

    global _embedding_model
    _embedding_model = None
    free_memory("", [])

    chunk_meta: list[dict[str, Any]] = []
    for i, c in enumerate(chunks):
        raw_chunk = adir / f"chunk_raw_{i}.wav"
        clean_chunk = adir / f"chunk_clean_{i}.wav"
        y = np.asarray(c.get("audio", []), dtype=np.float32)
        sr = int(c.get("sr", 16000))
        sf.write(str(raw_chunk), y, sr)
        try:
            denoise(str(raw_chunk), str(clean_chunk))
        except Exception:
            sf.write(str(clean_chunk), y, sr)
        chunk_meta.append(
            {
                "idx": i,
                "raw_path": str(raw_chunk),
                "clean_path": str(clean_chunk),
                "sr": sr,
                "start": float(c.get("start", 0.0)),
                "end": float(c.get("end", 0.0)),
                "speaker": c.get("speaker"),
            }
        )

    write_json(
        adir / "stage1.json",
        {
            "meeting_id": meeting_id,
            "metadata": meta,
            "audio": {
                "filename": audio.filename,
                "content_type": audio.content_type,
                "size_bytes": len(raw),
                "duration_seconds": duration_seconds,
            },
            "norm_path": str(norm_path),
            "chunk_meta": chunk_meta,
            "chunk_match_info": chunk_match_info,
        },
    )
    send_progress_callback(
        callback_url,
        meeting_id,
        "preprocessing",
        "completed",
        "Da hoan tat preprocessing",
    )
    return {"artifact_id": artifact_id, "meeting_id": meeting_id, "status": "completed"}


@app.post("/process-meeting/stt")
async def process_meeting_stt(payload: dict[str, Any]):
    artifact_id = str((payload or {}).get("artifact_id", "")).strip()
    adir = artifact_dir(artifact_id)
    s1 = read_json(adir / "stage1.json")
    meeting_id = str(s1.get("meeting_id", "")).strip()
    meta = s1.get("metadata", {}) if isinstance(s1.get("metadata"), dict) else {}
    callback_url = str(meta.get("progress_callback_url", "")).strip()

    cleaned_chunks = []
    for c in s1.get("chunk_meta", []):
        y, sr = sf.read(str(c.get("clean_path")), dtype="float32")
        cleaned_chunks.append(
            {
                "audio": y,
                "sr": int(sr),
                "start": float(c.get("start", 0.0)),
                "end": float(c.get("end", 0.0)),
                "speaker": c.get("speaker"),
            }
        )

    send_progress_callback(
        callback_url,
        meeting_id,
        "stt",
        "processing",
        "Dang chuyen doi giong noi thanh van ban",
    )
    asr = get_asr()
    raw_transcript = transcribe_chunks(asr, cleaned_chunks)
    send_progress_callback(
        callback_url, meeting_id, "stt", "completed", "Da hoan tat STT"
    )

    global _asr_pipeline
    _asr_pipeline = None
    import gc

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    enriched = []
    chunk_match_info = (
        s1.get("chunk_match_info", {})
        if isinstance(s1.get("chunk_match_info"), dict)
        else {}
    )
    chunk_meta = s1.get("chunk_meta", [])
    for i, item in enumerate(raw_transcript):
        default_label = chunk_meta[i].get("speaker") if i < len(chunk_meta) else None
        pre_match = (
            chunk_match_info.get(str(i), {})
            if str(i) in chunk_match_info
            else chunk_match_info.get(i, {})
        )
        speaker = pre_match.get("speaker") or default_label or "SPEAKER_00"
        enriched.append(
            {
                "speaker": speaker,
                "diarization_label": default_label,
                "start": float(item.get("start", 0.0)),
                "end": float(item.get("end", 0.0)),
                "text": str(item.get("text", "")).strip(),
                "match_score": pre_match.get("score"),
                "embedding_dim": pre_match.get("embedding_dim"),
                "matched_key": pre_match.get("matched_key"),
                "is_identified": bool(pre_match.get("is_identified", False)),
            }
        )

    write_json(adir / "stage2.json", {"enriched": enriched})
    return {"artifact_id": artifact_id, "meeting_id": meeting_id, "status": "completed"}


@app.post("/process-meeting/analysis")
async def process_meeting_analysis(payload: dict[str, Any]):
    artifact_id = str((payload or {}).get("artifact_id", "")).strip()
    adir = artifact_dir(artifact_id)
    s1 = read_json(adir / "stage1.json")
    s2 = read_json(adir / "stage2.json")
    meta = s1.get("metadata", {}) if isinstance(s1.get("metadata"), dict) else {}
    meeting_id = str(s1.get("meeting_id", "")).strip()
    callback_url = str(meta.get("progress_callback_url", "")).strip()
    enriched = s2.get("enriched", []) if isinstance(s2.get("enriched"), list) else []

    send_progress_callback(
        callback_url, meeting_id, "analysis", "processing", "Dang phan tich"
    )
    from ai_service.analysis.high_intensity import detect_high_intensity

    chunk_meta = s1.get("chunk_meta", [])
    for i, item in enumerate(enriched):
        try:
            if i >= len(chunk_meta):
                item["intensity_score"] = 0.0
                item["is_high_intensity_label"] = False
                continue
            y, sr = sf.read(str(chunk_meta[i].get("raw_path")), dtype="float32")
            res = detect_high_intensity(
                np.asarray(y, dtype=np.float32).reshape(-1), int(sr)
            )
            item["is_high_intensity_label"] = res.get("is_high_intensity", False)
            item["intensity_score"] = (
                float(res.get("score", 0.0)) if item["is_high_intensity_label"] else 0.0
            )
        except Exception:
            item["intensity_score"] = 0.0
            item["is_high_intensity_label"] = False

    free_memory(
        "ai_service.analysis.high_intensity", ["_INTENSITY_MODEL", "_FEATURE_EXTRACTOR"]
    )
    overlaps: list[dict[str, Any]] = []
    try:
        overlaps = detect_overlap(
            str(s1.get("norm_path", "")),
            threshold=OVERLAP_THRESHOLD,
            min_duration=OVERLAP_MIN_DURATION,
            hf_token=HF_TOKEN,
        )
    except Exception:
        overlaps = []
    free_memory("ai_service.speaker.overlap_detection", ["_PIPELINE_CACHE"])

    full_text = " ".join([x.get("text", "") for x in enriched if x.get("text")]).strip()
    analysis = (
        extract_topic_and_keywords(full_text)
        if full_text
        else {"topic_name": "UNKNOWN", "search_content": []}
    )
    free_memory("ai_service.analysis.topic", ["_EMBEDDING_MODEL_CACHE"])

    semantic_segments = build_semantic_segments(
        enriched, overlaps, intensity_threshold=0.1
    )
    speaker_statistics = build_speaker_statistics(enriched, semantic_segments)
    search_index_rows, search_embedding_dim = build_search_index_rows(enriched)
    free_memory("ai_service.analysis.semantic_search", ["_EMBEDDER"])
    send_progress_callback(
        callback_url, meeting_id, "analysis", "completed", "Da hoan tat analysis"
    )

    return {
        "meeting_id": meeting_id,
        "status": "completed",
        "audio": s1.get("audio", {}),
        "metadata": meta,
        "segments": enriched,
        "semantic_segments": semantic_segments,
        "speaker_statistics": speaker_statistics,
        "search_index": {
            "embedding_dim": search_embedding_dim,
            "items": search_index_rows,
        },
        "analysis": analysis,
        "summary": "",
    }


@app.post("/process-meeting")
async def process_meeting(
    audio: UploadFile = File(...),
    metadata: str | None = Form(default=None),
):
    """
    metadata JSON gợi ý:
    {
      "meeting_id": "...",
      "speaker_embeddings": {
        "Nguyen Van A|user_id": [0.01, ...],
        "Tran Thi B|user_id":  [0.02, ...]
      },
      "match_threshold": 0.45
    }
    """
    started_at = datetime.now(timezone.utc)
    request_id = str(uuid.uuid4())

    raw = await audio.read()
    validate_input(audio, raw)
    meta = parse_metadata(metadata)
    callback_url = (
        str(meta.get("progress_callback_url", "")).strip()
        if isinstance(meta, dict)
        else ""
    )
    meeting_id = (
        str(meta.get("meeting_id", "")).strip() if isinstance(meta, dict) else ""
    )
    current_stage = "preprocessing"

    try:
        with tempfile.TemporaryDirectory(prefix="ai_meeting_") as tmpdir:
            ext = Path(audio.filename or "meeting.wav").suffix or ".wav"
            raw_path = os.path.join(tmpdir, f"raw{ext}")

            # 1) Input Check + Raw Audio Store
            with open(raw_path, "wb") as f:
                f.write(raw)

            send_progress_callback(
                callback_url,
                meeting_id,
                "preprocessing",
                "processing",
                "Da luu file am thanh dau vao",
            )

            # 2) Normalize input to WAV mono 16k with ffmpeg (safer decoding)
            norm_path = os.path.join(tmpdir, "norm.wav")
            ffmpeg_bin = shutil.which("ffmpeg")
            converted = False
            if ffmpeg_bin:
                try:
                    import subprocess

                    subprocess.run(
                        [
                            ffmpeg_bin,
                            "-y",
                            "-hide_banner",
                            "-loglevel",
                            "error",
                            "-i",
                            raw_path,
                            "-ac",
                            "1",
                            "-ar",
                            "16000",
                            norm_path,
                        ],
                        check=True,
                    )
                    converted = True
                except Exception:
                    converted = False

            if not converted:
                # fallback: try using raw_path as-is
                norm_path = raw_path

            duration_seconds = 0.0
            try:
                import soundfile as sf

                duration_seconds = float(sf.info(norm_path).duration or 0.0)
            except Exception:
                duration_seconds = 0.0

            send_progress_callback(
                callback_url,
                meeting_id,
                "preprocessing",
                "processing",
                "Da chuan hoa audio sang WAV mono 16k",
            )

            # 3) Diarization on normalized audio
            min_speakers = None
            max_speakers = None
            if isinstance(meta, dict):
                try:
                    ms = (
                        int(meta.get("min_speakers"))
                        if meta.get("min_speakers") is not None
                        else None
                    )
                    if ms and ms > 0:
                        min_speakers = ms
                except Exception:
                    min_speakers = None
                try:
                    xs = (
                        int(meta.get("max_speakers"))
                        if meta.get("max_speakers") is not None
                        else None
                    )
                    if xs and xs > 0:
                        max_speakers = xs
                except Exception:
                    max_speakers = None

            if min_speakers is None and DIAR_DEFAULT_MIN_SPEAKERS > 0:
                min_speakers = DIAR_DEFAULT_MIN_SPEAKERS
            if max_speakers is None and DIAR_DEFAULT_MAX_SPEAKERS > 0:
                max_speakers = DIAR_DEFAULT_MAX_SPEAKERS

            try:
                segments = run_diarization(
                    norm_path,
                    HF_TOKEN,
                    min_speakers=min_speakers,
                    max_speakers=max_speakers,
                )
            except Exception as e:
                logger.error(
                    "[process-meeting] diarization failed meeting_id=%s err=%s",
                    meeting_id,
                    e,
                )
                logger.error(
                    "[process-meeting] diarization traceback:\n%s",
                    traceback.format_exc(),
                )
                segments = []

            free_memory("ai_service.speaker.diarization", ["_DIARIZATION_PIPELINE"])
            if not isinstance(segments, list):
                segments = []

            speaker_count = (
                len({str(s.get("speaker")) for s in segments}) if segments else 0
            )
            send_progress_callback(
                callback_url,
                meeting_id,
                "preprocessing",
                "processing",
                f"Da tach nguoi noi ({speaker_count} speaker)",
            )

            # fallback nếu diarization rỗng: tạo đoạn tối thiểu, tránh 0-length
            if len(segments) == 0:
                segments = [
                    {"start": 0.0, "end": FALLBACK_SEGMENT_SEC, "speaker": "SPEAKER_00"}
                ]

            speaker_refs = (
                meta.get("speaker_embeddings", {}) if isinstance(meta, dict) else {}
            )
            threshold = MATCH_MIN_SCORE
            if isinstance(meta, dict) and meta.get("match_threshold") is not None:
                try:
                    threshold = float(meta.get("match_threshold"))
                except Exception:
                    threshold = MATCH_MIN_SCORE

            min_margin = MATCH_MIN_MARGIN
            if isinstance(meta, dict) and meta.get("match_min_margin") is not None:
                try:
                    min_margin = float(meta.get("match_min_margin"))
                except Exception:
                    min_margin = MATCH_MIN_MARGIN

            force_best_match = MATCH_FORCE_BEST
            if isinstance(meta, dict) and meta.get("force_best_match") is not None:
                force_best_match = str(
                    meta.get("force_best_match")
                ).strip().lower() in {"1", "true", "yes", "on"}

            if force_best_match:
                threshold = None
                min_margin = None

            legacy_top1_mode = MATCH_LEGACY_TOP1_MODE
            if isinstance(meta, dict) and meta.get("legacy_top1_mode") is not None:
                legacy_top1_mode = str(
                    meta.get("legacy_top1_mode")
                ).strip().lower() in {"1", "true", "yes", "on"}

            candidate_refs: dict[str, np.ndarray] = {}
            for name, vec in (speaker_refs or {}).items():
                try:
                    ref = np.asarray(vec, dtype=np.float32).reshape(-1)
                except Exception:
                    continue
                if ref.size == 0:
                    continue
                candidate_refs[str(name)] = ref

            # 4) Prepare chunks based on diarization results (these are time ranges)
            chunks = split_audio_chunks(norm_path, segments)

            # 5) Speaker embedding (Nhận diện giọng nói/Voice ID) trên Raw Audio
            current_stage = "preprocessing"
            send_progress_callback(
                callback_url,
                meeting_id,
                current_stage,
                "processing",
                "Dang nhan dien nguoi noi (tren raw audio)",
            )

            chunk_match_info: dict[int, dict[str, Any]] = {}
            if candidate_refs:
                emb_model = None
                try:
                    emb_model = get_embedding_model()
                except Exception:
                    pass
                if emb_model is not None:
                    for i, c in enumerate(chunks):
                        speaker_name = c.get("speaker") or "SPEAKER_00"
                        score = None
                        emb_dim = None
                        matched_key = None
                        is_identified = False
                        try:
                            y = c.get("audio")
                            sr = int(c.get("sr", 16000))
                            emb_vec = None
                            if y is not None:
                                emb_vec = compute_chunk_embedding_refined(
                                    emb_model, np.asarray(y, dtype=np.float32), sr
                                )
                            if emb_vec is not None and emb_vec.size > 0:
                                emb_dim = int(emb_vec.size)
                                if legacy_top1_mode:
                                    best_name = "UNKNOWN"
                                    best_score = -1.0
                                    for ref_name, ref_vec in candidate_refs.items():
                                        if ref_vec.size != emb_vec.size:
                                            continue
                                        sim = cosine(emb_vec, ref_vec)
                                        if sim > best_score:
                                            best_score = sim
                                            best_name = ref_name
                                    score = best_score
                                    if best_name != "UNKNOWN":
                                        speaker_name = best_name.split("|")[0]
                                        matched_key = best_name
                                        is_identified = True
                                else:
                                    matched, sim = best_match_speaker(
                                        emb_vec,
                                        speaker_refs,
                                        threshold=threshold,
                                        min_margin=min_margin,
                                    )
                                    score = sim
                                    if matched != "UNKNOWN":
                                        speaker_name = matched.split("|")[0]
                                        matched_key = matched
                                        is_identified = True
                        except Exception:
                            pass
                        chunk_match_info[i] = {
                            "speaker": speaker_name,
                            "score": score,
                            "embedding_dim": emb_dim,
                            "matched_key": matched_key,
                            "is_identified": is_identified,
                        }
                        send_progress_callback(
                            callback_url,
                            meeting_id,
                            current_stage,
                            "processing",
                            f"Da match speaker cho chunk {i+1}/{len(chunks)}",
                        )

            global _embedding_model
            _embedding_model = None
            free_memory("", [])

            # 6) Denoise từng chunk để phục vụ STT
            cleaned_chunks = []
            for i, c in enumerate(chunks):
                chunk_raw_path = os.path.join(tmpdir, f"chunk_raw_{i}.wav")
                chunk_clean_path = os.path.join(tmpdir, f"chunk_clean_{i}.wav")
                try:
                    import soundfile as sf

                    sf.write(chunk_raw_path, c["audio"], int(c["sr"]))
                    try:
                        denoise(chunk_raw_path, chunk_clean_path)
                        y, sr = sf.read(chunk_clean_path, dtype="float32")
                    except Exception:
                        y = c["audio"]
                        sr = c["sr"]
                except Exception:
                    y = c.get("audio")
                    sr = c.get("sr", 16000)

                cleaned_chunks.append(
                    {
                        "audio": y,
                        "sr": int(sr),
                        "start": c.get("start", 0.0),
                        "end": c.get("end", 0.0),
                        "speaker": c.get("speaker"),
                    }
                )
                send_progress_callback(
                    callback_url,
                    meeting_id,
                    current_stage,
                    "processing",
                    f"Da khu nhieu chunk {i+1}/{len(chunks)}",
                )

            free_memory("ai_service.audio.noise_reduction", ["_DF_MODEL", "_DF_STATE"])

            # 7) ASR (STT) trên Cleaned Chunks để ra văn bản sạch nhất
            current_stage = "stt"
            send_progress_callback(
                callback_url,
                meeting_id,
                "stt",
                "processing",
                "Dang chuyen doi giong noi thanh van ban (STT tren audio da khu nhieu)",
            )
            asr = get_asr()
            raw_transcript = transcribe_chunks(asr, cleaned_chunks)
            send_progress_callback(
                callback_url, meeting_id, "stt", "completed", "Da hoan tat STT"
            )

            global _asr_pipeline
            _asr_pipeline = None
            import gc
            import torch

            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()

            # 8) Build transcript
            enriched = []
            for i, item in enumerate(raw_transcript):
                default_label = chunks[i].get("speaker") if i < len(chunks) else None
                pre_match = chunk_match_info.get(i, {})
                speaker = pre_match.get("speaker") or default_label or "SPEAKER_00"
                score = pre_match.get("score")
                emb_dim = pre_match.get("embedding_dim")
                matched_key = pre_match.get("matched_key")
                is_identified = bool(pre_match.get("is_identified", False))

                enriched.append(
                    {
                        "speaker": speaker,
                        "diarization_label": default_label,
                        "start": float(item.get("start", 0.0)),
                        "end": float(item.get("end", 0.0)),
                        "text": str(item.get("text", "")).strip(),
                        "match_score": score,
                        "embedding_dim": emb_dim,
                        "matched_key": matched_key,
                        "is_identified": is_identified,
                    }
                )

            # 9) Cường độ cao + Chồng chéo (Chạy chung nhóm)
            current_stage = "analysis"
            send_progress_callback(
                callback_url,
                meeting_id,
                current_stage,
                "processing",
                "Dang phat hien noi chong cheo va cuong do cao",
            )

            from ai_service.analysis.high_intensity import detect_high_intensity

            for i, item in enumerate(enriched):
                try:
                    c_audio = chunks[i].get("audio") if i < len(chunks) else None
                    if c_audio is None:
                        item["intensity_score"] = 0.0
                        continue
                    y = np.asarray(c_audio, dtype=np.float32).reshape(-1)
                    if y.size == 0:
                        item["intensity_score"] = 0.0
                        continue
                    sr = chunks[i].get("sr", 16000) if i < len(chunks) else 16000
                    res = detect_high_intensity(y, sr)
                    item["is_high_intensity_label"] = res.get(
                        "is_high_intensity", False
                    )
                    item["intensity_score"] = (
                        float(res.get("score", 0.0))
                        if item["is_high_intensity_label"]
                        else 0.0
                    )
                except Exception:
                    item["intensity_score"] = 0.0
                    item["is_high_intensity_label"] = False

            free_memory(
                "ai_service.analysis.high_intensity",
                ["_INTENSITY_MODEL", "_FEATURE_EXTRACTOR"],
            )
            intensity_threshold = 0.1

            overlaps: list[dict[str, Any]] = []
            try:
                overlaps = detect_overlap(
                    norm_path,
                    threshold=OVERLAP_THRESHOLD,
                    min_duration=OVERLAP_MIN_DURATION,
                    hf_token=HF_TOKEN,
                )
            except Exception:
                pass
            free_memory("ai_service.speaker.overlap_detection", ["_PIPELINE_CACHE"])

            # 10) Topic Analysis
            full_text = " ".join([x["text"] for x in enriched if x.get("text")]).strip()
            send_progress_callback(
                callback_url,
                meeting_id,
                current_stage,
                "processing",
                "Dang trich xuat topic va tu khoa",
            )
            analysis = (
                extract_topic_and_keywords(full_text)
                if full_text
                else {"topic_name": "UNKNOWN", "search_content": []}
            )
            free_memory("ai_service.analysis.topic", ["_EMBEDDING_MODEL_CACHE"])

            # 11) Semantic Segments & Semantic Search
            send_progress_callback(
                callback_url,
                meeting_id,
                current_stage,
                "processing",
                "Dang tao du lieu semantic segments, speaker statistics va search index",
            )
            semantic_segments = build_semantic_segments(
                enriched, overlaps, intensity_threshold=intensity_threshold
            )
            speaker_statistics = build_speaker_statistics(enriched, semantic_segments)
            search_index_rows, search_embedding_dim = build_search_index_rows(enriched)

            free_memory("ai_service.analysis.semantic_search", ["_EMBEDDER"])

            # Gửi thông báo Hoàn tất bước Analysis cuối cùng
            send_progress_callback(
                callback_url,
                meeting_id,
                current_stage,
                "completed",
                "Da hoan tat toan bo tien trinh phan tich (Analysis)",
            )
            summary = ""

            # 10) Structured result
            ended_at = datetime.now(timezone.utc)
            return {
                "request_id": request_id,
                "meeting_id": meta.get("meeting_id"),
                "status": "completed",
                "started_at": started_at.isoformat(),
                "completed_at": ended_at.isoformat(),
                "audio": {
                    "filename": audio.filename,
                    "content_type": audio.content_type,
                    "size_bytes": len(raw),
                    "duration_seconds": duration_seconds,
                },
                "metadata": meta,
                "segments": enriched,
                "semantic_segments": semantic_segments,
                "speaker_statistics": speaker_statistics,
                "search_index": {
                    "embedding_dim": search_embedding_dim,
                    "items": search_index_rows,
                },
                "analysis": analysis,
                "summary": summary,
            }

    except HTTPException:
        send_progress_callback(
            callback_url, meeting_id, current_stage, "failed", "HTTPException"
        )
        raise
    except Exception as e:
        send_progress_callback(
            callback_url, meeting_id, current_stage, "failed", str(e)
        )
        raise HTTPException(
            status_code=500,
            detail=f"AI pipeline lỗi: {e}\n{traceback.format_exc()}",
        )
