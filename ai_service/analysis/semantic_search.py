"""Semantic-search helper based on SentenceTransformers.

API:
    encode(texts) -> np.ndarray
    semantic_search(query, corpus, top_k=5) -> List[dict]

Defaults to `BAAI/bge-m3`.
"""

from __future__ import annotations

from typing import List, Optional, Sequence

import numpy as np

_EMBEDDER = None


def _init(model: str = "BAAI/bge-m3", device: Optional[str] = None):
    global _EMBEDDER
    if _EMBEDDER is not None:
        return
    try:
        from sentence_transformers import SentenceTransformer
    except Exception as exc:
        raise RuntimeError(
            "Install sentence-transformers: pip install sentence-transformers"
        ) from exc

    _EMBEDDER = SentenceTransformer(model, device=device)


def encode(
    texts: Sequence[str],
    model: str = "BAAI/bge-m3",
    device: Optional[str] = None,
    batch_size: int = 8,
) -> np.ndarray:
    _init(model=model, device=device)
    model_st = _EMBEDDER
    if not texts:
        return np.empty((0, 0), dtype=np.float32)
    return model_st.encode(
        list(texts),
        batch_size=batch_size,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=False,
    )


def semantic_search(
    query: str,
    corpus: Sequence[str],
    top_k: int = 5,
    model: str = "BAAI/bge-m3",
    device: Optional[str] = None,
) -> List[dict]:
    if len(corpus) == 0:
        return []
    try:
        from sentence_transformers import util
    except Exception as exc:
        raise RuntimeError(
            "Install sentence-transformers: pip install sentence-transformers"
        ) from exc

    query_emb = encode([query], model=model, device=device)
    corpus_emb = encode(corpus, model=model, device=device)
    hits = util.semantic_search(query_emb, corpus_emb, top_k=top_k)[0]
    return [
        {
            "text": corpus[int(hit["corpus_id"])],
            "score": float(hit["score"]),
            "idx": int(hit["corpus_id"]),
        }
        for hit in hits
    ]


__all__ = ["encode", "semantic_search"]
