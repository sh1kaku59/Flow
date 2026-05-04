process.env.QUEUE_LOG_ENQUEUE = process.env.QUEUE_LOG_ENQUEUE || "1";

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const { createClient } = require("@supabase/supabase-js");
const { createClient: createRedisClient } = require("redis");

const config = require("./config/AppConfig");
const RedisQueueManager = require("./queues/RedisQueueManager");
const ValidationHelper = require("./utils/ValidationHelper");
const StorageHelper = require("./utils/StorageHelper");
const DateTimeHelper = require("./utils/DateTimeHelper");
const CryptoHelper = require("./utils/CryptoHelper");
const AiTextService = require("./services/AiTextService");
const AuthService = require("./services/AuthService");
const MeetingService = require("./services/MeetingService");
const VoiceSampleService = require("./services/VoiceSampleService");
const UserService = require("./services/UserService");
const SettingsService = require("./services/SettingsService");

class AppServer {
  constructor(configObject) {
    this.config = configObject;
    this.app = express();
    this.upload = multer({ storage: multer.memoryStorage() });
    this.allowedOrigins = new Set(this.config.frontendOrigins);
    this.meetingStreamClients = new Map();

    this.supabaseAdmin = createClient(this.config.supabaseUrl, this.config.supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.redisClient = createRedisClient({ url: this.config.redisUrl });
    this.queueManager = new RedisQueueManager(this.config);

    this.validationHelper = new ValidationHelper();
    this.storageHelper = new StorageHelper();
    this.dateTimeHelper = new DateTimeHelper();
    this.cryptoHelper = new CryptoHelper();

    this.aiTextService = new AiTextService(this.config, this.queueManager);
    this.authService = new AuthService(
      this.config,
      this.supabaseAdmin,
      this.validationHelper,
      this.cryptoHelper,
      this.storageHelper,
      this.queueManager
    );
    this.meetingService = new MeetingService(
      this.config,
      this.supabaseAdmin,
      this.queueManager,
      this.aiTextService,
      this.validationHelper,
      this.dateTimeHelper,
      this.storageHelper
    );
    this.voiceSampleService = new VoiceSampleService(
      this.config,
      this.supabaseAdmin,
      this.storageHelper,
      this.validationHelper,
      this.queueManager
    );
    this.userService = new UserService(this.config, this.supabaseAdmin, this.storageHelper, this.validationHelper);
    this.settingsService = new SettingsService(this.config, this.supabaseAdmin);

    this.registerRateLimit = this.createRateLimiter({ keyPrefix: "register", max: 8, windowMs: 10 * 60 * 1000 });
    this.loginRateLimit = this.createRateLimiter({ keyPrefix: "login", max: 20, windowMs: 60 * 1000 });
  }

  sessionKey(sid) {
    return `session:${sid}`;
  }

  sessionCookieOptions(maxAgeMs) {
    return {
      httpOnly: true,
      sameSite: this.config.sessionCookieSameSite,
      secure: this.config.isSessionCookieSecure,
      path: "/",
      maxAge: maxAgeMs,
    };
  }

  createRateLimiter({ keyPrefix, max, windowMs }) {
    const buckets = new Map();
    return (req, res, next) => {
      if (this.config.isRateLimitDisabled) return next();
      const now = Date.now();
      const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || "unknown";
      const key = `${keyPrefix}:${ip}`;
      const current = buckets.get(key);
      if (!current || now >= current.resetAt) {
        buckets.set(key, { count: 1, resetAt: now + windowMs });
        return next();
      }
      if (current.count >= max) {
        const retryAfterSeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
        res.set("Retry-After", String(retryAfterSeconds));
        return res.status(429).json({ detail: "Too many requests. Please try again later." });
      }
      current.count += 1;
      buckets.set(key, current);
      return next();
    };
  }

  addMeetingStreamClient(meetingId, client) {
    const key = String(meetingId || "").trim();
    if (!key) return;
    if (!this.meetingStreamClients.has(key)) this.meetingStreamClients.set(key, new Set());
    this.meetingStreamClients.get(key).add(client);
  }

  removeMeetingStreamClient(meetingId, client) {
    const key = String(meetingId || "").trim();
    if (!key) return;
    const bucket = this.meetingStreamClients.get(key);
    if (!bucket) return;
    bucket.delete(client);
    if (!bucket.size) this.meetingStreamClients.delete(key);
  }

  async persistSessionBySid(sid, session, expiresInSeconds = 3600) {
    const ttl = Math.max(60, Number(expiresInSeconds) || 3600);
    await this.redisClient.set(this.sessionKey(sid), JSON.stringify(session), { EX: ttl });
    return ttl;
  }

  async setSessionCookie(res, session, expiresInSeconds = 3600) {
    const sid = crypto.randomUUID();
    const ttl = await this.persistSessionBySid(sid, session, expiresInSeconds);
    res.cookie(this.config.sessionCookieName, sid, this.sessionCookieOptions(ttl * 1000));
  }

  async refreshAccessToken(refreshToken) {
    const token = String(refreshToken || "").trim();
    if (!token) return null;
    const refreshed = await this.supabaseAdmin.auth.refreshSession({ refresh_token: token });
    const session = refreshed?.data?.session || null;
    const nextAccessToken = String(session?.access_token || "").trim();
    if (!nextAccessToken) return null;
    return {
      accessToken: nextAccessToken,
      refreshToken: String(session?.refresh_token || token).trim() || null,
      expiresIn: Number(session?.expires_in || 3600),
    };
  }

  async clearSessionCookie(req, res) {
    const sid = req.cookies?.[this.config.sessionCookieName] || "";
    if (sid) {
      try {
        await this.redisClient.del(this.sessionKey(sid));
      } catch (_err) {}
    }
    res.clearCookie(this.config.sessionCookieName, {
      httpOnly: true,
      sameSite: this.config.sessionCookieSameSite,
      secure: this.config.isSessionCookieSecure,
      path: "/",
    });
  }

  async resolveUserFromToken(token) {
    if (!token) return null;
    const authRes = await this.supabaseAdmin.auth.getUser(token);
    const user = authRes?.data?.user || null;
    if (authRes.error || !user?.id) return null;
    return user;
  }

  async requireAuth(req, res, next) {
    const sid = req.cookies?.[this.config.sessionCookieName] || "";
    try {
      if (sid) {
        const rawSession = await this.redisClient.get(this.sessionKey(sid));
        if (rawSession) {
          const parsed = JSON.parse(rawSession);
          const accessToken = String(parsed?.accessToken || "").trim();
          const refreshToken = String(parsed?.refreshToken || "").trim() || null;
          let activeAccessToken = accessToken;
          let activeRefreshToken = refreshToken;
          let expiresIn = 3600;
          let user = await this.resolveUserFromToken(activeAccessToken);

          if (!user && activeRefreshToken) {
            const refreshed = await this.refreshAccessToken(activeRefreshToken);
            if (refreshed?.accessToken) {
              activeAccessToken = refreshed.accessToken;
              activeRefreshToken = refreshed.refreshToken;
              expiresIn = Number.isFinite(refreshed.expiresIn) && refreshed.expiresIn > 0 ? refreshed.expiresIn : 3600;
              user = await this.resolveUserFromToken(activeAccessToken);
            }
          }

          if (user) {
            await this.persistSessionBySid(
              sid,
              { accessToken: activeAccessToken, refreshToken: activeRefreshToken, userId: parsed?.userId || user.id },
              expiresIn
            );
            res.cookie(this.config.sessionCookieName, sid, this.sessionCookieOptions(Math.max(60, expiresIn) * 1000));
            req.auth = { token: activeAccessToken, authHeader: `Bearer ${activeAccessToken}`, user, sid };
            return next();
          }
        }
        await this.clearSessionCookie(req, res);
      }

      const authHeader = req.headers?.authorization || "";
      if (!authHeader.toLowerCase().startsWith("bearer ")) {
        return res.status(401).json({ detail: "Missing or invalid session/token." });
      }
      const token = authHeader.slice(7).trim();
      const user = await this.resolveUserFromToken(token);
      if (!user) return res.status(401).json({ detail: "Invalid or expired token." });
      req.auth = { token, authHeader, user };
      return next();
    } catch (_err) {
      return res.status(401).json({ detail: "Cannot validate access token." });
    }
  }

  async broadcastMeetingStatus(meetingId) {
    const key = String(meetingId || "").trim();
    if (!key) return;
    const clients = this.meetingStreamClients.get(key);
    if (!clients || !clients.size) return;

    try {
      const meetingRes = await this.supabaseAdmin.from("meeting").select("account_id").eq("id", key).limit(1);
      if (meetingRes.error) return;
      const accountId = (meetingRes.data || [])[0]?.account_id || null;
      if (!accountId) return;

      const statusResult = await this.meetingService.getMeetingStatus(key, accountId);
      if (statusResult.status !== 200) return;

      const payload = JSON.stringify(statusResult.body || {});
      for (const client of clients) {
        try {
          client.write("event: status\n");
          client.write(`data: ${payload}\n\n`);
        } catch (_err) {}
      }
    } catch (_err) {}
  }

  async startRedis() {
    this.redisClient.on("error", (err) => {
      console.error("[backend-node] Redis error:", err?.message || err);
    });
    await this.redisClient.connect();
    console.log("[backend-node] Redis connected");
  }

  configureMiddlewares() {
    this.app.use(cors({
      origin: (origin, cb) => {
        if (!origin) return cb(null, true);
        return cb(null, this.allowedOrigins.has(origin));
      },
      credentials: true,
    }));
    this.app.use(express.json());
    this.app.use(cookieParser());
  }

  registerRoutes() {
    this.app.get("/health", (_req, res) => res.json({ ok: true, service: "backend-node" }));

    this.app.post("/register", this.registerRateLimit, this.upload.fields([{ name: "voiceSample", maxCount: 1 }, { name: "avatar", maxCount: 1 }]), async (req, res) => {
      const result = await this.authService.register({
        fullName: req.body?.fullName,
        email: req.body?.email,
        password: req.body?.password,
        dateOfBirth: req.body?.dateOfBirth,
        speakerName: req.body?.speakerName,
        voiceSample: req.files?.voiceSample?.[0] || null,
        avatar: req.files?.avatar?.[0] || null,
        language: req.body?.language,
      });

      if (result.status === 200 && result.body?.access_token) {
        await this.setSessionCookie(res, {
          accessToken: result.body.access_token,
          refreshToken: result.body.refresh_token || null,
          userId: result.body.user?.id || result.body.user_id || null,
        }, result.body.expires_in || 3600);

        return res.status(200).json({
          message: result.body.message || "Dang ky thanh cong",
          user: result.body.user || null,
          user_id: result.body.user_id || result.body.user?.id || null,
          token_type: result.body.token_type || "bearer",
          expires_in: result.body.expires_in || 3600,
        });
      }
      return res.status(result.status).json(result.body);
    });

    this.app.post("/login", this.loginRateLimit, async (req, res) => {
      const result = await this.authService.login({ email: req.body?.email, password: req.body?.password });
      if (result.status === 200 && result.body?.access_token) {
        await this.setSessionCookie(res, {
          accessToken: result.body.access_token,
          refreshToken: result.body.refresh_token || null,
          userId: result.body.user?.id || null,
        }, result.body.expires_in || 3600);

        return res.status(200).json({
          user: result.body.user,
          token_type: result.body.token_type,
          expires_in: result.body.expires_in,
          message: "Dang nhap thanh cong",
        });
      }
      return res.status(result.status).json(result.body);
    });

    this.app.post("/auth/oauth/exchange", async (req, res) => {
      try {
        const accessToken = String(req.body?.access_token || "").trim();
        const refreshToken = String(req.body?.refresh_token || "").trim() || null;
        const expiresIn = Number(req.body?.expires_in || 3600);
        if (!accessToken) return res.status(400).json({ detail: "Missing access_token." });

        const user = await this.resolveUserFromToken(accessToken);
        if (!user?.id) return res.status(401).json({ detail: "Invalid Google access token." });

        const oauthAccount = await this.authService.ensureOAuthAccount({
          userId: user.id,
          email: user.email || "",
          fullName: user.user_metadata?.full_name || user.user_metadata?.name || "",
          avatarUrl: user.user_metadata?.avatar_url || user.user_metadata?.picture || "",
          dateOfBirth: user.user_metadata?.date_of_birth || user.user_metadata?.birthdate || user.user_metadata?.birthday || "",
          language: req.body?.language,
        });
        if (oauthAccount.status !== 200) return res.status(oauthAccount.status).json(oauthAccount.body);

        await this.setSessionCookie(res, { accessToken, refreshToken, userId: user.id }, Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600);

        let needsVoiceSetup = true;
        const vsRes = await this.supabaseAdmin.from("voice_sample").select("id").eq("account_id", user.id).limit(1);
        if (!vsRes.error) needsVoiceSetup = (vsRes.data || []).length === 0;

        return res.status(200).json({ user: { id: user.id, email: user.email || null }, needs_voice_setup: needsVoiceSetup, message: "Google login thanh cong" });
      } catch (err) {
        return res.status(500).json({ detail: `Internal error: ${err?.message || "unknown"}` });
      }
    });

    this.app.post("/auth/password/forgot", async (req, res) => {
      const result = await this.authService.requestPasswordResetOtp({ email: req.body?.email });
      return res.status(result.status).json(result.body);
    });
    this.app.post("/auth/password/verify-otp", async (req, res) => {
      const result = await this.authService.verifyPasswordResetOtp({ email: req.body?.email, otp: req.body?.otp });
      return res.status(result.status).json(result.body);
    });
    this.app.post("/auth/password/reset", async (req, res) => {
      const result = await this.authService.resetPasswordWithToken({ accessToken: req.body?.access_token, newPassword: req.body?.new_password });
      return res.status(result.status).json(result.body);
    });

    this.app.get("/auth/session", this.requireAuth.bind(this), async (req, res) => {
      const rawAvatarPath = String(req.auth?.user?.user_metadata?.avatar_storage_path || "").trim();
      let avatarUrl = "";
      if (rawAvatarPath) {
        const signed = await this.supabaseAdmin.storage.from(this.config.avatarBucket).createSignedUrl(rawAvatarPath, 3600);
        if (!signed.error && signed.data?.signedUrl) avatarUrl = signed.data.signedUrl;
      }
      if (!avatarUrl) {
        avatarUrl = String(req.auth?.user?.user_metadata?.avatar_url || req.auth?.user?.user_metadata?.picture || "").trim();
      }

      let accountDob = null;
      let accountName = null;
      let hasLocalPassword = false;
      const accRes = await this.supabaseAdmin
        .from("account")
        .select("date_of_birth,full_name,password_hash")
        .eq("id", req.auth?.user?.id || "")
        .limit(1);
      if (!accRes.error) {
        accountDob = (accRes.data || [])[0]?.date_of_birth || null;
        accountName = (accRes.data || [])[0]?.full_name || null;
        hasLocalPassword = String((accRes.data || [])[0]?.password_hash || "").trim().length > 0;
      }

      const providers = req.auth?.user?.app_metadata?.providers || [];
      const isOAuthProvider = req.auth?.user?.app_metadata?.provider === "google" || providers.includes("google");
      const isOAuth = isOAuthProvider && !hasLocalPassword;
      const canEditEmail = !isOAuthProvider;
      const canChangePassword = hasLocalPassword;

      return res.status(200).json({
        authenticated: true,
        user: {
          id: req.auth?.user?.id || null,
          email: req.auth?.user?.email || null,
          name: accountName || req.auth?.user?.user_metadata?.full_name || req.auth?.user?.user_metadata?.name || null,
          avatar_url: avatarUrl || null,
          date_of_birth: accountDob || null,
          is_oauth: isOAuth,
          can_edit_email: canEditEmail,
          can_change_password: canChangePassword,
        },
      });
    });

    this.app.post("/logout", async (req, res) => {
      await this.clearSessionCookie(req, res);
      return res.status(200).json({ ok: true });
    });

    this.app.patch("/users/me/avatar", this.requireAuth.bind(this), this.upload.single("avatar"), async (req, res) => {
      const result = await this.userService.updateUserAvatar({ accountId: req.auth?.user?.id || null, avatar: req.file });
      return res.status(result.status).json(result.body);
    });

    this.app.patch("/users/me", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.userService.updateUserProfile({ accountId: req.auth?.user?.id || null, name: req.body.name, email: req.body.email, dob: req.body.dob });
      return res.status(result.status).json(result.body);
    });

    this.app.patch("/users/me/password", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.authService.changePassword({ userId: req.auth?.user?.id, currentPassword: req.body.currentPassword, newPassword: req.body.newPassword });
      return res.status(result.status).json(result.body);
    });

    this.app.get("/users/me/settings", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.settingsService.getUserSettings({ userId: req.auth?.user?.id || null, acceptLanguage: req.headers["accept-language"] });
      return res.status(result.status).json(result.body);
    });

    this.app.patch("/users/me/settings", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.settingsService.updateUserSettings({ userId: req.auth?.user?.id || null, payload: req.body || {} });
      return res.status(result.status).json(result.body);
    });

    this.app.get("/voice-samples", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.voiceSampleService.listVoiceSamples(req.auth?.user?.id || null);
      return res.status(result.status).json(result.body);
    });

    this.app.post("/voice-samples", this.requireAuth.bind(this), this.upload.fields([{ name: "voiceSample", maxCount: 1 }, { name: "avatar", maxCount: 1 }]), async (req, res) => {
      const result = await this.voiceSampleService.createVoiceSample({
        accountId: req.auth?.user?.id || null,
        speakerName: req.body?.speakerName,
        voiceSample: req.files?.voiceSample?.[0] || null,
        avatar: req.files?.avatar?.[0] || null,
      });
      return res.status(result.status).json(result.body);
    });

    this.app.patch("/voice-samples/:id", this.requireAuth.bind(this), this.upload.fields([{ name: "avatar", maxCount: 1 }]), async (req, res) => {
      const result = await this.voiceSampleService.updateVoiceSample({
        accountId: req.auth?.user?.id || null,
        sampleId: req.params?.id,
        speakerName: req.body?.speakerName,
        avatar: req.files?.avatar?.[0] || null,
      });
      return res.status(result.status).json(result.body);
    });

    this.app.delete("/voice-samples/:id", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.voiceSampleService.deleteVoiceSample({ accountId: req.auth?.user?.id || null, sampleId: req.params?.id });
      return res.status(result.status).json(result.body);
    });

    this.app.get("/meetings", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.meetingService.listMeetings(req.auth?.user?.id || null);
      return res.status(result.status).json(result.body);
    });

    this.app.patch("/meetings/:id", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.meetingService.updateMeetingTitle({ accountId: req.auth?.user?.id || null, meetingId: req.params?.id, title: req.body?.title });
      return res.status(result.status).json(result.body);
    });

    this.app.post("/meetings/:id/summary", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.meetingService.generateMeetingSummary({ accountId: req.auth?.user?.id || null, meetingId: req.params?.id, force: Boolean(req.body?.force) });
      return res.status(result.status).json(result.body);
    });

    this.app.get("/meetings/semantic-search", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.meetingService.semanticSearchMeetings({
        accountId: req.auth?.user?.id || null,
        query: req.query?.q,
        topK: req.query?.top_k,
        candidateLimit: req.query?.candidate_limit,
      });
      return res.status(result.status).json(result.body);
    });

    this.app.get("/meetings/:id/semantic-search", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.meetingService.semanticSearchMeetingById({
        accountId: req.auth?.user?.id || null,
        meetingId: req.params?.id,
        query: req.query?.q,
        threshold: req.query?.threshold ? Number(req.query.threshold) : undefined,
      });
      return res.status(result.status).json(result.body);
    });


    this.app.get("/audio/:audio_id", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.meetingService.getMeetingResult(req.params.audio_id, req.auth?.user?.id || null);
      return res.status(result.status).json(result.body);
    });

    this.app.get("/audio/:audio_id/status", this.requireAuth.bind(this), async (req, res) => {
      const result = await this.meetingService.getMeetingStatus(req.params.audio_id, req.auth?.user?.id || null);
      return res.status(result.status).json(result.body);
    });

    this.app.get("/audio/:audio_id/stream", this.requireAuth.bind(this), async (req, res) => {
      const meetingId = String(req.params.audio_id || "").trim();
      const accountId = req.auth?.user?.id || null;
      const initialStatus = await this.meetingService.getMeetingStatus(meetingId, accountId);
      if (initialStatus.status !== 200) return res.status(initialStatus.status).json(initialStatus.body);

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();

      const heartbeat = setInterval(() => {
        try {
          res.write("event: ping\n");
          res.write(`data: {\"ts\":${Date.now()}}\n\n`);
        } catch (_err) {}
      }, 15000);

      this.addMeetingStreamClient(meetingId, res);
      res.write("event: status\n");
      res.write(`data: ${JSON.stringify(initialStatus.body || {})}\n\n`);

      req.on("close", () => {
        clearInterval(heartbeat);
        this.removeMeetingStreamClient(meetingId, res);
      });
    });

    this.app.post("/audio/upload", this.requireAuth.bind(this), this.upload.single("file"), async (req, res) => {
      const result = await this.meetingService.processMeetingUpload(req.file, req.auth?.authHeader || null);
      return res.status(result.status).json(result.body);
    });

    this.app.post("/ai/progress", async (req, res) => {
      const result = await this.meetingService.handleAiProgressUpdate(req.body || {});
      if (result.status === 200) {
        this.broadcastMeetingStatus(req.body?.meeting_id).catch(() => {});
      }
      return res.status(result.status).json(result.body);
    });

  }

  async start() {
    this.configureMiddlewares();
    this.registerRoutes();
    await this.startRedis();
    this.app.listen(this.config.port, () => {
      console.log(`Server running at http://127.0.0.1:${this.config.port}`);
    });
  }
}

new AppServer(config).start().catch((err) => {
  console.error("[backend-node] startup failed:", err?.message || err);
  process.exit(1);
});
