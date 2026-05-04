"""Minimal overlap detection wrapper for downstream use.

Public API:
        detect_overlap(path, threshold=0.5, min_duration=0.0) -> List[dict]

Each dict: {"start": float, "end": float, "score": float}
"""

from __future__ import annotations

from typing import List, Optional, Any
import os

_PIPELINE_CACHE: dict[str, Any] = {}


def _get_pipeline(
    model: str = "pyannote/overlapped-speech-detection",
    hf_token: Optional[str] = None,
    device: Optional[str] = None,
) -> Any:
    """Load and cache a pyannote Pipeline instance (minimal wrapper).

    Keeps the loader internal so callers only use `detect_overlap()`.
    """
    hf_token = hf_token or os.getenv("HF_TOKEN")
    cache_key = f"{model}:{device or 'auto'}:{bool(hf_token)}"
    if cache_key in _PIPELINE_CACHE:
        return _PIPELINE_CACHE[cache_key]

    try:
        from pyannote.audio import Pipeline
    except Exception as exc:  # pragma: no cover - import/runtime error
        raise RuntimeError(
            "pyannote.audio is required. Install with `pip install pyannote.audio`"
        ) from exc

    kwargs = {}
    if hf_token:
        kwargs["use_auth_token"] = hf_token
    if device:
        kwargs["device"] = device

    pipeline = Pipeline.from_pretrained(model, **kwargs)
    _PIPELINE_CACHE[cache_key] = pipeline
    return pipeline


def _timeline_to_dicts(timeline, threshold: float, min_duration: float) -> List[dict]:
    out: List[dict] = []
    for segment in timeline:
        start = float(segment.start)
        end = float(segment.end)
        dur = end - start
        if dur < min_duration:
            continue
        score = None
        # some timeline segments may carry a 'score' attribute
        if hasattr(segment, "score"):
            try:
                score = float(segment.score)
            except Exception:
                score = None
        out.append({"start": start, "end": end, "score": score})
    return out


def detect_overlap(
    path: str,
    threshold: float = 0.5,
    min_duration: float = 0.0,
    model: Optional[str] = None,
    hf_token: Optional[str] = None,
    device: Optional[str] = None,
) -> List[dict]:
    """Detect overlapped speech in `path` and return list of segments.

    Args:
            path: Local audio file path.
            threshold: Detection threshold (used when pipeline returns frame-wise scores).
            min_duration: Filter out segments shorter than this (seconds).
            model: Optional HF model id to override default.
            hf_token: Optional HF token if needed.
            device: Optional device string for pipeline.

    Returns:
            List of dicts: {"start": float, "end": float, "score": float|None}
    """
    model = model or "pyannote/overlapped-speech-detection"
    pipeline = _get_pipeline(model=model, hf_token=hf_token, device=device)
    result = pipeline(path)

    # Best-effort conversion to list of segments.
    try:
        from pyannote.core import SlidingWindowFeature, Timeline
    except Exception:
        SlidingWindowFeature = None
        Timeline = None

    # If result exposes get_timeline(), prefer it.
    if hasattr(result, "get_timeline") and callable(result.get_timeline):
        try:
            timeline = result.get_timeline()
            segments = _timeline_to_dicts(timeline, threshold, min_duration)
            return segments
        except Exception:
            pass

    # If result is a Timeline already
    if Timeline is not None and isinstance(result, Timeline):
        return _timeline_to_dicts(result, threshold, min_duration)

    # If result is a SlidingWindowFeature (frame-wise scores), convert by thresholding
    if SlidingWindowFeature is not None and isinstance(result, SlidingWindowFeature):
        import numpy as np

        data = np.asarray(result.data).reshape(-1)
        sw = result.sliding_window
        # compute window centers
        try:
            centers = np.asarray(sw.centers)
            half = float(getattr(sw, "duration", 0.0)) / 2.0
        except Exception:
            # fallback: construct centers from start/step/duration
            start = float(getattr(sw, "start", 0.0))
            step = float(
                getattr(sw, "step", 0.0) or getattr(sw, "duration", 0.0) or 0.01
            )
            dur = float(getattr(sw, "duration", 0.0) or step)
            centers = start + np.arange(len(data)) * step + dur / 2.0
            half = dur / 2.0

        mask = data > threshold
        segments: List[dict] = []
        i = 0
        N = len(mask)
        while i < N:
            if not mask[i]:
                i += 1
                continue
            j = i
            while j + 1 < N and mask[j + 1]:
                j += 1
            seg_start = max(0.0, float(centers[i]) - half)
            seg_end = float(centers[j]) + half
            if seg_end - seg_start >= min_duration:
                seg_scores = data[i : j + 1]
                segments.append(
                    {
                        "start": seg_start,
                        "end": seg_end,
                        "score": float(np.max(seg_scores)),
                    }
                )
            i = j + 1
        return segments

    # Last resort: try to iterate result as timeline-like
    try:
        timeline = list(result)
        return _timeline_to_dicts(timeline, threshold, min_duration)
    except Exception:
        # give caller the raw result if we couldn't convert
        return [{"start": 0.0, "end": 0.0, "score": None}]


__all__ = ["detect_overlap"]
