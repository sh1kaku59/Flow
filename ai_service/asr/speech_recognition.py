from transformers import pipeline, AutoModelForSpeechSeq2Seq, AutoProcessor
import torch


def load_asr_model():

    device = 0 if torch.cuda.is_available() else -1

    model_id = "vinai/PhoWhisper-large"

    model = AutoModelForSpeechSeq2Seq.from_pretrained(
        model_id,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
    )

    processor = AutoProcessor.from_pretrained(model_id)

    asr = pipeline(
        task="automatic-speech-recognition",
        model=model,
        tokenizer=processor.tokenizer,
        feature_extractor=processor.feature_extractor,
        device=device,
    )

    return asr


def transcribe_chunks(asr_pipeline, chunks):

    results = []

    for c in chunks:

        r = asr_pipeline(
            {"array": c["audio"], "sampling_rate": c["sr"]},
            generate_kwargs={
                "language": "vi",
                "task": "transcribe",
                "condition_on_prev_tokens": False,
                "compression_ratio_threshold": 1.35,
                "no_speech_threshold": 0.6,
                "logprob_threshold": -1.0,
            },
        )

        results.append({"start": c["start"], "end": c["end"], "text": r["text"]})

    return results
