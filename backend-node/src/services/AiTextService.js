const axios = require("axios");
const FormData = require("form-data");

class AiTextService {
  constructor(config, queueManager) {
    this.config = config;
    this.queueManager = queueManager;
  }

  async computeTextEmbedding(text) {
    const content = String(text || "").trim();
    if (!content) {
      throw new Error("Query is empty.");
    }

    try {
      const aiRes = await axios.post(
        `${this.config.aiServiceUrl}/embed-text`,
        { texts: [content] },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 120000,
        }
      );

      const vectors = aiRes?.data?.embeddings;
      if (!Array.isArray(vectors) || !vectors.length) {
        throw new Error("AI service tra ve embeddings khong hop le.");
      }

      const first = vectors[0];
      if (!Array.isArray(first) || !first.length) {
        throw new Error("AI service tra ve embedding rong.");
      }

      const embedding = first.map((x) => Number(x)).filter((x) => Number.isFinite(x));
      if (!embedding.length || embedding.length !== first.length) {
        throw new Error("AI service tra ve embedding khong hop le.");
      }

      return embedding;
    } catch (err) {
      const aiDetail = err?.response?.data?.detail;
      throw new Error(aiDetail || err.message || "Loi goi AI text embedding service.");
    }
  }

  async computeTextSummary(text) {
    const content = String(text || "").trim();
    if (!content) {
      throw new Error("Transcript is empty.");
    }

    try {
      const aiRes = await axios.post(
        `${this.config.aiServiceUrl}/summarize`,
        { text: content },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 600000,
        }
      );

      return String(aiRes?.data?.summary || "").trim();
    } catch (err) {
      const aiDetail = err?.response?.data?.detail;
      throw new Error(aiDetail || err.message || "Loi goi AI summary service.");
    }
  }

  async computeTextSummaryViaQueue(text) {
    const jobId = await this.queueManager.enqueue(this.queueManager.QUEUES.DIARY_SUMMARY, { text: String(text || "") });
    const result = await this.queueManager.waitForResult(jobId, 10 * 60 * 1000);
    if (!result?.ok) {
      throw new Error(result?.error || "Summary queue failed.");
    }
    return String(result?.data?.summary || "").trim();
  }

  async computeEmbeddingFromAudio(voiceSample) {
    const form = new FormData();
    form.append("audio", voiceSample.buffer, {
      filename: voiceSample.originalname || "sample.wav",
      contentType: voiceSample.mimetype || "audio/wav",
    });

    try {
      const aiRes = await axios.post(`${this.config.aiServiceUrl}/compute-embedding`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 120000,
      });

      const emb = aiRes?.data?.embedding;
      const durationSec = Number(aiRes?.data?.duration_seconds || 0);
      if (!Array.isArray(emb) || emb.length === 0) {
        throw new Error("AI service tra ve embedding khong hop le.");
      }
      return {
        embedding: emb.map((x) => Number(x)).filter((x) => Number.isFinite(x)),
        duration: Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0,
      };
    } catch (err) {
      const aiDetail = err?.response?.data?.detail;
      throw new Error(aiDetail || err.message || "Loi goi AI embedding service.");
    }
  }

  async computeEmbeddingFromAudioViaQueue(voiceSample) {
    const payload = {
      originalname: voiceSample?.originalname || "sample.wav",
      mimetype: voiceSample?.mimetype || "audio/wav",
      bufferBase64: Buffer.from(voiceSample?.buffer || Buffer.alloc(0)).toString("base64"),
    };
    const jobId = await this.queueManager.enqueue(this.queueManager.QUEUES.VOICE_EMBEDDING, payload);
    const result = await this.queueManager.waitForResult(jobId, 3 * 60 * 1000);
    if (!result?.ok) {
      throw new Error(result?.error || "Voice embedding queue failed.");
    }
    return result.data;
  }
}

module.exports = AiTextService;
