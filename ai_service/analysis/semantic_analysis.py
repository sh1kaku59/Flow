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


def load_stopwords():
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
        return list(set(stopwords + custom))
    except Exception:
        return ["và", "của", "là"]


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
    device = "cuda" if torch.cuda.is_available() else "cpu"

    sentences = [
        ViTokenizer.tokenize(s.strip()) for s in text.split(".") if len(s.strip()) > 20
    ]

    if len(sentences) < 3:
        return {"topic_name": "UNKNOWN", "search_content": []}

    stopwords = load_stopwords()

    # Dependency không đủ thì fallback luôn
    if BERTopic is None or KeyBERTInspired is None or SentenceTransformer is None:
        return _fallback(sentences)

    try:
        embedding_model = SentenceTransformer(
            "VoVanPhuc/sup-SimCSE-VietNamese-phobert-base", device=device
        )

        embeddings = embedding_model.encode(sentences, show_progress_bar=False)

        topic_model = BERTopic(
            embedding_model=embedding_model,
            vectorizer_model=CountVectorizer(stop_words=stopwords),
            representation_model=KeyBERTInspired(),
            min_topic_size=2,
            n_gram_range=(1, 3),
            verbose=False,
        )

        topic_model.fit_transform(sentences, embeddings)
        topic_info = topic_model.get_topic_info()

        valid_topics = topic_info[topic_info["Topic"] != -1].head(top_n_topics)
        if valid_topics.empty:
            valid_topics = topic_info.head(1)

        keywords = []
        main_topic = "UNKNOWN"

        for i, row in valid_topics.reset_index(drop=True).iterrows():
            topic_id = row["Topic"]
            words = [w.replace("_", " ") for w, _ in topic_model.get_topic(topic_id)]

            if i == 0 and words:
                main_topic = words[0].upper()

            keywords.extend(words)

        keywords = sorted(set(k for k in keywords if len(k) > 2))
        return {"topic_name": main_topic, "search_content": keywords}

    except Exception:
        return _fallback(sentences)
