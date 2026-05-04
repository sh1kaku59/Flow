class UserService {
  constructor(config, supabaseAdminClient, storageHelper, validationHelper) {
    this.config = config;
    this.supabaseAdmin = supabaseAdminClient;
    this.storageHelper = storageHelper;
    this.validationHelper = validationHelper;
  }

  async updateUserAvatar({ accountId, avatar }) {
    if (!accountId) return { status: 401, body: { detail: "Unauthorized" } };
    if (!avatar || !avatar.buffer?.length) return { status: 400, body: { detail: "Avatar file required." } };
    if (!avatar.mimetype || !avatar.mimetype.startsWith("image/")) {
      return { status: 400, body: { detail: "avatar phai la file anh." } };
    }
    let avatarObjectName = null;
    try {
      avatarObjectName = this.storageHelper.buildStorageObjectName(accountId, avatar.originalname || "avatar.png", "png");
      const avatarUp = await this.supabaseAdmin.storage.from(this.config.avatarBucket).upload(avatarObjectName, avatar.buffer, {
        contentType: avatar.mimetype || "image/png",
        upsert: true,
      });
      if (avatarUp.error) throw new Error(avatarUp.error.message);

      await this.supabaseAdmin.from("account").update({ avatar_url: avatarObjectName }).eq("id", accountId);

      const { data: authUser } = await this.supabaseAdmin.auth.admin.getUserById(accountId);
      if (authUser?.user) {
        await this.supabaseAdmin.auth.admin.updateUserById(accountId, {
          user_metadata: { ...authUser.user.user_metadata, avatar_storage_path: avatarObjectName }
        });
      }

      const signedUrlRes = await this.storageHelper.createSignedUrlSafe(this.supabaseAdmin, this.config.avatarBucket, avatarObjectName);
      return { status: 200, body: { avatar_url: signedUrlRes || avatarObjectName } };
    } catch (err) {
      return { status: 500, body: { detail: `Loi cap nhat avatar: ${err.message}` } };
    }
  }

  async updateUserProfile({ accountId, name, email, dob }) {
    if (!accountId) return { status: 401, body: { detail: "Unauthorized" } };

    const updates = {};
    if (name !== undefined) updates.full_name = String(name || "").trim();
    if (dob !== undefined) updates.date_of_birth = this.storageHelper.normalizeDateOfBirth(dob) || null;

    if (email !== undefined && String(email).trim().length > 0) {
      updates.email = String(email || "").trim().toLowerCase();
    }

    if (Object.keys(updates).length === 0) {
      return { status: 400, body: { detail: "No fields to update." } };
    }

    if (updates.email) {
      const { error: authErr } = await this.supabaseAdmin.auth.admin.updateUserById(accountId, { email: updates.email });
      if (authErr) {
        return { status: 400, body: { detail: `Loi cap nhat email: ${authErr.message}` } };
      }
    }

    const { error } = await this.supabaseAdmin.from("account").update(updates).eq("id", accountId);
    if (error) {
      return { status: 500, body: { detail: `Loi cap nhat profile: ${error.message}` } };
    }

    if (updates.full_name !== undefined) {
      try {
        const authUserRes = await this.supabaseAdmin.auth.admin.getUserById(accountId);
        const existingMeta = authUserRes?.data?.user?.user_metadata || {};
        await this.supabaseAdmin.auth.admin.updateUserById(accountId, {
          user_metadata: { ...existingMeta, full_name: updates.full_name }
        });
      } catch (err) {
        // ignore
      }
    }

    return { status: 200, body: { ok: true } };
  }
}

module.exports = UserService;
