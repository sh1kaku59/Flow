const axios = require("axios");
const crypto = require("crypto");
const { createClient } = require("@supabase/supabase-js");

class AuthService {
  constructor(config, supabaseAdminClient, validationHelper, cryptoHelper, storageHelper, queueManager) {
    this.config = config;
    this.supabaseAdmin = supabaseAdminClient;
    this.validationHelper = validationHelper;
    this.cryptoHelper = cryptoHelper;
    this.storageHelper = storageHelper;
    this.queueManager = queueManager;
  }

  createAuthClient() {
    return createClient(this.config.supabaseUrl, this.config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async register({ fullName, email, password, dateOfBirth, speakerName, voiceSample, avatar, language = "en" }) {
    if (!fullName || !email || !password || !dateOfBirth) {
      return { status: 400, body: { detail: "Thieu thong tin dang ky." } };
    }

    if (!voiceSample || !voiceSample.buffer || voiceSample.buffer.length === 0) {
      return { status: 400, body: { detail: "voiceSample khong hop le." } };
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalizedLanguage = String(language || "").toLowerCase().startsWith("vi") ? "vi" : "en";

    let accountId = null;
    let objectName = null;
    let avatarObjectName = null;

    try {
      const created = await this.supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (created.error) {
        const authErr = String(created.error.message || "");
        if (authErr.toLowerCase().includes("already")) {
          return { status: 409, body: { detail: "Email da ton tai." } };
        }
        throw new Error(authErr);
      }

      accountId = created.data?.user?.id || null;
      if (!accountId) {
        throw new Error("Khong lay duoc user_id tu Supabase Auth.");
      }

      const passwordHashPromise = this.cryptoHelper.hashPassword(password);
      const uploadPromises = [];

      if (avatar && avatar.buffer?.length) {
        const avatarExtRaw = (avatar.originalname || "avatar.png").split(".").pop() || "png";
        const avatarExt = avatarExtRaw.toLowerCase();
        const avatarTs = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
        avatarObjectName = `${accountId}/${avatarTs}_${crypto.randomUUID().replace(/-/g, "")}.${avatarExt}`;

        uploadPromises.push(
          this.supabaseAdmin.storage.from(this.config.avatarBucket).upload(avatarObjectName, avatar.buffer, {
            contentType: avatar.mimetype || "image/png",
            upsert: false,
          })
        );
      }

      const uploadResults = await Promise.all(uploadPromises);
      for (const uploadRes of uploadResults) {
        if (uploadRes.error) {
          throw new Error(uploadRes.error.message);
        }
      }

      const passwordHash = await passwordHashPromise;
      const accountIns = await this.supabaseAdmin.from("account").insert({
        id: accountId,
        email: normalizedEmail,
        password_hash: passwordHash,
        full_name: fullName,
        date_of_birth: dateOfBirth,
      });
      if (accountIns.error) {
        throw new Error(accountIns.error.message);
      }

      const [settingIns, voiceIns] = await Promise.all([
        this.supabaseAdmin.from("setting").insert({
          account_id: accountId,
          theme: "light",
          language: normalizedLanguage,
          notification: true,
        }),
        Promise.resolve({ error: null }),
      ]);
      if (settingIns.error) {
        throw new Error(settingIns.error.message);
      }
      if (voiceIns.error) throw new Error(voiceIns.error.message);

      if (this.queueManager) {
        await this.queueManager.enqueue(this.queueManager.QUEUES.VOICE_EMBEDDING, {
          mode: "register_voice_sample",
          accountId,
          speakerName: String(speakerName || fullName || "").trim() || null,
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
      }

      return {
        status: 200,
        body: { message: "Dang ky thanh cong", user_id: accountId, voice_sample_status: "processing" },
      };
    } catch (err) {
      await this.rollbackRegister(accountId, objectName, avatarObjectName);
      return { status: 500, body: { detail: `Loi dang ky: ${err.message}` } };
    }
  }

  async login({ email, password }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const pwd = String(password || "");

    if (!normalizedEmail || !pwd) {
      return { status: 400, body: { detail: "Thieu email hoac password." } };
    }

    const authClient = this.createAuthClient();
    const authRes = await authClient.auth.signInWithPassword({ email: normalizedEmail, password: pwd });
    if (authRes.error) {
      const msg = String(authRes.error.message || "");
      if (msg.includes("Invalid login credentials")) {
        return { status: 401, body: { detail: "Email hoac mat khau khong dung." } };
      }
      return { status: 500, body: { detail: `Loi dang nhap: ${authRes.error.message}` } };
    }

    const session = authRes.data?.session;
    const user = authRes.data?.user;
    if (!session || !user) {
      return { status: 401, body: { detail: "Email hoac mat khau khong dung." } };
    }

    return {
      status: 200,
      body: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        token_type: "bearer",
        expires_in: session.expires_in,
        user: { id: user.id, email: user.email },
      },
    };
  }

  async ensureOAuthAccount({ userId, email, fullName, avatarUrl = "", dateOfBirth = "", language = "en" }) {
    const id = String(userId || "").trim();
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const normalizedLanguage = String(language || "").toLowerCase().startsWith("vi") ? "vi" : "en";
    const name = String(fullName || "").trim();

    if (!this.validationHelper.isValidUuid(id) || !normalizedEmail) {
      return { status: 400, body: { detail: "Invalid OAuth user payload." } };
    }

    const accountRes = await this.supabaseAdmin
      .from("account")
      .select("id,email,full_name,date_of_birth")
      .eq("id", id)
      .limit(1);

    if (accountRes.error) {
      return { status: 500, body: { detail: `Loi truy van account: ${accountRes.error.message}` } };
    }

    const existed = (accountRes.data || [])[0] || null;
    const resolvedName = name || normalizedEmail.split("@")[0] || "Google User";
    const resolvedDob = this.storageHelper.normalizeDateOfBirth(dateOfBirth) || "1999-01-01";

    if (!existed) {
      const insertRes = await this.supabaseAdmin.from("account").insert({
        id,
        email: normalizedEmail,
        password_hash: null,
        full_name: resolvedName,
        date_of_birth: resolvedDob,
      });

      if (insertRes.error) {
        const msg = String(insertRes.error.message || "");
        const isDuplicate = msg.toLowerCase().includes("duplicate key value") && msg.includes("account_pkey");
        if (!isDuplicate) {
          return { status: 500, body: { detail: `Loi tao account OAuth: ${insertRes.error.message}` } };
        }
      }
    }

    const updates = {};
    if (!String(existed?.email || "").trim()) updates.email = normalizedEmail;
    if (!String(existed?.full_name || "").trim()) updates.full_name = resolvedName;
    if (
      this.storageHelper.normalizeDateOfBirth(dateOfBirth) &&
      (!String(existed?.date_of_birth || "").trim() || String(existed?.date_of_birth || "").trim() === "1999-01-01")
    ) {
      updates.date_of_birth = this.storageHelper.normalizeDateOfBirth(dateOfBirth);
    }

    if (Object.keys(updates).length) {
      const updRes = await this.supabaseAdmin.from("account").update(updates).eq("id", id);
      if (updRes.error) {
        return { status: 500, body: { detail: `Loi cap nhat account OAuth: ${updRes.error.message}` } };
      }
    }

    const { data: existingSettings } = await this.supabaseAdmin
      .from("setting")
      .select("account_id")
      .eq("account_id", id)
      .single();

    if (!existingSettings) {
      const settingIns = await this.supabaseAdmin
        .from("setting")
        .insert({
          account_id: id,
          theme: "light",
          language: normalizedLanguage,
          notification: true,
        });

      if (settingIns.error) {
        console.warn("[OAuth] Could not create initial settings:", settingIns.error.message);
      }
    }

    try {
      const authUserRes = await this.supabaseAdmin.auth.admin.getUserById(id);
      const existingMeta = authUserRes?.data?.user?.user_metadata || {};
      const hasCustomAvatar = existingMeta.avatar_storage_path && !existingMeta.avatar_storage_path.includes("google_avatar");

      const nextMeta = {
        ...existingMeta,
        full_name: resolvedName,
      };

      if (!hasCustomAvatar) {
        const avatarObjectPath = await this.syncGoogleAvatarToStorage({ userId: id, avatarUrl });
        nextMeta.avatar_url = String(avatarUrl || existingMeta?.avatar_url || "").trim() || undefined;
        if (avatarObjectPath) {
          nextMeta.avatar_storage_path = avatarObjectPath;
        }
      }
      await this.supabaseAdmin.auth.admin.updateUserById(id, { user_metadata: nextMeta });
    } catch (err) {
      // Do not fail OAuth login when avatar sync fails.
    }

    return { status: 200, body: { ok: true } };
  }

  async requestPasswordResetOtp({ email }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      return { status: 400, body: { detail: "Email is required." } };
    }

    const accountRes = await this.supabaseAdmin
      .from("account")
      .select("id,password_hash")
      .eq("email", normalizedEmail)
      .limit(1);

    if (accountRes.error) {
      return { status: 500, body: { detail: `Loi truy van account: ${accountRes.error.message}` } };
    }

    const account = (accountRes.data || [])[0] || null;
    if (!account?.id) {
      return { status: 404, body: { detail: "Email khong ton tai." } };
    }

    const hasLocalPassword = String(account?.password_hash || "").trim().length > 0;
    if (!hasLocalPassword) {
      return {
        status: 400,
        body: {
          detail: "Tai khoan dang nhap bang Google khong the su dung quen mat khau.",
        },
      };
    }

    const authClient = this.createAuthClient();
    const otpRes = await authClient.auth.resetPasswordForEmail(normalizedEmail);
    if (otpRes.error) {
      const msg = String(otpRes.error.message || "");
      if (msg.toLowerCase().includes("rate limit")) {
        return {
          status: 429,
          body: { detail: "Ban thao tac qua nhanh. Vui long cho khoang 60 giay roi thu gui OTP lai." },
        };
      }
      return { status: 500, body: { detail: `Khong gui duoc OTP: ${msg}` } };
    }

    return {
      status: 200,
      body: {
        ok: true,
        message: "Da gui OTP reset password vao email.",
        email: normalizedEmail,
      },
    };
  }

  async verifyPasswordResetOtp({ email, otp }) {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    const token = String(otp || "").trim();
    if (!normalizedEmail || !token) {
      return { status: 400, body: { detail: "Thieu email hoac OTP." } };
    }

    const authClient = this.createAuthClient();
    const verifyRes = await authClient.auth.verifyOtp({
      email: normalizedEmail,
      token,
      type: "recovery",
    });

    if (verifyRes.error) {
      return { status: 400, body: { detail: verifyRes.error.message || "OTP khong hop le." } };
    }

    const session = verifyRes.data?.session || null;
    if (!session?.access_token) {
      return { status: 400, body: { detail: "OTP hop le nhung khong tao duoc session reset." } };
    }

    return {
      status: 200,
      body: {
        ok: true,
        access_token: session.access_token,
        refresh_token: session.refresh_token || null,
        expires_in: Number(session.expires_in || 600),
      },
    };
  }

  async resetPasswordWithToken({ accessToken, newPassword }) {
    const token = String(accessToken || "").trim();
    const password = String(newPassword || "");
    if (!token || !password) {
      return { status: 400, body: { detail: "Thieu access_token hoac new_password." } };
    }
    if (password.length < 6) {
      return { status: 400, body: { detail: "Mat khau moi phai it nhat 6 ky tu." } };
    }

    const userRes = await this.supabaseAdmin.auth.getUser(token);
    const userId = String(userRes?.data?.user?.id || "").trim();
    if (userRes.error || !this.validationHelper.isValidUuid(userId)) {
      return { status: 401, body: { detail: "Token reset khong hop le hoac da het han." } };
    }

    const updRes = await this.supabaseAdmin.auth.admin.updateUserById(userId, { password });
    if (updRes.error) {
      return { status: 400, body: { detail: updRes.error.message || "Khong doi duoc mat khau." } };
    }

    const accountUpd = await this.supabaseAdmin
      .from("account")
      .update({ password_hash: await this.cryptoHelper.hashPassword(password) })
      .eq("id", userId);
    if (accountUpd.error) {
      return { status: 500, body: { detail: `Da doi mat khau Auth nhung loi cap nhat account: ${accountUpd.error.message}` } };
    }

    return { status: 200, body: { ok: true, message: "Doi mat khau thanh cong." } };
  }

  async changePassword({ userId, currentPassword, newPassword }) {
    try {
      if (!currentPassword || !newPassword) {
        return { status: 400, body: { detail: "Missing fields" } };
      }

      const authClient = this.createAuthClient();
      const { data: userData, error: userError } = await authClient.auth.admin.getUserById(userId);

      if (userError || !userData?.user?.email) {
        return { status: 400, body: { detail: "User not found" } };
      }

      const email = userData.user.email;
      const { error: loginError } = await authClient.auth.signInWithPassword({
        email,
        password: currentPassword,
      });

      if (loginError) {
        return { status: 400, body: { detail: "Current password is incorrect" } };
      }

      const { error: updateError } = await authClient.auth.admin.updateUserById(userId, {
        password: newPassword,
      });

      if (updateError) {
        return { status: 500, body: { detail: updateError.message } };
      }

      return { status: 200, body: { message: "Password updated successfully" } };
    } catch (err) {
      return { status: 500, body: { detail: err.message } };
    }
  }

  async syncGoogleAvatarToStorage({ userId, avatarUrl }) {
    const uid = String(userId || "").trim();
    const src = String(avatarUrl || "").trim();
    if (!this.validationHelper.isValidUuid(uid) || !src || !/^https?:\/\//i.test(src)) {
      return null;
    }

    try {
      const imgRes = await axios.get(src, {
        responseType: "arraybuffer",
        timeout: 15000,
        maxContentLength: 8 * 1024 * 1024,
        maxBodyLength: 8 * 1024 * 1024,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      const contentType = String(imgRes?.headers?.["content-type"] || "image/jpeg").trim();
      const ext = this.storageHelper.getExtensionFromContentType(contentType, "jpg");
      const objectPath = `${uid}/google_avatar.${ext}`;

      const uploadRes = await this.supabaseAdmin.storage
        .from(this.config.avatarBucket)
        .upload(objectPath, Buffer.from(imgRes.data), {
          contentType,
          upsert: true,
        });

      if (uploadRes.error) {
        return null;
      }

      return objectPath;
    } catch (err) {
      return null;
    }
  }

  async rollbackRegister(accountId, voiceObjectName, avatarObjectName = null) {
    if (voiceObjectName) {
      try {
        await this.supabaseAdmin.storage.from(this.config.voiceBucket).remove([voiceObjectName]);
      } catch (err) {
        // best effort
      }
    }

    if (avatarObjectName) {
      try {
        await this.supabaseAdmin.storage.from(this.config.avatarBucket).remove([avatarObjectName]);
      } catch (err) {
        // best effort
      }
    }

    if (accountId) {
      try {
        await this.supabaseAdmin.from("voice_sample").delete().eq("account_id", accountId);
      } catch (err) {
        // best effort
      }
      try {
        await this.supabaseAdmin.from("account").delete().eq("id", accountId);
      } catch (err) {
        // best effort
      }
      try {
        await this.supabaseAdmin.auth.admin.deleteUser(accountId);
      } catch (err) {
        // best effort
      }
    }
  }
}

module.exports = AuthService;
