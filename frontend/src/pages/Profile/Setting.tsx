import React, { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import "./Setting.css"

type Language = "en" | "vi"
type Theme = "light" | "dark" | "auto"

interface Settings {
  language: Language
  theme: Theme
  notification: boolean
}

const THEME_PREF_KEY = "flowThemePreference"

function normalizeTheme(value: unknown): Theme {
  const raw = String(value || "").toLowerCase()
  if (raw === "dark") return "dark"
  if (raw === "auto") return "auto"
  return "light"
}

function normalizeLanguage(value: unknown): Language {
  const raw = String(value || "").toLowerCase()
  return raw.startsWith("vi") ? "vi" : "en"
}

export default function Setting() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"

  const [settings, setSettings] = useState<Settings>({
    language: normalizeLanguage(i18n.language),
    theme: "light",
    notification: true,
  })

  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "success" | "error">("idle")

  const isDark = document.documentElement.classList.contains("dark")
  const previewTheme = settings.theme === "auto" ? (isDark ? "dark" : "light") : settings.theme

  // ✅ APPLY THEME GLOBALLY
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove("light", "dark")

    if (settings.theme === "auto") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches
      root.classList.add(isDark ? "dark" : "light")
    } else {
      root.classList.add(settings.theme)
    }
  }, [settings.theme])

  // ✅ LISTEN TO SYSTEM THEME (AUTO MODE)
  useEffect(() => {
    if (settings.theme !== "auto") return

    const media = window.matchMedia("(prefers-color-scheme: dark)")

    const handleChange = () => {
      const root = document.documentElement
      root.classList.toggle("dark", media.matches)
      root.classList.toggle("light", !media.matches)
    }

    handleChange()
    media.addEventListener("change", handleChange)

    return () => media.removeEventListener("change", handleChange)
  }, [settings.theme])

  // Load settings on mount
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await fetch(`${API_BASE}/users/me/settings`, { credentials: "include" })
        if (!cancelled && res.ok) {
          const data = await res.json()
          const savedThemePref = localStorage.getItem(THEME_PREF_KEY)
          const preferredLanguage = normalizeLanguage(
            data?.language || localStorage.getItem("i18nextLng") || i18n.language
          )
          setSettings(prev => ({
            language: preferredLanguage,
            theme: normalizeTheme(savedThemePref || data?.theme || prev.theme),
            notification: data.notification ?? prev.notification,
          }))
          // Apply saved language when entering settings page.
          i18n.changeLanguage(preferredLanguage)
          localStorage.setItem("i18nextLng", preferredLanguage)
        }
      } catch {
        // ignore
      }
    }
    load()
    return () => { cancelled = true }
  }, [API_BASE, i18n])

  const handleSave = async () => {
    setSaving(true)
    setSaveStatus("idle")
    try {
      const res = await fetch(`${API_BASE}/users/me/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          language: settings.language,
          theme: settings.theme,
          notification: settings.notification,
        }),
        credentials: "include",
      })
      if (res.ok) {
        localStorage.setItem(THEME_PREF_KEY, settings.theme)
        i18n.changeLanguage(settings.language)
        localStorage.setItem("i18nextLng", settings.language)
        setSaveStatus("success")
        setTimeout(() => setSaveStatus("idle"), 2500)

        window.dispatchEvent(
          new CustomEvent("settings-changed", {
            detail: { notification: settings.notification },
          })
        );
      } else {
        setSaveStatus("error")
        setTimeout(() => setSaveStatus("idle"), 2500)
      }
    } catch {
      setSaveStatus("error")
      setTimeout(() => setSaveStatus("idle"), 2500)
    } finally {
      setSaving(false)
    }
  }

  // Manual sync removed. Using direct calls in handlers instead.

  return (
    <div className="setting-page">
      <div className="setting-container">

        {/* HEADER */}
        <div className="setting-header">
          <button className="setting-back-btn" onClick={() => navigate("/profile")}>
            ← {t("back")}
          </button>
          <h1>{t("settings")}</h1>
        </div>

        <div className="setting-body">

          {/* LEFT PANEL */}
          <div className="setting-card">

            {/* LANGUAGE */}
            <div className="setting-row">
              <div className="setting-row-label">
                <span className="setting-row-icon">
                  <svg viewBox="0 0 24 24" width="22" height="22">
                    <path fill="currentColor" d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95a15.65 15.65 0 0 0-1.38-3.56A8.03 8.03 0 0 1 18.92 8zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56A7.987 7.987 0 0 1 5.08 16zm2.95-8H5.08a7.987 7.987 0 0 1 4.33-3.56A15.65 15.65 0 0 0 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95a8.03 8.03 0 0 1-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/>
                  </svg>
                </span>
                {t("language")}
              </div>
              <div className="setting-row-options">
                <label className={`radio-option ${settings.language === "en" ? "active" : ""}`}>
                  <input
                    type="radio"
                    name="language"
                    value="en"
                    checked={settings.language === "en"}
                    onChange={() => {
                      setSettings(s => ({ ...s, language: "en" }))
                    }}
                  />
                  <span className="radio-dot" />
                  {t("english")}
                </label>
                <label className={`radio-option ${settings.language === "vi" ? "active" : ""}`}>
                  <input
                    type="radio"
                    name="language"
                    value="vi"
                    checked={settings.language === "vi"}
                    onChange={() => {
                      setSettings(s => ({ ...s, language: "vi" }))
                    }}
                  />
                  <span className="radio-dot" />
                  {t("vietnamese")}
                </label>
              </div>
            </div>

            <div className="setting-divider" />

            {/* THEME */}
            <div className="setting-row">
              <div className="setting-row-label">
                <span className="setting-row-icon">
                  <svg viewBox="0 0 24 24" width="22" height="22">
                    <path fill="currentColor" d="M7 14c-1.66 0-3 1.34-3 3 0 1.31-1.16 2-2 2 .92 1.22 2.49 2 4 2 2.21 0 4-1.79 4-4 0-1.66-1.34-3-3-3zm13.71-9.37l-1.34-1.34a1 1 0 0 0-1.41 0L9 12.25 11.75 15l8.96-8.96a1 1 0 0 0 0-1.41z"/>
                  </svg>
                </span>
                {t("appearance")}</div>
              <div className="setting-row-options">
                {["light", "dark", "auto"].map(theme => (
                  <label key={theme} className={`radio-option ${settings.theme === theme ? "active" : ""}`}>
                    <input
                      type="radio"
                      checked={settings.theme === theme}
                      onChange={() => setSettings(s => ({ ...s, theme: theme as Theme }))}
                    />
                    <span className="radio-dot" />
                    {t(theme)}
                  </label>
                ))}
              </div>
            </div>

            <div className="setting-divider" />

            {/* NOTIFICATIONS */}
            <div className="setting-row">
              <div className="setting-row-label">
                <span className="setting-row-icon">
                  <svg viewBox="0 0 24 24" width="22" height="22">
                    <path fill="currentColor" d="M18 16v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-5 0h-2v-2h2v2zm0-4h-2V8h2v4zm-1 10c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2z"/>
                  </svg>
                </span>
                {t("notifications")}
              </div>
              <div className="setting-row-options">
                <button
                  id="notifications-toggle"
                  className={`toggle-switch ${settings.notification ? "on" : "off"}`}
                  onClick={() => setSettings(s => ({ ...s, notification: !s.notification }))}
                  aria-label={t("toggle_notifications")}
                  type="button"
                >
                  <span className="toggle-knob" />
                </button>
              </div>
            </div>

            <div className="setting-divider" />

            {/* SAVE */}
            <div className="setting-save-area">
              <button
                id="settings-save-btn"
                className={`setting-save-btn ${saveStatus}`}
                onClick={handleSave}
                disabled={saving}
              >
                {saving
                  ? t("saving")
                  : saveStatus === "success"
                  ? `✓ ${t("saved")}`
                  : saveStatus === "error"
                  ? `✗ ${t("failed")}`
                  : t("save")}
              </button>
            </div>

          </div>

          {/* RIGHT – PREVIEW */}
          <div className="setting-preview">
            <div className="preview-window">
              <div className="preview-title">{t("preview")}</div>
              <div className={`preview-chat preview-${previewTheme}`}>
                <div className="preview-message">
                  <div className="preview-avatar">
                    <svg viewBox="0 0 24 24" width="22" height="22">
                      <path fill="currentColor" d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
                    </svg>
                  </div>
                  <div className="preview-bubble">
                    <span className="preview-speaker">{t("preview_speaker_1")}: </span>
                    {t("preview_text_1")}
                    <div className="preview-time">{t("preview_time_1")}</div>
                  </div>
                </div>
                <div className="preview-message">
                  <div className="preview-avatar">
                    <svg viewBox="0 0 24 24" width="22" height="22">
                      <path fill="currentColor" d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"/>
                    </svg>
                  </div>
                  <div className="preview-bubble">
                    <span className="preview-speaker">{t("preview_speaker_2")}: </span>
                    {t("preview_text_2")}
                    <div className="preview-time">{t("preview_time_2")}</div>
                  </div>
                </div>
              </div>
              {/* Audio bar */}
              <div className="preview-player">
                <span className="preview-player-time">{t("preview_player_start")}</span>
                <div className="preview-progress-bar">
                  <div className="preview-progress-fill" style={{ width: "30%" }} />
                </div>
                <span className="preview-player-time">{t("preview_player_end")}</span>
              </div>
              <div className="preview-play-btn">
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path fill="currentColor" d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
