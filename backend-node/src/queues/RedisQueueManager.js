const { Queue, Worker, QueueEvents } = require("bullmq");

class RedisQueueManager {
  constructor(config) {
    this.config = config;
    this.queueMap = new Map();
    this.queueEventsMap = new Map();
    this.isRunning = false;
    this.enqueueSeq = 0;
    this.QUEUES = {
      PREPROCESSING: "queue-processing-preprocessing",
      STT: "queue-processing-stt",
      ANALYSIS: "queue-processing-analysis",
      VOICE_EMBEDDING: "queue-voice-embedding",
      DIARY_SUMMARY: "queue-diary-summary",
    };
    this.queueRuntimeOptions = {
      connection: { url: this.config.redisUrl },
      skipVersionCheck: true,
    };
  }

  getQueue(queueName) {
    if (!this.queueMap.has(queueName)) {
      this.queueMap.set(queueName, new Queue(queueName, this.queueRuntimeOptions));
    }
    return this.queueMap.get(queueName);
  }

  getQueueEvents(queueName) {
    if (!this.queueEventsMap.has(queueName)) {
      this.queueEventsMap.set(queueName, new QueueEvents(queueName, this.queueRuntimeOptions));
    }
    return this.queueEventsMap.get(queueName);
  }

  getShortQueueName(queueName) {
    if (queueName === this.QUEUES.PREPROCESSING) return "processing";
    if (queueName === this.QUEUES.STT) return "stt";
    if (queueName === this.QUEUES.ANALYSIS) return "analysis";
    if (queueName === this.QUEUES.DIARY_SUMMARY) return "summary";
    if (queueName === this.QUEUES.VOICE_EMBEDDING) return "voice sample";
    return queueName;
  }

  encodeHandle(queueName, jobId) {
    return `${queueName}::${jobId}`;
  }

  decodeHandle(handle) {
    const raw = String(handle || "");
    const sep = raw.indexOf("::");
    if (sep <= 0) throw new Error("Invalid queue job handle");
    return {
      queueName: raw.slice(0, sep),
      jobId: raw.slice(sep + 2),
    };
  }

  extractWorkItem(payload) {
    const data = payload && typeof payload === "object" ? payload : {};
    const fileName = String(
      data?.file?.originalname ||
      data?.voiceSample?.originalname ||
      data?.originalname ||
      ""
    ).trim();
    if (fileName) return `item=${fileName}`;

    const meetingId = String(data.meetingId || data.meeting_id || "").trim();
    if (meetingId) return `item=meeting:${meetingId}`;

    const text = String(data.text || "").trim();
    if (text) return `item=text_len:${text.length}`;

    return "item=n/a";
  }

  async enqueue(queueName, payload) {
    const queue = this.getQueue(queueName);
    const job = await queue.add(
      "task",
      payload || {},
      {
        removeOnComplete: 1000,
        removeOnFail: 1000,
        attempts: 1,
      }
    );
    return this.encodeHandle(queueName, String(job.id));
  }

  async waitForResult(jobHandle, timeoutMs = 10 * 60 * 1000) {
    const { queueName, jobId } = this.decodeHandle(jobHandle);
    const queue = this.getQueue(queueName);
    const queueEvents = this.getQueueEvents(queueName);
    await queueEvents.waitUntilReady();

    const job = await queue.getJob(jobId);
    if (!job) {
      throw new Error("Queue job not found");
    }

    try {
      const out = await job.waitUntilFinished(queueEvents, timeoutMs);
      return { ok: true, data: out ?? null };
    } catch (err) {
      return { ok: false, error: String(err?.message || err) };
    }
  }

  async startWorkers(handlers) {
    if (this.isRunning) return;
    this.isRunning = true;

    const queueEntries = [
      [this.QUEUES.PREPROCESSING, handlers.preprocessing],
      [this.QUEUES.STT, handlers.stt],
      [this.QUEUES.ANALYSIS, handlers.analysis],
      [this.QUEUES.VOICE_EMBEDDING, handlers.voiceEmbedding],
      [this.QUEUES.DIARY_SUMMARY, handlers.diarySummary],
    ];

    const defaultConcurrency = Math.max(1, Number.parseInt(process.env.QUEUE_WORKER_CONCURRENCY || "1", 10) || 1);

    for (const [queueName, handler] of queueEntries) {
      const worker = new Worker(
        queueName,
        async (job) => {
          this.enqueueSeq += 1;
          const runtimeNo = this.enqueueSeq;
          const workItem = this.extractWorkItem(job?.data || {});
          console.log(`[WORKER] bat dau job ${runtimeNo}: ${this.getShortQueueName(queueName)} | ${workItem}`);
          try {
            const out = await handler(job?.data || {});
            console.log(`[WORKER] xong job ${runtimeNo}: ${this.getShortQueueName(queueName)} | ${workItem}`);
            return out ?? null;
          } catch (err) {
            console.error(`[WORKER] loi job ${runtimeNo}: ${this.getShortQueueName(queueName)} | ${workItem} | ${String(err?.message || err)}`);
            throw err;
          }
        },
        {
          ...this.queueRuntimeOptions,
          concurrency: defaultConcurrency,
        }
      );

      worker.on("ready", () => {
        console.log(`[WORKER] san sang stage=${this.getShortQueueName(queueName)} (concurrency=${defaultConcurrency})`);
      });
      worker.on("error", (err) => {
        console.error(`[WORKER][CRASH] ${this.getShortQueueName(queueName)} | loi=${String(err?.message || err)}`);
      });
    }
  }
}

module.exports = RedisQueueManager;
