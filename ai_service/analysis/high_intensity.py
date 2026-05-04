import torch
import torch.nn.functional as F
import numpy as np
from transformers import Wav2Vec2FeatureExtractor, AutoModelForAudioClassification

_INTENSITY_MODEL = None
_FEATURE_EXTRACTOR = None


def _get_intensity_model():
    global _INTENSITY_MODEL, _FEATURE_EXTRACTOR
    if _INTENSITY_MODEL is None:
        model_id = "superb/wav2vec2-base-superb-er"
        device = "cuda" if torch.cuda.is_available() else "cpu"

        _FEATURE_EXTRACTOR = Wav2Vec2FeatureExtractor.from_pretrained(model_id)
        _INTENSITY_MODEL = AutoModelForAudioClassification.from_pretrained(model_id)
        _INTENSITY_MODEL.to(device)
        _INTENSITY_MODEL.eval()

    return _INTENSITY_MODEL, _FEATURE_EXTRACTOR


def detect_high_intensity(audio_array: np.ndarray, sr: int = 16000) -> dict:
    """
    High Intensity Detection from audio chunk.
    Uses superb/wav2vec2-base-superb-er to classify acoustic arousal.
    0: neu (neutral - low/normal intensity)
    1: hap (happy - high intensity/arousal)
    2: ang (angry - high intensity/arousal)
    3: sad (sad - low intensity/arousal)
    """
    if audio_array is None or audio_array.size < sr * 0.5:
        return {"is_high_intensity": False, "label": "neu", "score": 0.0}

    try:
        model, extractor = _get_intensity_model()
        device = "cuda" if torch.cuda.is_available() else "cpu"

        inputs = extractor(
            audio_array, sampling_rate=sr, return_tensors="pt", padding=True
        )
        inputs = {k: v.to(device) for k, v in inputs.items()}

        with torch.no_grad():
            logits = model(**inputs).logits

        probs = F.softmax(logits, dim=-1)
        predicted_id = torch.argmax(probs, dim=-1).item()

        label = model.config.id2label[predicted_id]

        # High intensity is defined as angry or happy (high arousal states)
        is_high_intensity = label in ["ang", "hap"]

        return {
            "is_high_intensity": is_high_intensity,
            "label": label,
            "score": probs[0][predicted_id].item(),
        }
    except Exception as e:
        print(f"[HighIntensity] Error detecting intensity: {e}")
        return {"is_high_intensity": False, "label": "neu", "score": 0.0}
