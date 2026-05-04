import numpy as np
import soundfile as sf


def _resample_linear(audio: np.ndarray, src_sr: int, target_sr: int) -> np.ndarray:
    if src_sr == target_sr or audio.size == 0:
        return audio.astype(np.float32, copy=False)

    src_len = int(audio.shape[0])
    dst_len = max(1, int(round(src_len * float(target_sr) / float(src_sr))))
    x_old = np.linspace(0.0, 1.0, num=src_len, endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=dst_len, endpoint=False)
    out = np.interp(x_new, x_old, audio).astype(np.float32)
    return out


def read_chunk_np(
    audio_file: sf.SoundFile, start_sec: float, end_sec: float, target_sr: int = 16000
):
    src_sr = int(audio_file.samplerate)
    start_frame = max(0, int(round(float(start_sec) * src_sr)))
    end_frame = max(start_frame, int(round(float(end_sec) * src_sr)))
    frames = max(0, end_frame - start_frame)

    if frames == 0:
        return np.zeros(0, dtype=np.float32), target_sr

    audio_file.seek(start_frame)
    data = audio_file.read(frames, dtype="float32", always_2d=True)
    if data.size == 0:
        return np.zeros(0, dtype=np.float32), target_sr

    mono = np.mean(data, axis=1).astype(np.float32)
    if src_sr != target_sr:
        mono = _resample_linear(mono, src_sr, target_sr)
    return mono, target_sr


def split_audio_chunks(audio_path, segments):
    chunks = []

    with sf.SoundFile(audio_path) as audio_file:
        for seg in segments:
            start = float(seg.get("start", 0.0))
            end = float(seg.get("end", 0.0))
            if end - start < 0.1:
                continue
            y, sr = read_chunk_np(audio_file, start, end)

            chunks.append(
                {
                    "audio": y,
                    "sr": sr,
                    "start": start,
                    "end": end,
                    "speaker": seg.get("speaker", "SPEAKER_00"),
                }
            )

    return chunks
