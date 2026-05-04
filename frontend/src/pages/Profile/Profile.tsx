import React, { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import "./Profile.css"

type SessionUser = {
  name?: string
  avatar_url?: string
}

export default function Profile() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"
  const [currentUser, setCurrentUser] = useState<SessionUser | null>(null)

  useEffect(() => {
    let cancelled = false

    const loadSession = async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/session`, { credentials: "include" })
        const data = await res.json().catch(() => ({}))
        if (!cancelled && res.ok) {
          setCurrentUser(data?.user || null)
        }
      } catch {
        // ignore
      }
    }

    loadSession()
    return () => {
      cancelled = true
    }
  }, [API_BASE])

  const [profileData, setProfileData] = useState({
    name: "John Doe",
    dateCreated: "01/01/1999",
    avatarUrl: "",
  })

  useEffect(() => {
    setProfileData((prev) => ({
      ...prev,
      name: currentUser?.name || prev.name,
      avatarUrl: currentUser?.avatar_url || prev.avatarUrl || "",
    }))
  }, [currentUser])

  return (
    <div className="profile-page">
      <div className="profile-container">

        {/* LEFT */}
        <aside className="profile-left">
          <div className="profile-card">
            <div className="profile-avatar">
              {profileData?.avatarUrl ? (
                <img src={profileData.avatarUrl} alt="avatar" className="profile-avatar-image" />
              ) : (
                profileData?.name?.charAt(0) || "U"
              )}
            </div>

            <h3 className="profile-name">
              {profileData?.name || "John Doe"}
            </h3>

            <div className="profile-meta">
              {t("date_created")} {profileData?.dateCreated || "01/01/1999"}
            </div>
          </div>
        </aside>

        {/* RIGHT */}
        <main className="profile-right">
          <div className="profile-panel">

            {/* USER INFO */}
            <div
              className="nav-row"
              onClick={() => navigate("/profile/user")}
            >
              <div className="nav-icon">
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path
                    fill="currentColor"
                    d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"
                  />
                </svg>
              </div>
              <div className="nav-content">
                <div className="nav-title">{t("user_information")}</div>
                <div className="nav-desc">
                  {t("profile_desc")}
                </div>
              </div>
            </div>

            {/* VOICE SAMPLE */}
            <div
              className="nav-row"
              onClick={() => navigate("/profile/voice")}
            >
              <div className="nav-icon">
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path
                    fill="currentColor"
                    d="M12 14c1.7 0 3-1.3 3-3V5c0-1.7-1.3-3-3-3S9 3.3 9 5v6c0 1.7 1.3 3 3 3zm5-3c0 2.8-2.2 5.1-5 5.1S7 13.8 7 11H5c0 3.5 2.6 6.4 6 6.9V21h2v-3.1c3.4-.5 6-3.4 6-6.9h-2z"
                  />
                </svg>
              </div>
              <div className="nav-content">
                <div className="nav-title">{t("voice_sample")}</div>
                <div className="nav-desc">
                  {t("voice_sample_desc")}
                </div>
              </div>
            </div>

            {/* SETTINGS */}
            <div
              className="nav-row"
              onClick={() => navigate("/profile/settings")}
            >
              <div className="nav-icon">
                <svg viewBox="0 0 24 24" width="20" height="20">
                  <path
                    fill="currentColor"
                    d="M19.4 13a7.9 7.9 0 0 0 .1-2l2.1-1.6-2-3.5-2.5 1a7.6 7.6 0 0 0-1.7-1L13 2h-4l-.4 2.9c-.6.3-1.2.6-1.7 1l-2.5-1-2 3.5L4.5 11a7.9 7.9 0 0 0 0 2l-2.1 1.6 2 3.5 2.5-1c.5.4 1.1.7 1.7 1L9 22h4l.4-2.9c.6-.3 1.2-.6 1.7-1l2.5 1 2-3.5L19.4 13zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"
                  />
                </svg>
              </div>
              <div className="nav-content">
                <div className="nav-title">{t("settings")}</div>
                <div className="nav-desc">
                  {t("settings_desc")}
                </div>
              </div>
            </div>

            {/* LOGOUT */}
            <div className="logout-wrapper">
              <button
                className="logout-btn"
                onClick={async () => {
                  try {
                    await fetch(`${API_BASE}/logout`, { method: "POST", credentials: "include" })
                  } catch {
                    // ignore
                  }
                  window.dispatchEvent(new Event("auth-changed"))
                  navigate("/")
                }}
              >
                <svg viewBox="0 0 24 24" width="18" height="18">
                  <path
                    fill="currentColor"
                    d="M16 13v-2H7V8l-5 4 5 4v-3h9zm3-11H9a2 2 0 0 0-2 2v4h2V4h10v16H9v-4H7v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"
                  />
                </svg>
                <span>{t("log_out")}</span>
              </button>
            </div>

          </div>
        </main>

      </div>
    </div>
  )
}
