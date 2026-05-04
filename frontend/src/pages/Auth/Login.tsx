import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import "./Login.css"

function Login() {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [message, setMessage] = useState("")
  const [loading, setLoading] = useState(false)
  const [forgotLoading, setForgotLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false)
  const [forgotModalMessage, setForgotModalMessage] = useState("")

  const navigate = useNavigate()
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"
  const SUPABASE_URL = import.meta.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || ""

  useEffect(() => {
    let cancelled = false
    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

    const resolveNeedsVoiceSetup = async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const samplesRes = await fetch(`${API_BASE}/voice-samples`, { credentials: "include" }).catch(() => null)
        if (samplesRes?.ok) {
          const samplesData = await samplesRes.json().catch(() => ({}))
          const list = Array.isArray(samplesData?.items)
            ? samplesData.items
            : Array.isArray(samplesData)
            ? samplesData
            : []
          return list.length === 0
        }
        await sleep(300)
      }
      return false
    }

    const finalizeOAuth = async () => {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : ""
      const params = new URLSearchParams(hash)
      const accessToken = params.get("access_token") || ""
      const refreshToken = params.get("refresh_token") || ""
      const expiresIn = Number(params.get("expires_in") || "3600")

      if (!accessToken) {
        setLoading(false)
        return
      }
      window.history.replaceState({}, document.title, window.location.pathname)
      setLoading(true)
      setMessage(t("signing_in_with_google"))

      try {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 15000)
        const res = await fetch(`${API_BASE}/auth/oauth/exchange`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          signal: controller.signal,
          body: JSON.stringify({
            access_token: accessToken,
            refresh_token: refreshToken || null,
            expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600,
          }),
        })
        window.clearTimeout(timeout)

        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (!cancelled) setMessage(data?.detail || t("google_login_failed"))
          return
        }

        const needsVoiceSetup = await resolveNeedsVoiceSetup()
        const target = needsVoiceSetup ? "/onboarding/google-voice" : "/home"
        window.dispatchEvent(new Event("auth-changed"))
        window.location.replace(target)
      } catch (e) {
        if (!cancelled) {
          const isAbort = e instanceof DOMException && e.name === "AbortError"
          setMessage(isAbort ? t("timeout_msg") : t("cannot_connect_server"))
        }
      } finally {
        setLoading(false)
      }
    }

    finalizeOAuth().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [API_BASE, t])

  const continueWithGoogle = () => {
    if (!SUPABASE_URL) {
      setMessage(t("missing_supabase_url"))
      return
    }

    const redirectTo = `${window.location.origin}/login?oauth=1`
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`
    window.location.assign(authUrl)
  }

  const login = async () => {
    setMessage("")

    const emailValue = email.trim().toLowerCase()
    if (!emailValue || !password) {
      setMessage(t("please_enter_email_password"))
      return
    }

    try {
      setLoading(true)

      const res = await fetch(`${API_BASE}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email: emailValue,
          password,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setMessage(data?.detail || data?.message || t("login_failed"))
        return
      }

      if (!data?.user?.id) {
        setMessage(t("session_not_ready"))
        return
      }

      window.dispatchEvent(new Event("auth-changed"))

      // go to home after successful login
      navigate("/home")
    } catch {
      setMessage(t("cannot_connect_server"))
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    const emailValue = email.trim().toLowerCase()
    if (!emailValue) {
      setMessage(t("enter_email_first"))
      return
    }

    setForgotLoading(true)
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/auth/password/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: emailValue }),
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        const detail = String(data?.detail || t("failed_forgot_password"))
        if (detail.toLowerCase().includes("google")) {
          setForgotModalMessage(detail)
          setIsForgotModalOpen(true)
          return
        }
        setMessage(detail)
        return
      }

      navigate("/password/forgot", {
        state: {
          from: "login",
          email: emailValue,
          otpSent: true,
        },
      })
    } catch {
      setMessage(t("cannot_connect_server"))
    } finally {
      setForgotLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-card">
          <div className="login-left">
            <h2 className="login-title">{t("welcome_back")}</h2>
            <p className="login-subtitle">{t("sign_in_to_continue")}</p>

            <div className="login-form-group">
              <label>{t("email")}</label>
              <input
                className="input"
                type="email"
                placeholder={t("email_example")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="login-form-group">
              <label>{t("password")}</label>
              <div className="input-wrapper">
                <input
                  className="input"
                  type={showPassword ? "text" : "password"}
                  placeholder={t("remember_me")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />

                <span
                  className="eye-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    // Eye OFF
                    <svg width="18" height="18" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M2 5l17 17M10.7 10.7a2 2 0 002.6 2.6M9.9 4.2A9.8 9.8 0 0112 4c5 0 9 4 10 8a10.5 10.5 0 01-3.1 4.7M6.5 6.5A10.4 10.4 0 002 12c1 4 5 8 10 8 1.4 0 2.7-.3 3.9-.8"
                      />
                    </svg>
                  ) : (
                    // Eye ON
                    <svg width="18" height="18" viewBox="0 0 24 24">
                      <path
                        fill="currentColor"
                        d="M12 5c-5 0-9 4-10 7 1 3 5 7 10 7s9-4 10-7c-1-3-5-7-10-7zm0 11a4 4 0 110-8 4 4 0 010 8z"
                      />
                    </svg>
                  )}
                </span>
              </div>
            </div>

            <button className="btn btn-primary" onClick={login} disabled={loading}>
              {loading ? t("please_wait") : t("login")}
            </button>

            <p className="forgot-text">
              {t("forgot_password")} {t("enter_email_then_click")}{" "}
              <span
                onClick={handleForgotPassword}
              >
                {forgotLoading ? t("checking") : t("here")}
              </span>
            </p>

            <div className="divider"><span>{t("or_continue_with")}</span></div>

            <div className="provider-list">
              <button
                type="button"
                className="google-icon-btn"
                onClick={continueWithGoogle}
                disabled={loading}
              >
                <svg width="20" height="20" viewBox="0 0 48 48">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.72 1.22 9.22 3.6l6.9-6.9C35.96 2.36 30.36 0 24 0 14.62 0 6.44 5.48 2.44 13.44l8.06 6.26C12.38 13.06 17.7 9.5 24 9.5z"/>
                  <path fill="#4285F4" d="M46.1 24.5c0-1.7-.14-3.34-.4-4.92H24v9.32h12.44c-.54 2.9-2.18 5.36-4.66 7.02l7.18 5.58C43.98 37.38 46.1 31.48 46.1 24.5z"/>
                  <path fill="#FBBC05" d="M10.5 28.7c-1.02-3.06-1.02-6.34 0-9.4l-8.06-6.26C.86 16.38 0 20.1 0 24s.86 7.62 2.44 10.96l8.06-6.26z"/>
                  <path fill="#34A853" d="M24 48c6.36 0 11.7-2.1 15.6-5.72l-7.18-5.58c-2 1.34-4.56 2.14-8.42 2.14-6.3 0-11.62-3.56-13.5-8.7l-8.06 6.26C6.44 42.52 14.62 48 24 48z"/>
                </svg>
              </button>
            </div>

            {message && <p className="login-msg">{message}</p>}
          </div>
        </div>

        <aside className="right-panel">
          <div className="brand-box"></div>
          <h3 className="right-title">{t("new_here")}</h3>
          <p className="right-desc">{t("create_account_desc")}</p>
          <Link to="/register"><button className="pill-outline">{t("sign_up")}</button></Link>

          <img src="/login-illustration.png" alt="illustration" className="login-illustration" />
        </aside>
      </div>

      {isForgotModalOpen ? (
        <div className="forgot-modal-overlay" onClick={() => setIsForgotModalOpen(false)}>
          <div className="forgot-modal" onClick={(event) => event.stopPropagation()}>
            <h3 className="forgot-modal-title">{t("cannot_reset_password")}</h3>
            <p className="forgot-modal-message">{forgotModalMessage}</p>
            <button
              type="button"
              className="forgot-modal-btn"
              onClick={() => setIsForgotModalOpen(false)}
            >
              {t("ok")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default Login

