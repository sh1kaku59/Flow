const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

class AppConfig {
  constructor() {
    dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

    const fallbackEnvPath = path.resolve(__dirname, "..", "..", "..", "backend", ".env");
    let fallbackEnv = {};
    if (fs.existsSync(fallbackEnvPath)) {
      fallbackEnv = dotenv.parse(fs.readFileSync(fallbackEnvPath));
    }

    const envValue = (name, defaultValue = "") => {
      const primary = String(process.env[name] || "").trim();
      if (primary) return primary;
      const fallback = String(fallbackEnv[name] || "").trim();
      if (fallback) return fallback;
      return defaultValue;
    };

    const envBoolean = (name, defaultValue = false) => {
      const raw = envValue(name, "");
      if (!raw) return Boolean(defaultValue);
      const normalized = raw.toLowerCase();
      return ["1", "true", "yes", "on"].includes(normalized);
    };

    this.port = Number(envValue("PORT", "9000"));
    this.supabaseUrl = envValue("SUPABASE_URL", "");
    this.supabaseServiceRoleKey = envValue("SUPABASE_SERVICE_ROLE_KEY", "");
    this.aiServiceUrl = envValue("AI_SERVICE_URL", "http://127.0.0.1:8001");
    this.backendCallbackUrl = envValue("BACKEND_CALLBACK_URL", "http://127.0.0.1:9000/ai/progress");
    this.voiceBucket = envValue("VOICE_BUCKET", "voice-samples");
    this.avatarBucket = envValue("AVATAR_BUCKET", "avatars");
    this.meetingAudioBucket = envValue("MEETING_AUDIO_BUCKET", "meeting-audios");
    this.embeddingDim = Number.parseInt(envValue("EMBEDDING_DIM", "256"), 10);
    this.redisUrl = envValue("REDIS_URL", "redis://127.0.0.1:6379");
    this.sessionCookieName = envValue("SESSION_COOKIE_NAME", "sid");
    this.isSessionCookieSecure = envBoolean(
      "SESSION_COOKIE_SECURE",
      String(process.env.NODE_ENV || "").trim().toLowerCase() === "production"
    );
    this.sessionCookieSameSite = (() => {
      const value = envValue("SESSION_COOKIE_SAMESITE", "lax").toLowerCase();
      if (value === "strict" || value === "none" || value === "lax") return value;
      return "lax";
    })();
    this.frontendOrigins = envValue("FRONTEND_ORIGIN", "http://localhost:5173,http://127.0.0.1:5173")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    this.isRateLimitDisabled = envBoolean("RATE_LIMIT_DISABLED", false);

    if (this.sessionCookieSameSite === "none" && !this.isSessionCookieSecure) {
      throw new Error("SESSION_COOKIE_SAMESITE=none requires SESSION_COOKIE_SECURE=true");
    }

    if (!this.supabaseUrl || !this.supabaseServiceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const keyPayload = this.decodeJwtPayload(this.supabaseServiceRoleKey);
    if (keyPayload && keyPayload.role && keyPayload.role !== "service_role") {
      throw new Error(
        `SUPABASE_SERVICE_ROLE_KEY has role='${keyPayload.role}', expected 'service_role'. Check .env configuration.`
      );
    }

    try {
      const masked = this.supabaseServiceRoleKey ? `${this.supabaseServiceRoleKey.slice(0, 6)}...` : null;
      console.log("[backend-node] SUPABASE_URL=", this.supabaseUrl);
      console.log(
        "[backend-node] SUPABASE_SERVICE_ROLE_KEY present:",
        Boolean(this.supabaseServiceRoleKey),
        masked ? `masked=${masked}` : ""
      );
    } catch (_err) {}
  }

  decodeJwtPayload(token) {
    try {
      const parts = String(token || "").split(".");
      if (parts.length < 2) return null;
      const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
      return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    } catch (_err) {
      return null;
    }
  }
}

module.exports = new AppConfig();
