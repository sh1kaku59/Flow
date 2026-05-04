class SettingsService {
  constructor(config, supabaseAdminClient) {
    this.config = config;
    this.supabaseAdmin = supabaseAdminClient;
  }

  async getUserSettings({ userId, acceptLanguage }) {
    const detectLanguageFromRequest = () => {
      const header = String(acceptLanguage || "").toLowerCase();
      return header.startsWith("vi") ? "vi" : "en";
    };

    if (!userId) return { status: 401, body: { detail: "Unauthorized" } };

    const { data, error } = await this.supabaseAdmin
      .from("setting")
      .select("language,theme,notification")
      .eq("account_id", userId)
      .limit(1)
      .single();
    if (error && error.code !== "PGRST116") {
      console.warn("[settings] GET error:", error.message);
      return { status: 500, body: { detail: error.message } };
    }

    return {
      status: 200,
      body: {
        language: data?.language || detectLanguageFromRequest(),
        theme: data?.theme || "light",
        notification: data?.notification ?? true,
      },
    };
  }

  async updateUserSettings({ userId, payload }) {
    if (!userId) return { status: 401, body: { detail: "Unauthorized" } };
    const updates = {};

    if (payload?.language !== undefined) {
      const language = String(payload.language || "").toLowerCase();
      if (language !== "en" && language !== "vi") {
        return { status: 400, body: { detail: "Invalid language. Allowed: en, vi." } };
      }
      updates.language = language;
    }

    if (payload?.theme !== undefined) {
      const theme = String(payload.theme || "").toLowerCase();
      if (theme === "light" || theme === "dark" || theme === "auto") {
        updates.theme = theme;
      } else {
        return { status: 400, body: { detail: "Invalid theme. Allowed: light, dark, auto." } };
      }
    }

    if (payload?.notification !== undefined) {
      updates.notification = Boolean(payload.notification);
    }

    if (Object.keys(updates).length === 0) {
      return { status: 400, body: { detail: "No valid fields provided" } };
    }

    const { error } = await this.supabaseAdmin
      .from("setting")
      .upsert({ account_id: userId, ...updates }, { onConflict: "account_id" });
    if (error) {
      const msg = String(error.message || "");
      if (msg.toLowerCase().includes("invalid input value") || msg.toLowerCase().includes("check constraint")) {
        return {
          status: 400,
          body: {
            detail: `Database schema does not allow theme='auto'. Please update setting.theme constraint/enum to include 'auto'. Original error: ${msg}`,
          },
        };
      }
      return { status: 500, body: { detail: msg } };
    }

    return { status: 200, body: { ok: true } };
  }
}

module.exports = SettingsService;
