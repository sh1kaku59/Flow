const crypto = require("crypto");

const STEP_DEFS = [
  { order: 1, name: "preprocessing" },
  { order: 2, name: "stt" },
  { order: 3, name: "analysis" },
];

const STAGE_TO_ORDER = {
  preprocessing: 1,
  stt: 2,
  analysis: 3,
};

const TOTAL_STEPS = STEP_DEFS.length;

class MeetingService {
  constructor(config, supabaseAdminClient, queueManager, aiTextService, validationHelper, dateTimeHelper, storageHelper) {
    this.config = config;
    this.supabaseAdmin = supabaseAdminClient;
    this.queueManager = queueManager;
    this.aiTextService = aiTextService;
    this.validationHelper = validationHelper;
    this.dateTimeHelper = dateTimeHelper;
    this.storageHelper = storageHelper;
  }

  normalizeMeetingStatus(rawStatus) {
    const normalized = String(rawStatus || "").trim().toLowerCase();
    if (normalized === "processing") return "Processing";
    if (normalized === "completed") return "Completed";
    if (normalized === "failed") return "Failed";
    return "Pending";
  }

  async buildMeetingAudioInfoById(meetingIds) {
    const ids = (meetingIds || []).filter((id) => this.validationHelper.isValidUuid(id));
    if (!ids.length) {
      return {};
    }

    let audioRes = await this.supabaseAdmin
      .from("audio_file")
      .select("meeting_id,duration,file_url,created_at")
      .in("meeting_id", ids)
      .order("created_at", { ascending: false });

    if (audioRes.error) {
      audioRes = await this.supabaseAdmin
        .from("audio_file")
        .select("meeting_id,duration,file_url")
        .in("meeting_id", ids);
    }

    if (audioRes.error) {
      throw new Error(audioRes.error.message);
    }

    const byMeetingId = {};
    for (const row of audioRes.data || []) {
      const meetingId = String(row?.meeting_id || "").trim();
      if (!this.validationHelper.isValidUuid(meetingId) || byMeetingId[meetingId]) {
        continue;
      }

      const rawDuration = Number(row?.duration);
      const rawFileUrl = String(row?.file_url || "").trim() || null;
      const signedAudioUrl = await this.storageHelper.createSignedUrlSafe(this.supabaseAdmin, this.config.meetingAudioBucket, rawFileUrl);

      byMeetingId[meetingId] = {
        duration: Number.isFinite(rawDuration) ? rawDuration : null,
        audio_url: signedAudioUrl || rawFileUrl,
      };
    }

    return byMeetingId;
  }

  formatMeetingRow(row, audioInfo = null) {
    return {
      id: row?.id || null,
      account_id: row?.account_id || null,
      title: String(row?.title || "").trim() || "Untitled",
      topic: String(row?.topic || "").trim() || null,
      status: this.normalizeMeetingStatus(row?.status),
      created_at: row?.created_at || null,
      duration: audioInfo?.duration ?? null,
      audio_url: audioInfo?.audio_url || null,
      audio_file: audioInfo
        ? {
            duration: audioInfo.duration ?? null,
            file_url: audioInfo.audio_url || null,
          }
        : null,
    };
  }

  isRlsInsertError(err) {
    const message = String(err?.message || "").toLowerCase();
    return message.includes("row-level security") || message.includes("violates row-level security policy");
  }

  async processMeetingUpload(file, authorizationHeader = null) {
    if (!file || !file.mimetype || !file.mimetype.startsWith("audio/")) {
      return { status: 400, body: { detail: "File phai la audio." } };
    }
    if (!file.buffer || file.buffer.length === 0) {
      return { status: 400, body: { detail: "File rong." } };
    }
    if (
      !authorizationHeader ||
      typeof authorizationHeader !== "string" ||
      !authorizationHeader.toLowerCase().startsWith("bearer ")
    ) {
      return { status: 401, body: { detail: "Missing or invalid Authorization header." } };
    }

    const meetingId = crypto.randomUUID();
    let accountId = null;
    try {
      const token = authorizationHeader.slice(7).trim();
      const authRes = await this.supabaseAdmin.auth.getUser(token);
      if (!authRes.error && authRes.data?.user) {
        accountId = authRes.data.user.id || null;
      } else {
        return { status: 401, body: { detail: authRes.error?.message || "Invalid or expired token." } };
      }
    } catch (_err) {
      return { status: 401, body: { detail: "Cannot validate access token." } };
    }

    if (!accountId) {
      return { status: 401, body: { detail: "Cannot resolve account from token." } };
    }

    const generatedTitle = `title${meetingId.slice(0, 8)}`;
    const meetingPayload = { id: meetingId, account_id: accountId, status: "processing", title: generatedTitle };

    let meetingInsert = await this.supabaseAdmin.from("meeting").insert(meetingPayload);
    if (meetingInsert.error && this.isRlsInsertError(meetingInsert.error)) {
      meetingInsert = await this.supabaseAdmin
        .from("meeting")
        .insert({ id: meetingId, status: "processing", title: generatedTitle });
    }
    if (meetingInsert.error) {
      return { status: 500, body: { detail: `Loi tao meeting: ${meetingInsert.error.message}` } };
    }

    const job = await this.supabaseAdmin
      .from("processing_job")
      .insert({
        meeting_id: meetingId,
        status: "processing",
        job_type: "process_meeting",
        progress_percent: 0,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (job.error) {
      await this.supabaseAdmin.from("meeting").update({ status: "failed" }).eq("id", meetingId);
      return { status: 500, body: { detail: `Loi tao job: ${job.error.message}` } };
    }

    const jobId = job.data?.id;
    const stepRows = STEP_DEFS.map((stepDefinition) => ({
      job_id: jobId,
      step_name: stepDefinition.name,
      step_order: stepDefinition.order,
      status: stepDefinition.order === 1 ? "processing" : "pending",
      started_at: stepDefinition.order === 1 ? new Date().toISOString() : null,
    }));

    const stepInsert = await this.supabaseAdmin.from("processing_step").insert(stepRows);
    if (stepInsert.error) {
      await this.supabaseAdmin.from("meeting").update({ status: "failed" }).eq("id", meetingId);
      await this.supabaseAdmin
        .from("processing_job")
        .update({ status: "failed", error_message: stepInsert.error.message, completed_at: new Date().toISOString() })
        .eq("id", jobId);
      return { status: 500, body: { detail: `Loi tao processing_step: ${stepInsert.error.message}` } };
    }

    await this.queueManager.enqueue(this.queueManager.QUEUES.PREPROCESSING, {
      meetingId,
      jobId,
      accountId,
      file: {
        originalname: file.originalname || "meeting.wav",
        mimetype: file.mimetype || "audio/wav",
        size: file.size || file.buffer.length,
        bufferBase64: Buffer.from(file.buffer || Buffer.alloc(0)).toString("base64"),
      },
    });

    return {
      status: 202,
      body: {
        audio_id: meetingId,
        status: "processing",
        message: "Upload thanh cong. Dang xu ly...",
      },
    };
  }

  async handleAiProgressUpdate(payload) {
    const meetingId = String(payload?.meeting_id || "").trim();
    const stage = String(payload?.stage || "").trim();
    const status = String(payload?.status || "").trim().toLowerCase();
    const message = String(payload?.message || "").trim();
    const substage = String(payload?.substage || "").trim();
    const progress = Number.isFinite(Number(payload?.progress)) ? Number(payload.progress) : null;
    const reportMessage = substage ? `${substage} ${message}`.trim() : message;

    if (!meetingId || !stage || !status) {
      return { status: 400, body: { detail: "Thieu meeting_id/stage/status." } };
    }

    const order = STAGE_TO_ORDER[stage];
    if (!order) {
      return { status: 400, body: { detail: `Stage khong hop le: ${stage}` } };
    }

    const jobRes = await this.supabaseAdmin
      .from("processing_job")
      .select("id")
      .eq("meeting_id", meetingId)
      .order("started_at", { ascending: false })
      .limit(1);
    if (jobRes.error) {
      return { status: 500, body: { detail: `Loi truy van job: ${jobRes.error.message}` } };
    }

    const jobId = (jobRes.data || [])[0]?.id;
    if (!jobId) {
      return { status: 404, body: { detail: "Khong tim thay processing_job." } };
    }

    if (status === "processing") {
      await this.supabaseAdmin
        .from("processing_step")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("job_id", jobId)
        .lt("step_order", order)
        .in("status", ["processing"]);

      await this.supabaseAdmin
        .from("processing_step")
        .update({ status: "processing", started_at: new Date().toISOString(), error_message: null })
        .eq("job_id", jobId)
        .eq("step_order", order);

      await this.supabaseAdmin
        .from("processing_job")
        .update({
          status: "processing",
          progress_percent:
            progress === null
              ? Math.max(5, Math.min(95, Math.floor(((order - 1) / Math.max(1, TOTAL_STEPS)) * 100) + 10))
              : Math.max(0, Math.min(99, progress)),
          error_message: reportMessage || null,
        })
        .eq("id", jobId);
    } else if (status === "completed") {
      await this.supabaseAdmin
        .from("processing_step")
        .update({ status: "completed", completed_at: new Date().toISOString(), error_message: null })
        .eq("job_id", jobId)
        .eq("step_order", order);

      const autoProgress = Math.min(99, Math.floor((order / Math.max(1, TOTAL_STEPS)) * 100));
      await this.supabaseAdmin
        .from("processing_job")
        .update({
          progress_percent: progress === null ? autoProgress : Math.max(0, Math.min(100, progress)),
          error_message: reportMessage || null,
        })
        .eq("id", jobId);
    } else if (status === "failed") {
      await this.supabaseAdmin
        .from("processing_step")
        .update({
          status: "failed",
          error_message: message || "AI step failed",
          completed_at: new Date().toISOString(),
        })
        .eq("job_id", jobId)
        .eq("step_order", order);

      await this.supabaseAdmin
        .from("processing_job")
        .update({
          status: "failed",
          error_message: reportMessage || "AI step failed",
          completed_at: new Date().toISOString(),
        })
        .eq("id", jobId);

      await this.supabaseAdmin.from("meeting").update({ status: "failed" }).eq("id", meetingId);
    }

    return { status: 200, body: { ok: true } };
  }

  async listMeetings(accountId = null) {
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }

    const meetingsRes = await this.supabaseAdmin
      .from("meeting")
      .select("id,account_id,title,topic,status,created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (meetingsRes.error) {
      return { status: 500, body: { detail: `Loi truy van meeting: ${meetingsRes.error.message}` } };
    }

    const meetingRows = meetingsRes.data || [];
    const meetingIds = meetingRows
      .map((row) => String(row?.id || "").trim())
      .filter((id) => this.validationHelper.isValidUuid(id));

    let audioInfoByMeetingId = {};
    try {
      audioInfoByMeetingId = await this.buildMeetingAudioInfoById(meetingIds);
    } catch (err) {
      return { status: 500, body: { detail: `Loi truy van audio_file: ${err.message}` } };
    }

    const meetings = meetingRows.map((row) =>
      this.formatMeetingRow(row, audioInfoByMeetingId[String(row?.id || "").trim()] || null)
    );

    return { status: 200, body: { meetings } };
  }

  async updateMeetingTitle({ accountId, meetingId, title }) {
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }
    if (!this.validationHelper.isValidUuid(meetingId)) {
      return { status: 400, body: { detail: "Invalid meeting id" } };
    }

    const normalizedTitle = String(title || "").trim();
    if (!normalizedTitle) {
      return { status: 400, body: { detail: "Title is required." } };
    }

    const updateRes = await this.supabaseAdmin
      .from("meeting")
      .update({ title: normalizedTitle })
      .eq("id", meetingId)
      .eq("account_id", accountId)
      .select("id,account_id,title,topic,status,created_at")
      .single();

    if (updateRes.error) {
      const msg = String(updateRes.error.message || "");
      if (msg.toLowerCase().includes("no rows")) {
        return { status: 404, body: { detail: "Khong tim thay meeting." } };
      }
      return { status: 500, body: { detail: `Loi cap nhat meeting: ${updateRes.error.message}` } };
    }

    return { status: 200, body: { meeting: this.formatMeetingRow(updateRes.data, null) } };
  }

  async readStoredMeetingSummary(meetingId) {
    let meetingSummary = "";
    let meetingQueryErr = null;

    try {
      const meetingRes = await this.supabaseAdmin
        .from("meeting")
        .select("summary")
        .eq("id", meetingId)
        .limit(1);
      if (!meetingRes.error) {
        meetingSummary = String((meetingRes.data || [])[0]?.summary || "").trim();
        if (meetingSummary) {
          return meetingSummary;
        }
      } else {
        meetingQueryErr = meetingRes.error;
      }
    } catch (err) {
      meetingQueryErr = err;
    }

    if (meetingQueryErr && !this.validationHelper.isMissingSummaryStorageError(meetingQueryErr)) {
      throw new Error(meetingQueryErr.message || "Loi doc summary tu meeting.");
    }

    const summaryRes = await this.supabaseAdmin
      .from("meeting_summary")
      .select("summary,created_at")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (summaryRes.error) {
      throw new Error(summaryRes.error.message || "Loi doc summary.");
    }

    return String((summaryRes.data || [])[0]?.summary || "").trim();
  }

  async persistMeetingSummary({ meetingId, summary }) {
    const text = String(summary || "").trim();

    const meetingUpd = await this.supabaseAdmin
      .from("meeting")
      .update({ summary: text })
      .eq("id", meetingId);

    if (!meetingUpd.error) {
      return;
    }

    if (!this.validationHelper.isMissingSummaryStorageError(meetingUpd.error)) {
      throw new Error(`Khong luu duoc summary vao meeting: ${meetingUpd.error.message}`);
    }

    const existedRes = await this.supabaseAdmin
      .from("meeting_summary")
      .select("id")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: false })
      .limit(1);

    if (existedRes.error) {
      throw new Error(`Khong doc duoc meeting_summary: ${existedRes.error.message}`);
    }

    const existedId = String((existedRes.data || [])[0]?.id || "").trim();
    if (this.validationHelper.isValidUuid(existedId)) {
      const updRes = await this.supabaseAdmin
        .from("meeting_summary")
        .update({ summary: text })
        .eq("id", existedId);

      if (updRes.error) {
        throw new Error(`Khong cap nhat duoc meeting_summary: ${updRes.error.message}`);
      }
      return;
    }

    const insRes = await this.supabaseAdmin
      .from("meeting_summary")
      .insert({
        meeting_id: meetingId,
        summary: text,
        created_at: new Date().toISOString(),
      });

    if (insRes.error) {
      throw new Error(`Khong luu duoc summary vao database: ${insRes.error.message}`);
    }
  }

  async generateMeetingSummary({ accountId, meetingId, force = false }) {
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }
    if (!this.validationHelper.isValidUuid(meetingId)) {
      return { status: 400, body: { detail: "Invalid meeting id" } };
    }

    const meetingRes = await this.supabaseAdmin
      .from("meeting")
      .select("id,title")
      .eq("id", meetingId)
      .eq("account_id", accountId)
      .limit(1);
    if (meetingRes.error) {
      return { status: 500, body: { detail: `Loi truy van meeting: ${meetingRes.error.message}` } };
    }
    const meeting = (meetingRes.data || [])[0] || null;
    if (!meeting) {
      return { status: 404, body: { detail: "Khong tim thay meeting." } };
    }

    if (!force) {
      try {
        const existingSummary = await this.readStoredMeetingSummary(meetingId);
        if (existingSummary) {
          return {
            status: 200,
            body: {
              meeting_id: meetingId,
              title: String(meeting?.title || "").trim() || "Untitled",
              summary: existingSummary,
              cached: true,
            },
          };
        }
      } catch (err) {
        return { status: 500, body: { detail: `Loi doc summary: ${err.message}` } };
      }
    }

    const segRes = await this.supabaseAdmin
      .from("transcript_segment")
      .select("content,start_time")
      .eq("meeting_id", meetingId)
      .order("start_time", { ascending: true });
    if (segRes.error) {
      return { status: 500, body: { detail: `Loi truy van transcript_segment: ${segRes.error.message}` } };
    }

    const fullText = (segRes.data || [])
      .map((row) => String(row?.content || "").trim())
      .filter((text) => text.length > 0)
      .join(" ");

    if (!fullText) {
      return { status: 400, body: { detail: "Meeting chua co noi dung transcript de tom tat." } };
    }

    let summary = "";
    try {
      summary = await this.aiTextService.computeTextSummaryViaQueue(fullText);
    } catch (err) {
      return { status: 500, body: { detail: `Khong tao duoc summary: ${err.message}` } };
    }

    try {
      await this.persistMeetingSummary({ meetingId, summary });
    } catch (err) {
      return { status: 500, body: { detail: err.message || "Khong luu duoc summary." } };
    }

    return {
      status: 200,
      body: {
        meeting_id: meetingId,
        title: String(meeting?.title || "").trim() || "Untitled",
        summary,
        cached: false,
      },
    };
  }

  async semanticSearchMeetings({ accountId, query, topK = 30, candidateLimit = 4000 }) {
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }

    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) {
      return { status: 400, body: { detail: "Query is required." } };
    }

    const meetingsRes = await this.supabaseAdmin
      .from("meeting")
      .select("id")
      .eq("account_id", accountId)
      .limit(2000);

    if (meetingsRes.error) {
      return { status: 500, body: { detail: `Loi truy van meeting: ${meetingsRes.error.message}` } };
    }

    const meetingIds = (meetingsRes.data || [])
      .map((x) => String(x?.id || "").trim())
      .filter((id) => this.validationHelper.isValidUuid(id));

    if (!meetingIds.length) {
      return { status: 200, body: { items: [] } };
    }

    let queryEmbedding;
    try {
      queryEmbedding = await this.aiTextService.computeTextEmbedding(normalizedQuery);
    } catch (err) {
      return { status: 400, body: { detail: `Khong tao duoc query embedding: ${err.message}` } };
    }

    let idxRes = await this.supabaseAdmin
      .from("search_index")
      .select("meeting_id,transcript_segment_id,embedding_vector,created_at")
      .in("meeting_id", meetingIds)
      .order("created_at", { ascending: false })
      .limit(Math.max(1, Number(candidateLimit) || 4000));

    if (idxRes.error) {
      idxRes = await this.supabaseAdmin
        .from("search_index")
        .select("meeting_id,transcript_segment_id,embedding_vector")
        .in("meeting_id", meetingIds)
        .limit(Math.max(1, Number(candidateLimit) || 4000));
    }

    if (idxRes.error) {
      return { status: 500, body: { detail: `Loi truy van search_index: ${idxRes.error.message}` } };
    }

    const bestByMeetingId = new Map();
    for (const row of idxRes.data || []) {
      const meetingId = String(row?.meeting_id || "").trim();
      if (!this.validationHelper.isValidUuid(meetingId)) {
        continue;
      }

      const emb = this.validationHelper.parseEmbedding(row?.embedding_vector);
      if (!emb || emb.length !== queryEmbedding.length) {
        continue;
      }

      const score = this.validationHelper.computeCosineSimilarity(queryEmbedding, emb);
      if (!Number.isFinite(score)) {
        continue;
      }

      const prev = bestByMeetingId.get(meetingId);
      if (!prev || score > prev.score) {
        bestByMeetingId.set(meetingId, {
          meeting_id: meetingId,
          transcript_segment_id: row?.transcript_segment_id || null,
          score,
        });
      }
    }

    const items = Array.from(bestByMeetingId.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Number(topK) || 30))
      .map((item) => ({
        meeting_id: item.meeting_id,
        transcript_segment_id: item.transcript_segment_id,
        score: Number(item.score.toFixed(6)),
      }));

    return {
      status: 200,
      body: {
        items,
        meta: {
          candidate_rows: (idxRes.data || []).length,
          matched_meetings: bestByMeetingId.size,
        },
      },
    };
  }

  async semanticSearchMeetingById({ accountId, meetingId, query, threshold = 0.2 }) {
    if (!accountId) return { status: 401, body: { detail: "Unauthorized" } };
    if (!this.validationHelper.isValidUuid(meetingId)) return { status: 400, body: { detail: "Invalid meeting id" } };

    const normalizedQuery = String(query || "").trim();
    if (!normalizedQuery) return { status: 200, body: { items: [] } };

    const meetingRes = await this.supabaseAdmin.from("meeting").select("id").eq("id", meetingId).eq("account_id", accountId).limit(1);
    if (meetingRes.error || !meetingRes.data.length) return { status: 404, body: { detail: "Meeting not found" } };

    let queryEmbedding;
    try {
      queryEmbedding = await this.aiTextService.computeTextEmbedding(normalizedQuery);
    } catch (err) {
      return { status: 400, body: { detail: `Khong tao duoc query embedding: ${err.message}` } };
    }

    const idxRes = await this.supabaseAdmin
      .from("search_index")
      .select("transcript_segment_id,embedding_vector")
      .eq("meeting_id", meetingId)
      .limit(4000);

    if (idxRes.error) return { status: 500, body: { detail: `Loi truy van search_index: ${idxRes.error.message}` } };

    const matchedSegments = [];
    for (const row of idxRes.data || []) {
      const emb = this.validationHelper.parseEmbedding(row?.embedding_vector);
      if (!emb || emb.length !== queryEmbedding.length) continue;
      const score = this.validationHelper.computeCosineSimilarity(queryEmbedding, emb);
      if (Number.isFinite(score)) {
        if (row.transcript_segment_id) {
          matchedSegments.push({ id: row.transcript_segment_id, score });
        }
      }
    }

    matchedSegments.sort((a, b) => b.score - a.score);
    const topMatches = matchedSegments.slice(0, 1).map((match) => match.id);

    return { status: 200, body: { items: topMatches } };
  }

  async getMeetingResult(meetingId, accountId = null) {
    if (!this.validationHelper.isValidUuid(meetingId)) {
      return { status: 400, body: { detail: "Invalid meeting id" } };
    }
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }

    const meetingRes = await this.supabaseAdmin
      .from("meeting")
      .select("id,status,topic,created_at")
      .eq("id", meetingId)
      .eq("account_id", accountId)
      .limit(1);
    if (meetingRes.error) {
      return { status: 500, body: { detail: `Loi truy van meeting: ${meetingRes.error.message}` } };
    }

    const meeting = (meetingRes.data || [])[0];
    if (!meeting) {
      return { status: 404, body: { detail: "Khong tim thay audio." } };
    }

    let audioRes = await this.supabaseAdmin
      .from("audio_file")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (audioRes.error) {
      audioRes = await this.supabaseAdmin.from("audio_file").select("*").eq("meeting_id", meetingId).limit(1);
    }

    const segRes = await this.supabaseAdmin
      .from("transcript_segment")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("start_time", { ascending: true });

    if (audioRes.error) {
      return { status: 500, body: { detail: `Loi truy van audio file: ${audioRes.error.message}` } };
    }
    if (segRes.error) {
      return { status: 500, body: { detail: `Loi truy van transcript: ${segRes.error.message}` } };
    }

    const audioFile = (audioRes.data || [])[0] || null;

    let latestJob = null;
    try {
      const jobRes = await this.supabaseAdmin
        .from("processing_job")
        .select("id,status,started_at,completed_at")
        .eq("meeting_id", meetingId)
        .order("started_at", { ascending: false })
        .limit(1);
      if (!jobRes.error) {
        latestJob = (jobRes.data || [])[0] || null;
      }
    } catch (err) {
      latestJob = null;
    }

    const uploadStartedAt = meeting?.created_at || latestJob?.started_at || null;
    const processingCompletedAt = latestJob?.completed_at || null;
    const elapsedSeconds = this.dateTimeHelper.computeElapsedSeconds(uploadStartedAt, processingCompletedAt);

    const segRows = segRes.data || [];
    const speakerIds = Array.from(
      new Set(
        segRows
          .map((seg) => String(seg?.speaker_id || "").trim())
          .filter((id) => this.validationHelper.isValidUuid(id))
      )
    );

    const speakerNameBySpeakerId = {};
    if (speakerIds.length) {
      const spRes = await this.supabaseAdmin
        .from("speaker")
        .select("id,voice_sample_id,is_identified")
        .in("id", speakerIds);
      if (spRes.error) {
        return { status: 500, body: { detail: `Loi truy van speaker: ${spRes.error.message}` } };
      }

      const voiceSampleIds = Array.from(
        new Set((spRes.data || []).map((row) => String(row?.voice_sample_id || "").trim()).filter((id) => this.validationHelper.isValidUuid(id)))
      );

      const voiceSampleNameById = {};
      if (voiceSampleIds.length) {
        const vsRes = await this.supabaseAdmin
          .from("voice_sample")
          .select("id,speaker_name,account_id")
          .in("id", voiceSampleIds);
        if (vsRes.error) {
          return { status: 500, body: { detail: `Loi truy van voice_sample: ${vsRes.error.message}` } };
        }

        const accountIds = Array.from(
          new Set((vsRes.data || []).map((row) => String(row?.account_id || "").trim()).filter((id) => this.validationHelper.isValidUuid(id)))
        );

        const accountNameById = {};
        if (accountIds.length) {
          const accRes = await this.supabaseAdmin.from("account").select("id,full_name").in("id", accountIds);
          if (accRes.error) {
            return { status: 500, body: { detail: `Loi truy van account: ${accRes.error.message}` } };
          }
          for (const a of accRes.data || []) {
            if (a?.id) accountNameById[a.id] = String(a.full_name || "").trim();
          }
        }

        for (const v of vsRes.data || []) {
          if (!v?.id) continue;
          const speakerName = String(v?.speaker_name || "").trim();
          const accountName = String(accountNameById[v?.account_id] || "").trim();
          voiceSampleNameById[v.id] = speakerName || accountName || "UNKNOWN";
        }
      }

      for (const s of spRes.data || []) {
        if (!s?.id) continue;
        const label = s?.voice_sample_id ? (voiceSampleNameById[s.voice_sample_id] || "UNKNOWN") : "UNKNOWN";
        speakerNameBySpeakerId[s.id] = label;
      }
    }

    const unknownLabelBySpeakerId = {};
    let unknownCounter = 0;
    for (const seg of segRows) {
      const sid = String(seg?.speaker_id || "").trim();
      if (!sid) continue;
      const baseLabel = String(speakerNameBySpeakerId[sid] || "UNKNOWN").trim() || "UNKNOWN";
      if (baseLabel !== "UNKNOWN") continue;
      if (!unknownLabelBySpeakerId[sid]) {
        unknownCounter += 1;
        unknownLabelBySpeakerId[sid] = `Speaker ${unknownCounter}`;
      }
    }

    return {
      status: 200,
      body: {
        audio: {
          audio_id: meeting.id,
          filename: audioFile?.file_url || null,
          status: meeting.status,
          processing_time: {
            upload_started_at: uploadStartedAt,
            completed_at: processingCompletedAt,
            elapsed_seconds: elapsedSeconds,
          },
          analysis_data: {
            topic_name: meeting.topic || "UNKNOWN",
            search_content: [],
          },
        },
        segments: segRows.map((seg) => ({
          id: seg.id,
          audio_id: seg.meeting_id,
          speaker_label: String(
            unknownLabelBySpeakerId[seg.speaker_id] ||
            speakerNameBySpeakerId[seg.speaker_id] ||
            "UNKNOWN"
          ),
          start_time: seg.start_time,
          end_time: seg.end_time,
          content: seg.content,
        })),
      },
    };
  }

  async getMeetingStatus(meetingId, accountId = null) {
    if (!this.validationHelper.isValidUuid(meetingId)) {
      return { status: 400, body: { detail: "Invalid meeting id" } };
    }
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }

    const meetingRes = await this.supabaseAdmin
      .from("meeting")
      .select("id,status,topic,created_at")
      .eq("id", meetingId)
      .eq("account_id", accountId)
      .limit(1);
    if (meetingRes.error) {
      return { status: 500, body: { detail: `Loi truy van meeting: ${meetingRes.error.message}` } };
    }

    const meeting = (meetingRes.data || [])[0];
    if (!meeting) {
      return { status: 404, body: { detail: "Khong tim thay audio." } };
    }

    const jobRes = await this.supabaseAdmin
      .from("processing_job")
      .select("id,status,progress_percent,started_at,completed_at,error_message")
      .eq("meeting_id", meetingId)
      .order("started_at", { ascending: false })
      .limit(1);

    if (jobRes.error) {
      return { status: 500, body: { detail: `Loi truy van job: ${jobRes.error.message}` } };
    }

    const job = (jobRes.data || [])[0] || null;
    const uploadStartedAt = meeting?.created_at || job?.started_at || null;
    const processingCompletedAt = job?.completed_at || null;
    const elapsedSeconds = this.dateTimeHelper.computeElapsedSeconds(uploadStartedAt, processingCompletedAt);
    let steps = [];
    if (job?.id) {
      const stepRes = await this.supabaseAdmin
        .from("processing_step")
        .select("step_name,step_order,status,started_at,completed_at,error_message")
        .eq("job_id", job.id)
        .order("step_order", { ascending: true });
      if (stepRes.error) {
        return { status: 500, body: { detail: `Loi truy van steps: ${stepRes.error.message}` } };
      }
      steps = stepRes.data || [];
    }

    return {
      status: 200,
      body: {
        meeting_id: meetingId,
        meeting_status: meeting.status,
        job,
        processing_time: {
          upload_started_at: uploadStartedAt,
          completed_at: processingCompletedAt,
          elapsed_seconds: elapsedSeconds,
        },
        current_message: job?.error_message || "",
        steps,
      },
    };
  }
}

module.exports = MeetingService;
