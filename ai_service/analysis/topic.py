import torch
import requests
from pyvi import ViTokenizer

try:
    from bertopic import BERTopic
    from bertopic.representation import KeyBERTInspired
except Exception:
    BERTopic = None
    KeyBERTInspired = None

try:
    from sentence_transformers import SentenceTransformer
except Exception:
    SentenceTransformer = None

from sklearn.feature_extraction.text import CountVectorizer

_STOPWORDS_CACHE = None
_EMBEDDING_MODEL_CACHE = {}


def _get_embedding_model(device: str):
    if device in _EMBEDDING_MODEL_CACHE:
        return _EMBEDDING_MODEL_CACHE[device]

    model = SentenceTransformer(
        "VoVanPhuc/sup-SimCSE-VietNamese-phobert-base",
        device=device,
    )
    _EMBEDDING_MODEL_CACHE[device] = model
    return model


def warmup_topic_runtime(device: str | None = None) -> bool:
    """Preload heavy topic-analysis resources once per process.

    Returns True if runtime is ready, False when optional dependencies are missing.
    """
    if BERTopic is None or KeyBERTInspired is None or SentenceTransformer is None:
        return False

    resolved_device = device or ("cuda" if torch.cuda.is_available() else "cpu")
    load_stopwords()
    _get_embedding_model(resolved_device)
    return True


def load_stopwords():
    global _STOPWORDS_CACHE
    if _STOPWORDS_CACHE is not None:
        return _STOPWORDS_CACHE

    try:
        url = "https://raw.githubusercontent.com/stopwords/vietnamese-stopwords/master/vietnamese-stopwords.txt"
        base = requests.get(url, timeout=10).text.split("\n")

        custom = [
            "nhưng",
            "sẽ",
            "đang",
            "vụ",
            "tác",
            "thể",
            "chưa",
            "cho",
            "hoặc",
            "ra",
            "vào",
            "lên",
            "xuống",
            "những",
            "các",
            "của",
            "và",
            "là",
            "có",
            "được",
            "tại",
            "trong",
            "thì",
            "mà",
            "người",
            "gì",
            "này",
            "đó",
            "mình",
            "ai",
            "chúng_ta",
        ]

        stopwords = [w.strip().replace(" ", "_") for w in base if w.strip()]
        _STOPWORDS_CACHE = list(set(stopwords + custom))
        return _STOPWORDS_CACHE
    except Exception:
        _STOPWORDS_CACHE = ["và", "của", "là"]
        return _STOPWORDS_CACHE


def _fallback(sentences):
    tokens = []
    for s in sentences:
        tokens.extend([w.replace("_", " ") for w in s.split() if len(w) > 2])

    if not tokens:
        return {"topic_name": "UNKNOWN", "search_content": []}

    uniq = sorted(set(tokens))
    return {
        "topic_name": uniq[0].upper(),
        "search_content": uniq[:30],
    }


def extract_topic_and_keywords(text: str, top_n_topics=5):
    """Extract only the main topic name from text.

    Returns a dict with `topic_name` (uppercase string) and an empty
    `search_content` list. This keeps the API compatible but avoids
    storing keyword segments.
    """
    device = "cuda" if torch.cuda.is_available() else "cpu"

    sentences = [
        ViTokenizer.tokenize(s.strip()) for s in text.split(".") if len(s.strip()) > 20
    ]

    if len(sentences) < 1:
        return {"topic_name": "UNKNOWN", "search_content": []}

    # For very short transcripts, lightweight heuristic is typically enough.
    if len(sentences) < 4:
        return {"topic_name": _fallback(sentences)["topic_name"], "search_content": []}

    # If heavy dependencies missing, use lightweight fallback
    if BERTopic is None or KeyBERTInspired is None or SentenceTransformer is None:
        return {"topic_name": _fallback(sentences)["topic_name"], "search_content": []}

    try:
        embedding_model = _get_embedding_model(device)

        embeddings = embedding_model.encode(sentences, show_progress_bar=False)

        topic_model = BERTopic(
            embedding_model=embedding_model,
            vectorizer_model=CountVectorizer(stop_words=load_stopwords()),
            representation_model=KeyBERTInspired(),
            min_topic_size=2,
            n_gram_range=(1, 3),
            verbose=False,
        )

        topic_model.fit_transform(sentences, embeddings)
        topic_info = topic_model.get_topic_info()

        valid_topics = topic_info[topic_info["Topic"] != -1]
        if valid_topics.empty:
            return {"topic_name": "UNKNOWN", "search_content": []}

        # Pick the highest-frequency topic as main
        main_row = valid_topics.sort_values("Count", ascending=False).iloc[0]
        topic_id = int(main_row["Topic"])
        words = [w.replace("_", " ") for w, _ in topic_model.get_topic(topic_id)]
        main_topic = words[0].upper() if words else "UNKNOWN"

        return {"topic_name": main_topic, "search_content": []}

    except Exception:
        return {"topic_name": _fallback(sentences)["topic_name"], "search_content": []}
