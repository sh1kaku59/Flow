process.env.QUEUE_LOG_ENQUEUE = process.env.QUEUE_LOG_ENQUEUE || "1";

const { createClient } = require("@supabase/supabase-js");
const config = require("./config/AppConfig");
const RedisQueueManager = require("./queues/RedisQueueManager");
const ValidationHelper = require("./utils/ValidationHelper");
const StorageHelper = require("./utils/StorageHelper");
const AiTextService = require("./services/AiTextService");
const QueueWorkerService = require("./services/QueueWorkerService");

async function main() {
  const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const queueManager = new RedisQueueManager(config);
  const validationHelper = new ValidationHelper();
  const storageHelper = new StorageHelper();
  const aiTextService = new AiTextService(config, queueManager);
  const queueWorkerService = new QueueWorkerService(
    config,
    supabaseAdmin,
    queueManager,
    validationHelper,
    aiTextService,
    storageHelper
  );

  await queueManager.startWorkers({
    preprocessing: queueWorkerService.queuePreprocessingJob.bind(queueWorkerService),
    stt: queueWorkerService.queueSttJob.bind(queueWorkerService),
    analysis: queueWorkerService.queueAnalysisJob.bind(queueWorkerService),
    voiceEmbedding: queueWorkerService.queueVoiceEmbeddingJob.bind(queueWorkerService),
    diarySummary: queueWorkerService.queueDiarySummaryJob.bind(queueWorkerService),
  });

  console.log("[worker] ready");
}

main().catch((err) => {
  console.error("[worker] startup failed:", err?.message || err);
  process.exit(1);
});
