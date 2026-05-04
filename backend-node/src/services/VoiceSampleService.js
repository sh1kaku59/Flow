class VoiceSampleService {
  constructor(config, supabaseAdminClient, storageHelper, validationHelper, queueManager) {
    this.config = config;
    this.supabaseAdmin = supabaseAdminClient;
    this.storageHelper = storageHelper;
    this.validationHelper = validationHelper;
    this.queueManager = queueManager;
  }

  async formatVoiceSampleRow(row) {
    const audioUrl = await this.storageHelper.createSignedUrlSafe(this.supabaseAdmin, this.config.voiceBucket, row?.file_url || null);
    const avatarUrl = await this.storageHelper.createSignedUrlSafe(this.supabaseAdmin, this.config.avatarBucket, row?.avatar_url || null);
    return {
      id: row?.id || null,
      account_id: row?.account_id || null,
      speaker_name: String(row?.speaker_name || "").trim() || "",
      duration: Number(row?.duration || 0),
      file_url: row?.file_url || null,
      avatar_url: row?.avatar_url || null,
      created_at: row?.created_at || null,
      audio_url: audioUrl,
      avatar_signed_url: avatarUrl,
    };
  }

  async listVoiceSamples(accountId = null) {
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }

    const vsRes = await this.supabaseAdmin
      .from("voice_sample")
      .select("id,account_id,speaker_name,file_url,avatar_url,duration,created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });

    if (vsRes.error) {
      return { status: 500, body: { detail: `Loi truy van voice_sample: ${vsRes.error.message}` } };
    }

    const items = await Promise.all((vsRes.data || []).map((row) => this.formatVoiceSampleRow(row)));
    return { status: 200, body: { items } };
  }

  async createVoiceSample({ accountId, speakerName, voiceSample, avatar }) {
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }
    if (!voiceSample || !voiceSample.buffer || voiceSample.buffer.length === 0) {
      return { status: 400, body: { detail: "voiceSample khong hop le." } };
    }

    try {
      await this.queueManager.enqueue(this.queueManager.QUEUES.VOICE_EMBEDDING, {
        mode: "create_voice_sample",
        accountId,
        speakerName: String(speakerName || "").trim() || null,
        voiceSample: {
          originalname: voiceSample.originalname || "sample.wav",
          mimetype: voiceSample.mimetype || "audio/wav",
          bufferBase64: Buffer.from(voiceSample.buffer || Buffer.alloc(0)).toString("base64"),
        },
        avatar: avatar && avatar.buffer?.length ? {
          originalname: avatar.originalname || "avatar.png",
          mimetype: avatar.mimetype || "image/png",
          bufferBase64: Buffer.from(avatar.buffer).toString("base64"),
        } : null,
      });
      return { status: 202, body: { queued: true, status: "processing" } };
    } catch (err) {
      return { status: 500, body: { detail: `Loi tao voice sample: ${err.message}` } };
    }
  }

  async updateVoiceSample({ accountId, sampleId, speakerName, avatar }) {
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }
    if (!this.validationHelper.isValidUuid(sampleId)) {
      return { status: 400, body: { detail: "Invalid voice sample id" } };
    }

    const curRes = await this.supabaseAdmin
      .from("voice_sample")
      .select("id,account_id,speaker_name,file_url,avatar_url,duration,created_at")
      .eq("id", sampleId)
      .eq("account_id", accountId)
      .limit(1);
    if (curRes.error) {
      return { status: 500, body: { detail: `Loi truy van voice_sample: ${curRes.error.message}` } };
    }

    const current = (curRes.data || [])[0] || null;
    if (!current) {
      return { status: 404, body: { detail: "Khong tim thay voice sample." } };
    }

    const updates = {};
    if (typeof speakerName === "string") {
      updates.speaker_name = String(speakerName || "").trim() || null;
    }

    let newAvatarObjectName = null;
    try {
      if (avatar && avatar.buffer?.length) {
        if (!avatar.mimetype || !avatar.mimetype.startsWith("image/")) {
          return { status: 400, body: { detail: "avatar phai la file anh." } };
        }
        newAvatarObjectName = this.storageHelper.buildStorageObjectName(accountId, avatar.originalname || "avatar.png", "png");
        const avatarUp = await this.supabaseAdmin.storage.from(this.config.avatarBucket).upload(newAvatarObjectName, avatar.buffer, {
          contentType: avatar.mimetype || "image/png",
          upsert: false,
        });
        if (avatarUp.error) throw new Error(avatarUp.error.message);
        updates.avatar_url = newAvatarObjectName;
      }

      if (Object.keys(updates).length === 0) {
        const item = await this.formatVoiceSampleRow(current);
        return { status: 200, body: { item } };
      }

      const upd = await this.supabaseAdmin
        .from("voice_sample")
        .update(updates)
        .eq("id", sampleId)
        .eq("account_id", accountId)
        .select("id,account_id,speaker_name,file_url,avatar_url,duration,created_at")
        .single();
      if (upd.error) throw new Error(upd.error.message);

      if (newAvatarObjectName && current.avatar_url && current.avatar_url !== newAvatarObjectName) {
        try {
          await this.supabaseAdmin.storage.from(this.config.avatarBucket).remove([current.avatar_url]);
        } catch (err) {
          // best effort
        }
      }

      const item = await this.formatVoiceSampleRow(upd.data);
      return { status: 200, body: { item } };
    } catch (err) {
      if (newAvatarObjectName) {
        try {
          await this.supabaseAdmin.storage.from(this.config.avatarBucket).remove([newAvatarObjectName]);
        } catch (removeErr) {
          // best effort
        }
      }
      return { status: 500, body: { detail: `Loi cap nhat voice sample: ${err.message}` } };
    }
  }

  async deleteVoiceSample({ accountId, sampleId }) {
    if (!accountId) {
      return { status: 401, body: { detail: "Unauthorized" } };
    }
    if (!this.validationHelper.isValidUuid(sampleId)) {
      return { status: 400, body: { detail: "Invalid voice sample id" } };
    }

    const curRes = await this.supabaseAdmin
      .from("voice_sample")
      .select("id,file_url,avatar_url")
      .eq("id", sampleId)
      .eq("account_id", accountId)
      .limit(1);
    if (curRes.error) {
      return { status: 500, body: { detail: `Loi truy van voice_sample: ${curRes.error.message}` } };
    }

    const current = (curRes.data || [])[0] || null;
    if (!current) {
      return { status: 404, body: { detail: "Khong tim thay voice sample." } };
    }

    const delRes = await this.supabaseAdmin
      .from("voice_sample")
      .delete()
      .eq("id", sampleId)
      .eq("account_id", accountId);
    if (delRes.error) {
      return { status: 500, body: { detail: `Loi xoa voice_sample: ${delRes.error.message}` } };
    }

    if (current.file_url) {
      try {
        await this.supabaseAdmin.storage.from(this.config.voiceBucket).remove([current.file_url]);
      } catch (err) {
        // best effort
      }
    }
    if (current.avatar_url) {
      try {
        await this.supabaseAdmin.storage.from(this.config.avatarBucket).remove([current.avatar_url]);
      } catch (err) {
        // best effort
      }
    }

    return { status: 200, body: { ok: true } };
  }
}

module.exports = VoiceSampleService;
