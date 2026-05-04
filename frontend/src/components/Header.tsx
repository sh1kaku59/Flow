import { useNavigate, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useEffect, useState } from "react"
import "./Header.css"
function Header() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const isActive = (path) => location.pathname === path
  const [avatarUrl, setAvatarUrl] = useState<string>("")

  useEffect(() => {
    let cancelled = false
  
    const loadSession = async () => {
      try {
        const res = await fetch(`${import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"}/auth/session`, {
          credentials: "include"
        })
  
        const data = await res.json().catch(() => ({}))
  
        if (!cancelled && res.ok) {
          setAvatarUrl(String(data?.user?.avatar_url || "").trim())
        }
      } catch {
        // ignore
      }
    }
  
    loadSession()
  
    return () => {
      cancelled = true
    }
  }, [])
  
  return (
    <header className="app-header">
      <div className="header-inner">

        {/* LOGO */}
        <div className="logo">
          <img src="/logo.png" alt="logo" />
        </div>

        <div className="header-actions">
          <button
            className={`nav-pill ${isActive("/home") ? "active" : ""}`}
            onClick={() => navigate("/home")}
          >
            {t("upload")}
          </button>

          <button
            className={`nav-pill ${isActive("/diary") ? "active" : ""}`}
            onClick={() => navigate("/diary")}
          >
            {t("diary")}
          </button>

          {/* AVATAR */}
          <button
            className={`avatar-btn ${isActive("/profile") ? "active" : ""}`}
            onClick={() => navigate("/profile")}
          >
            {avatarUrl ? (
              <img src={avatarUrl} alt="avatar" className="avatar-image" />
            ) : (
              <svg viewBox="0 0 24 24" className="avatar-icon">
                <path
                  d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v1h20v-1c0-3.3-6.7-5-10-5z"
                  fill="currentColor"
                />
              </svg>
            )}
          </button>

        </div>
      </div>
    </header>
  )
}

export default Header
