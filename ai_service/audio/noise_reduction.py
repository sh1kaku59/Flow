import torch
import librosa
import soundfile as sf
from df.enhance import init_df, enhance

# Lazy-init DF model + state so we don't reload the model for every chunk
_DF_MODEL = None
_DF_STATE = None
_DF_DEVICE = None


def _get_df():
    global _DF_MODEL, _DF_STATE, _DF_DEVICE
    if _DF_MODEL is None or _DF_STATE is None:
        device = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
        model, df_state, _ = init_df(config_allow_defaults=True)
        model = model.to(device).eval()
        _DF_MODEL = model
        _DF_STATE = df_state
        _DF_DEVICE = device
    return _DF_MODEL, _DF_STATE, _DF_DEVICE


def denoise(input_path: str, output_path: str):
    # Use shared DF model instance to avoid repeated initialization/log spam
    model, df_state, device = _get_df()

    sr = df_state.sr()

    audio, _ = librosa.load(input_path, sr=sr, mono=True)
    audio = torch.from_numpy(audio).float().unsqueeze(0)  # keep on CPU

    with torch.no_grad():
        clean = enhance(model, df_state, audio)

    clean = clean.squeeze(0).cpu().numpy()
    sf.write(output_path, clean, sr)
    return output_path
