const axios = require("axios");
const FormData = require("form-data");
const crypto = require("crypto");

class QueueWorkerService {
  constructor(config, supabaseAdminClient, queueManager, validationHelper, aiTextService, storageHelper) {
    this.config = config;
    this.supabaseAdmin = supabaseAdminClient;
    this.queueManager = queueManager;
    this.validationHelper = validationHelper;
    this.aiTextService = aiTextService;
    this.storageHelper = storageHelper;
  }

  async loadSpeakerEmbeddings({ accountId = null, maxUsers = 500 } = {}) {
    let usersQuery = this.supabaseAdmin.from("account").select("id,full_name");
    if (accountId && this.validationHelper.isValidUuid(accountId)) {
      usersQuery = usersQuery.eq("id", accountId);
    } else {
      usersQuery = usersQuery.limit(maxUsers);
    }

    const usersRes = await usersQuery;
    if (usersRes.error) throw new Error(usersRes.error.message);

    const users = usersRes.data || [];
    if (!users.length) return {};

    const allowedAccountIds = new Set(users.map((u) => String(u?.id || "").trim()).filter((x) => this.validationHelper.isValidUuid(x)));
    if (!allowedAccountIds.size) return {};

    const accountNameById = {};
    for (const user of users) {
      if (user?.id) accountNameById[user.id] = String(user.full_name || "").trim();
    }

    let samplesRes = await this.supabaseAdmin
      .from("voice_sample")
      .select("id,account_id,speaker_name,embedding_vector,created_at")
      .order("created_at", { ascending: false });

    if (samplesRes.error) {
      samplesRes = await this.supabaseAdmin.from("voice_sample").select("id,account_id,speaker_name,embedding_vector");
      if (samplesRes.error) throw new Error(samplesRes.error.message);
    }

    const speakerEmbeddings = {};
    for (const sample of samplesRes.data || []) {
      const accountIdValue = String(sample?.account_id || "").trim();
      const sampleId = String(sample?.id || "").trim();
      if (!this.validationHelper.isValidUuid(accountIdValue) || !allowedAccountIds.has(accountIdValue)) continue;
      if (!this.validationHelper.isValidUuid(sampleId)) continue;

      const vector = this.validationHelper.parseEmbedding(sample?.embedding_vector);
      if (!vector || !vector.length) continue;

      const speakerName = String(sample?.speaker_name || "").trim();
      const fullName = String(accountNameById[accountIdValue] || "").trim();
      const displayName = speakerName || fullName || `speaker_${sampleId.slice(0, 8)}`;
      const key = `${displayName}|${accountIdValue}|${sampleId}`;
      speakerEmbeddings[key] = vector;
    }

    return speakerEmbeddings;
  }

  async persistMeetingAnalysisResult({ meetingId, jobId, result }) {
    const sourceDuration = Number(result?.audio?.duration_seconds || 0);
    const analysis = result.analysis || {};
    const topic = analysis.topic_name || null;
    const segments = Array.isArray(result.segments) ? result.segments : [];

    const matchedVoiceSampleIds = Array.from(
      new Set(
        segments
          .map((s) => String(s?.matched_key || ""))
          .filter((k) => k.includes("|"))
          .map((k) => k.split("|").pop()?.trim() || "")
          .filter((x) => this.validationHelper.isValidUuid(x))
      )
    );

    const knownVoiceSampleIds = new Set();
    if (matchedVoiceSampleIds.length) {
      const voiceRes = await this.supabaseAdmin.from("voice_sample").select("id").in("id", matchedVoiceSampleIds);
      if (voiceRes.error) throw new Error(voiceRes.error.message);
      for (const row of voiceRes.data || []) {
        const id = String(row?.id || "").trim();
        if (this.validationHelper.isValidUuid(id)) knownVoiceSampleIds.add(id);
      }
    }

    const segmentSpeakerMeta = [];
    const labelMeta = new Map();
    const speakerIdByLabel = new Map();
    let transcriptSegmentIdsByIndex = [];

    if (segments.length) {
      for (const segment of segments) {
        const matchedKey = String(segment?.matched_key || "");
        const matchedTail = matchedKey.includes("|") ? matchedKey.split("|").pop()?.trim() : "";
        const voiceSampleId = this.validationHelper.isValidUuid(matchedTail) && knownVoiceSampleIds.has(matchedTail) ? matchedTail : null;
        const identified = Boolean(segment?.is_identified) && Boolean(voiceSampleId);
        const diarLabel = String(segment?.diarization_label || segment?.speaker || "UNKNOWN").trim() || "UNKNOWN";
        segmentSpeakerMeta.push({ diarLabel });
        const existing = labelMeta.get(diarLabel) || { voiceSampleId: null, identified: false };
        if (!existing.identified && identified) {
          existing.voiceSampleId = voiceSampleId;
          existing.identified = true;
        }
        labelMeta.set(diarLabel, existing);
      }

      for (const [diarLabel, meta] of labelMeta.entries()) {
        const speakerInsert = await this.supabaseAdmin
          .from("speaker")
          .insert({
            meeting_id: meetingId,
            voice_sample_id: meta.identified ? meta.voiceSampleId : null,
            is_identified: Boolean(meta.identified),
          })
          .select("id")
          .single();
        if (speakerInsert.error) throw new Error(speakerInsert.error.message);
        speakerIdByLabel.set(diarLabel, speakerInsert.data?.id || null);
      }

      const transcriptRows = segments.map((segment, index) => {
        const meta = segmentSpeakerMeta[index] || {};
        const speakerId = meta?.diarLabel ? speakerIdByLabel.get(meta.diarLabel) || null : null;
        return {
          meeting_id: meetingId,
          speaker_id: speakerId,
          content: segment.text || "",
          start_time: segment.start || 0,
          end_time: segment.end || 0,
        };
      });

      const segmentInsert = await this.supabaseAdmin.from("transcript_segment").insert(transcriptRows).select("id");
      if (segmentInsert.error) throw new Error(segmentInsert.error.message);
      transcriptSegmentIdsByIndex = Array.isArray(segmentInsert.data)
        ? segmentInsert.data.map((row) => String(row?.id || "").trim() || null)
        : [];

      const semantic = Array.isArray(result.semantic_segments) ? result.semantic_segments : [];
      if (semantic.length) {
        const semanticRows = semantic.map((segment) => ({
          meeting_id: meetingId,
          content: segment.content || "",
          start_time: segment.start_time || 0,
          end_time: segment.end_time || 0,
        }));
        const semanticInsert = await this.supabaseAdmin.from("semantic_segment").insert(semanticRows);
        if (semanticInsert.error) {
          console.warn("semantic_segment insert failed:", semanticInsert.error.message);
        }
      }

      const statistics = Array.isArray(result.speaker_statistics) ? result.speaker_statistics : [];
      if (statistics.length) {
        const statRows = [];
        for (const row of statistics) {
          let speakerId = null;
          const label = String(row.speaker || "").trim();
          if (label && speakerIdByLabel.has(label)) speakerId = speakerIdByLabel.get(label) || null;
          statRows.push({
            meeting_id: meetingId,
            speaker_id: speakerId,
            lively_discussion: Number.isFinite(Number(row.lively_discussion)) ? Number(row.lively_discussion) : 0,
            number_of_speech: Number.isFinite(Number(row.number_of_speech)) ? Number(row.number_of_speech) : 0,
          });
        }
        const statInsert = await this.supabaseAdmin.from("speaker_statistic").insert(statRows);
        if (statInsert.error) {
          console.warn("speaker_statistic insert failed:", statInsert.error.message);
        }
      }
    }

    const searchIndex = result.search_index || {};
    const items = Array.isArray(searchIndex.items) ? searchIndex.items : [];
    const expectedSearchDim = Number(searchIndex.embedding_dim || 0);
    if (items.length) {
      const searchRows = [];
      for (const item of items) {
        const embedding = this.validationHelper.parseEmbedding(item.embedding_vector || item.embedding || null);
        if (!embedding || !embedding.length) continue;
        if (Number.isFinite(expectedSearchDim) && expectedSearchDim > 0 && embedding.length !== expectedSearchDim) continue;
        const sourceIndex = Number(item?.transcript_segment_index);
        const transcriptSegmentId =
          Number.isInteger(sourceIndex) && sourceIndex >= 0 && sourceIndex < transcriptSegmentIdsByIndex.length
            ? transcriptSegmentIdsByIndex[sourceIndex]
            : null;

        searchRows.push({
          meeting_id: meetingId,
          transcript_segment_id: transcriptSegmentId,
          embedding_vector: this.validationHelper.toPgvectorLiteral(embedding),
          created_at: new Date().toISOString(),
        });
      }

      if (searchRows.length) {
        const indexInsert = await this.supabaseAdmin.from("search_index").insert(searchRows);
        if (indexInsert.error) throw new Error(`search_index insert failed: ${indexInsert.error.message}`);
      }
    }

    const audioUpdate = await this.supabaseAdmin
      .from("audio_file")
      .update({ duration: Number.isFinite(sourceDuration) && sourceDuration > 0 ? sourceDuration : 0 })
      .eq("meeting_id", meetingId);
    if (audioUpdate.error) throw new Error(audioUpdate.error.message);

    const meetingUpdate = await this.supabaseAdmin.from("meeting").update({ status: "completed", topic }).eq("id", meetingId);
    if (meetingUpdate.error) throw new Error(meetingUpdate.error.message);

    await this.supabaseAdmin
      .from("processing_job")
      .update({
        status: "completed",
        progress_percent: 100,
        completed_at: new Date().toISOString(),
        error_message: "Da hoan tat tat ca buoc xu ly",
      })
      .eq("id", jobId);

    await this.supabaseAdmin
      .from("processing_step")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("job_id", jobId)
      .in("status", ["processing", "pending"]);
  }

  async markMeetingPipelineFailed(meetingId, jobId, err) {
    await this.supabaseAdmin.from("meeting").update({ status: "failed" }).eq("id", meetingId);
    await this.supabaseAdmin
      .from("processing_job")
      .update({
        status: "failed",
        error_message: String(err?.message || err),
        completed_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    await this.supabaseAdmin
      .from("processing_step")
      .update({
        status: "failed",
        error_message: String(err?.message || err),
        completed_at: new Date().toISOString(),
      })
      .eq("job_id", jobId)
      .eq("status", "processing");
  }

  async queuePreprocessingJob(payload) {
    const meetingId = String(payload?.meetingId || "").trim();
    const jobId = String(payload?.jobId || "").trim();
    const accountId = payload?.accountId || null;
    const filePayload = payload?.file || {};
    const file = {
      originalname: String(filePayload.originalname || "meeting.wav"),
      mimetype: String(filePayload.mimetype || "audio/wav"),
      size: Number(filePayload.size || 0),
      buffer: Buffer.from(String(filePayload.bufferBase64 || ""), "base64"),
    };

    if (!meetingId || !jobId) throw new Error("Invalid preprocessing payload.");
    if (!file.buffer?.length) throw new Error("Invalid preprocessing payload file.");

    try {
      const extRaw = (file.originalname || "meeting.wav").split(".").pop() || "wav";
      const ext = extRaw.toLowerCase();
      const ts = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
      const objectName = `${meetingId}/${ts}_${crypto.randomUUID().replace(/-/g, "")}.${ext}`;

      const storageRes = await this.supabaseAdmin.storage
        .from(this.config.meetingAudioBucket)
        .upload(objectName, file.buffer, { contentType: file.mimetype, upsert: false });
      if (storageRes.error) throw new Error(storageRes.error.message);

      const audioInsert = await this.supabaseAdmin.from("audio_file").insert({
        meeting_id: meetingId,
        file_url: objectName,
        file_size: file.size || file.buffer.length,
        format: file.mimetype,
      });
      if (audioInsert.error) throw new Error(audioInsert.error.message);

      let speakerEmbeddings = {};
      try {
        speakerEmbeddings = await this.loadSpeakerEmbeddings({ accountId });
      } catch (_err) {
        speakerEmbeddings = {};
      }

      const candidateCount = Object.keys(speakerEmbeddings || {}).length;
      const minSpeakersHint = candidateCount >= 3 ? 3 : Math.max(1, candidateCount || 1);
      const maxSpeakersHint = Math.min(6, candidateCount >= 3 ? 4 : Math.max(minSpeakersHint, (candidateCount || 1) + 1));

      const form = new FormData();
      form.append("audio", file.buffer, {
        filename: file.originalname || "meeting.wav",
        contentType: file.mimetype || "audio/wav",
      });
      form.append("metadata", JSON.stringify({
        meeting_id: meetingId,
        speaker_embeddings: speakerEmbeddings,
        min_speakers: minSpeakersHint,
        max_speakers: maxSpeakersHint,
        progress_callback_url: this.config.backendCallbackUrl,
      }));

      const preRes = await axios.post(`${this.config.aiServiceUrl}/process-meeting/preprocessing`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 0,
      });

      const artifactId = String(preRes?.data?.artifact_id || "").trim();
      if (!artifactId) throw new Error("Missing artifact_id from preprocessing");

      await this.queueManager.enqueue(this.queueManager.QUEUES.STT, { meetingId, jobId, accountId, artifactId });
      return { enqueued: "stt", meetingId, jobId, artifactId };
    } catch (err) {
      await this.markMeetingPipelineFailed(meetingId, jobId, err);
      throw err;
    }
  }

  async queueSttJob(payload) {
    const meetingId = String(payload?.meetingId || "").trim();
    const jobId = String(payload?.jobId || "").trim();
    const accountId = payload?.accountId || null;
    const artifactId = String(payload?.artifactId || "").trim();

    if (!meetingId || !jobId) throw new Error("Invalid stt payload.");
    if (!artifactId) throw new Error("Missing artifact_id for stt");

    try {
      await axios.post(
        `${this.config.aiServiceUrl}/process-meeting/stt`,
        { artifact_id: artifactId },
        { headers: { "Content-Type": "application/json" }, timeout: 0 }
      );

      await this.queueManager.enqueue(this.queueManager.QUEUES.ANALYSIS, { meetingId, jobId, accountId, artifactId });
      return { enqueued: "analysis", meetingId, jobId, artifactId };
    } catch (err) {
      await this.markMeetingPipelineFailed(meetingId, jobId, err);
      throw err;
    }
  }

  async queueAnalysisJob(payload) {
    const meetingId = String(payload?.meetingId || "").trim();
    const jobId = String(payload?.jobId || "").trim();
    const artifactId = String(payload?.artifactId || "").trim();

    if (!meetingId || !jobId || !artifactId) throw new Error("Invalid analysis payload.");

    try {
      const analysisRes = await axios.post(
        `${this.config.aiServiceUrl}/process-meeting/analysis`,
        { artifact_id: artifactId },
        { headers: { "Content-Type": "application/json" }, timeout: 0 }
      );

      await this.persistMeetingAnalysisResult({ meetingId, jobId, result: analysisRes?.data || {} });
      return { ok: true, meetingId, jobId };
    } catch (err) {
      await this.markMeetingPipelineFailed(meetingId, jobId, err);
      throw err;
    }
  }

  async queueVoiceEmbeddingJob(payload) {
    const mode = String(payload?.mode || "compute_only").trim();

    if (mode === "compute_only") {
      const raw = Buffer.from(String(payload?.bufferBase64 || ""), "base64");
      const voiceSample = {
        originalname: String(payload?.originalname || "sample.wav"),
        mimetype: String(payload?.mimetype || "audio/wav"),
        buffer: raw,
      };
      return this.aiTextService.computeEmbeddingFromAudio(voiceSample);
    }

    if (mode === "register_voice_sample" || mode === "create_voice_sample") {
      const accountId = String(payload?.accountId || "").trim();
      if (!accountId) throw new Error("Missing accountId");

      const voiceSamplePayload = payload?.voiceSample || {};
      const voiceSample = {
        originalname: String(voiceSamplePayload?.originalname || "sample.wav"),
        mimetype: String(voiceSamplePayload?.mimetype || "audio/wav"),
        buffer: Buffer.from(String(voiceSamplePayload?.bufferBase64 || ""), "base64"),
      };
      if (!voiceSample.buffer?.length) throw new Error("voiceSample empty");

      const embeddingResp = await this.aiTextService.computeEmbeddingFromAudio(voiceSample);
      const embeddingVector = embeddingResp.embedding;
      const voiceDuration = embeddingResp.duration;
      if (!Array.isArray(embeddingVector) || embeddingVector.length !== this.config.embeddingDim) {
        throw new Error(`Embedding dim ${embeddingVector?.length || 0} != EMBEDDING_DIM ${this.config.embeddingDim}`);
      }

      const audioObjectName = this.storageHelper.buildStorageObjectName(accountId, voiceSample.originalname || "sample.wav", "wav");
      const audioUpload = await this.supabaseAdmin.storage.from(this.config.voiceBucket).upload(audioObjectName, voiceSample.buffer, {
        contentType: voiceSample.mimetype || "audio/wav",
        upsert: false,
      });
      if (audioUpload.error) throw new Error(audioUpload.error.message);

      let avatarObjectName = null;
      const avatar = payload?.avatar || null;
      if (avatar && avatar.bufferBase64) {
        const avatarBuffer = Buffer.from(String(avatar.bufferBase64 || ""), "base64");
        if (avatarBuffer.length) {
          avatarObjectName = this.storageHelper.buildStorageObjectName(accountId, avatar.originalname || "avatar.png", "png");
          const avatarUpload = await this.supabaseAdmin.storage.from(this.config.avatarBucket).upload(avatarObjectName, avatarBuffer, {
            contentType: avatar.mimetype || "image/png",
            upsert: false,
          });
          if (avatarUpload.error) throw new Error(avatarUpload.error.message);
        }
      }

      const insertRes = await this.supabaseAdmin
        .from("voice_sample")
        .insert({
          account_id: accountId,
          file_url: audioObjectName,
          embedding_vector: this.validationHelper.toPgvectorLiteral(embeddingVector),
          duration: Number.isFinite(voiceDuration) && voiceDuration > 0 ? voiceDuration : 0,
          speaker_name: String(payload?.speakerName || "").trim() || null,
          avatar_url: avatarObjectName,
        })
        .select("id")
        .single();

      if (insertRes.error) throw new Error(insertRes.error.message);
      return { ok: true, voice_sample_id: insertRes.data?.id || null };
    }

    throw new Error(`Unknown voice embedding mode: ${mode}`);
  }

  async queueDiarySummaryJob(payload) {
    const text = String(payload?.text || "").trim();
    const summary = await this.aiTextService.computeTextSummary(text);
    return { summary };
  }
}

module.exports = QueueWorkerService;
