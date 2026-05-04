import torch
import warnings
from transformers import MBartForConditionalGeneration, AutoTokenizer
from underthesea import word_tokenize

warnings.filterwarnings("ignore")

MODEL_NAME = "vinai/bartpho-word"
MAX_LEN = 1024
STRIDE = 256


def split_chunks(input_ids, max_len=1024, stride=256):
    ids = input_ids[0].tolist()
    total = len(ids)

    if total <= max_len:
        return [input_ids]

    chunks = []
    step = max_len - stride

    for i in range(0, total, step):
        chunk = ids[i : i + max_len]
        chunks.append(torch.tensor([chunk], device=input_ids.device))

        if i + max_len >= total:
            break

    return chunks


def summarize_vi(text: str):

    if len(text.strip()) < 10:
        return ""

    device = "cuda" if torch.cuda.is_available() else "cpu"

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = MBartForConditionalGeneration.from_pretrained(MODEL_NAME).to(device)

    # word segmentation cho BARTpho
    try:
        text_seg = word_tokenize(text, format="text")
    except Exception:
        text_seg = text

    input_ids = tokenizer.encode(text_seg, return_tensors="pt").to(device)

    chunks = split_chunks(input_ids, MAX_LEN, STRIDE)

    summaries = []

    for chunk in chunks:
        try:
            out_ids = model.generate(
                chunk,
                max_length=150,
                min_length=40,
                num_beams=4,
                early_stopping=True,
                no_repeat_ngram_size=3,
            )

            part = tokenizer.decode(out_ids[0], skip_special_tokens=True)
            summaries.append(part)

        except Exception:
            continue

    summary = " ".join(summaries).replace("_", " ")

    return summary.strip()
