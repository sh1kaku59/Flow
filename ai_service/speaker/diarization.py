import os

from pyannote.audio import Pipeline

MIN_SEGMENT_SEC = float(os.getenv("DIAR_MIN_SEGMENT_SEC", "0.03"))
MERGE_GAP_SEC = float(os.getenv("DIAR_MERGE_GAP_SEC", "0.00"))
SHORT_ISLAND_SEC = float(os.getenv("DIAR_SHORT_ISLAND_SEC", "0.20"))
BRIDGE_GAP_SEC = float(os.getenv("DIAR_BRIDGE_GAP_SEC", "0.10"))
ABSORB_SHORT_SEC = float(os.getenv("DIAR_ABSORB_SHORT_SEC", "0.25"))
ABSORB_MAX_GAP_SEC = float(os.getenv("DIAR_ABSORB_MAX_GAP_SEC", "0.12"))
ENABLE_SHORT_ISLAND_BRIDGE = os.getenv(
    "DIAR_ENABLE_SHORT_ISLAND_BRIDGE", "0"
).strip() in {"1", "true", "yes", "on"}
ENABLE_ABSORB_SHORT_SEGMENTS = os.getenv(
    "DIAR_ENABLE_ABSORB_SHORT_SEGMENTS", "0"
).strip() in {"1", "true", "yes", "on"}
_DIARIZATION_PIPELINE = None


def _get_pipeline(token):
    global _DIARIZATION_PIPELINE
    if _DIARIZATION_PIPELINE is None:
        _DIARIZATION_PIPELINE = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            use_auth_token=token,
        )
    return _DIARIZATION_PIPELINE


def _bridge_short_islands(
    segments, short_island_sec=SHORT_ISLAND_SEC, bridge_gap_sec=BRIDGE_GAP_SEC
):
    if len(segments) < 3:
        return segments

    out = [dict(segments[0])]
    i = 1
    while i < len(segments) - 1:
        prev_seg = out[-1]
        cur_seg = segments[i]
        next_seg = segments[i + 1]

        cur_dur = float(cur_seg["end"]) - float(cur_seg["start"])
        prev_to_cur_gap = float(cur_seg["start"]) - float(prev_seg["end"])
        cur_to_next_gap = float(next_seg["start"]) - float(cur_seg["end"])

        # If a short middle segment is sandwiched by the same speaker, merge all three.
        if (
            cur_dur <= short_island_sec
            and prev_seg["speaker"] == next_seg["speaker"]
            and prev_to_cur_gap <= bridge_gap_sec
            and cur_to_next_gap <= bridge_gap_sec
        ):
            prev_seg["end"] = max(float(prev_seg["end"]), float(next_seg["end"]))
            i += 2
            continue

        out.append(dict(cur_seg))
        i += 1

    out.append(dict(segments[-1]))
    return out


def _normalize_segments(segments):
    out = []
    for s in segments:
        try:
            start = float(s["start"])
            end = float(s["end"])
            speaker = str(s["speaker"])
        except Exception:
            continue

        if end <= start:
            continue
        out.append({"start": start, "end": end, "speaker": speaker})

    out.sort(key=lambda x: (x["start"], x["end"]))
    return out


def _duration(seg):
    return float(seg["end"]) - float(seg["start"])


def _gap(left, right):
    return float(right["start"]) - float(left["end"])


def _absorb_short_segments(
    segments, short_sec=ABSORB_SHORT_SEC, max_gap_sec=ABSORB_MAX_GAP_SEC
):
    if len(segments) < 2:
        return segments

    segs = [dict(s) for s in segments]
    i = 0
    while i < len(segs):
        cur = segs[i]
        if _duration(cur) > short_sec:
            i += 1
            continue

        left = segs[i - 1] if i > 0 else None
        right = segs[i + 1] if i + 1 < len(segs) else None

        if left is None and right is None:
            i += 1
            continue

        left_gap = _gap(left, cur) if left is not None else 1e9
        right_gap = _gap(cur, right) if right is not None else 1e9
        left_ok = left is not None and left_gap <= max_gap_sec
        right_ok = right is not None and right_gap <= max_gap_sec

        if not left_ok and not right_ok:
            i += 1
            continue

        # Only bridge when short middle turn is between same-speaker neighbors.
        # Do NOT absorb into a different speaker; that causes S1-S2-S1 to collapse.
        if left_ok and right_ok and left["speaker"] == right["speaker"]:
            left["end"] = max(float(left["end"]), float(right["end"]))
            del segs[i : i + 2]
            i = max(0, i - 1)
            continue

        i += 1

    return segs


def _merge_and_filter_segments(
    segments, min_segment_sec=MIN_SEGMENT_SEC, merge_gap_sec=MERGE_GAP_SEC
):
    if not segments:
        return []

    segs = _normalize_segments(segments)
    if not segs:
        return []

    merged = [dict(segs[0])]

    for s in segs[1:]:
        last = merged[-1]
        same_speaker = s["speaker"] == last["speaker"]
        gap = float(s["start"]) - float(last["end"])

        if same_speaker and gap <= merge_gap_sec:
            last["end"] = max(float(last["end"]), float(s["end"]))
        else:
            merged.append(dict(s))

    if ENABLE_SHORT_ISLAND_BRIDGE:
        merged = _bridge_short_islands(merged)
    if ENABLE_ABSORB_SHORT_SEGMENTS:
        merged = _absorb_short_segments(merged)

    # One more pass after absorption to collapse neighbors that became mergeable.
    final_merged = [dict(merged[0])] if merged else []
    for s in merged[1:]:
        last = final_merged[-1]
        same_speaker = s["speaker"] == last["speaker"]
        gap = float(s["start"]) - float(last["end"])
        if same_speaker and gap <= merge_gap_sec:
            last["end"] = max(float(last["end"]), float(s["end"]))
        else:
            final_merged.append(dict(s))

    # lọc đoạn quá ngắn để giảm cắt vụn
    out = []
    for s in final_merged:
        dur = float(s["end"]) - float(s["start"])
        if dur >= min_segment_sec:
            out.append(s)

    return out


def _to_segments(diarization):
    segments = []
    for segment, _, label in diarization.itertracks(yield_label=True):
        segments.append(
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "speaker": str(label),
            }
        )
    return _merge_and_filter_segments(segments)


def run_diarization(audio_path, token, min_speakers=None, max_speakers=None):
    diarization_pipeline = _get_pipeline(token)

    kwargs = {}
    if isinstance(min_speakers, int) and min_speakers > 0:
        kwargs["min_speakers"] = min_speakers
    if isinstance(max_speakers, int) and max_speakers > 0:
        kwargs["max_speakers"] = max_speakers

    diarization = (
        diarization_pipeline(audio_path, **kwargs)
        if kwargs
        else diarization_pipeline(audio_path)
    )
    segments = _to_segments(diarization)
    return segments
