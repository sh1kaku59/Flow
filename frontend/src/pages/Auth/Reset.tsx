import React, { useEffect, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import "./Reset.css"

export default function Reset() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"

  const accessToken = String(location.state?.accessToken || "").trim()

  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [show, setShow] = useState(false)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState("")

  const isValid = Boolean(password && confirm && password === confirm)

  useEffect(() => {
    if (!accessToken) {
      setMessage(t("invalid_reset_session"))
    }
  }, [accessToken, t])

  const submitReset = async () => {
    if (!isValid || !accessToken) return

    setLoading(true)
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/auth/password/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          access_token: accessToken,
          new_password: password,
        }),
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data?.detail || t("reset_password_failed"))
        return
      }

      setMessage(t("reset_password_success_redirect"))
      setTimeout(() => navigate("/login"), 900)
    } catch {
      setMessage(t("cannot_connect_server"))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="reset-page">
      <div className="reset-bg">
        <div className="reset-card">
          <div className="reset-illustration">
            <img src="/reset-illustration.png" alt="illustration" className="reset-illustration" />
          </div>

          <div className="reset-form">
            <div className="input-group">
              <input
                type={show ? "text" : "password"}
                placeholder={t("new_password")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />

              <div className="eye-icon" onClick={() => setShow(!show)}>
                {show ? (
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M2 5l17 17M10.7 10.7a2 2 0 002.6 2.6M9.9 4.2A9.8 9.8 0 0112 4c5 0 9 4 10 8a10.5 10.5 0 01-3.1 4.7M6.5 6.5A10.4 10.4 0 002 12c1 4 5 8 10 8 1.4 0 2.7-.3 3.9-.8"
                    />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M12 5c-5 0-9 4-10 7 1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z"
                    />
                  </svg>
                )}
              </div>
            </div>

            <div className="input-group">
              <input
                type="password"
                placeholder={t("confirm_new_password")}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            <button
              className={`reset-btn ${isValid && !loading && accessToken ? "active" : ""}`}
              disabled={!isValid || loading || !accessToken}
              onClick={submitReset}
            >
              {loading ? t("resetting") : t("reset")}
            </button>

            {message ? <p style={{ textAlign: "center", marginTop: 10 }}>{message}</p> : null}
          </div>
        </div>
      </div>
    </div>
  )
}
