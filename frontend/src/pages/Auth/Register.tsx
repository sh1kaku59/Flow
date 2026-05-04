import { useState } from "react"
import type { FormEvent } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import VoiceSampleSetup, { type VoiceSampleSubmitPayload } from "../../components/VoiceSampleSetup"
import "./Register.css"

type RegisterMode = "register" | "google-onboarding"

type RegisterProps = {
  mode?: RegisterMode
}

function Register({ mode = "register" }: RegisterProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const SUPABASE_URL = import.meta.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || ""
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"
  const isGoogleOnboarding = mode === "google-onboarding"

  const [step, setStep] = useState(isGoogleOnboarding ? 2 : 1) // 1: basic info, 2: voice sample
  const today = new Date().toISOString().split("T")[0]

  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [dateOfBirth, setDateOfBirth] = useState("")
  const [showPassword, setShowPassword] = useState(false)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  const continueWithGoogle = () => {
    if (!SUPABASE_URL) {
      setError(t("missing_supabase_url"))
      return
    }
    const redirectTo = `${window.location.origin}/login?oauth=1`
    const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`
    window.location.assign(authUrl)
  }

  const submitRegister = async ({ sampleName, avatarFile, voiceFile, recordedBlob }: VoiceSampleSubmitPayload) => {
    try {
      setLoading(true)
      setError("")
      setSuccess("")

      const formData = new FormData()
      formData.append("fullName", fullName.trim())
      formData.append("email", email.trim())
      formData.append("password", password)
      formData.append("dateOfBirth", dateOfBirth)
      formData.append("speakerName", sampleName)

      if (voiceFile) {
        formData.append("voiceSample", voiceFile)
      } else if (recordedBlob) {
        const recordedFile = new File([recordedBlob], `voice-sample-${Date.now()}.webm`, {
          type: recordedBlob?.type || "audio/webm",
        })
        formData.append("voiceSample", recordedFile)
      }

      if (avatarFile) {
        formData.append("avatar", avatarFile)
      }

      const res = await fetch(`${API_BASE}/register`, {
        method: "POST",
        credentials: "include",
        body: formData,
      })

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.detail || data?.message || t("register_failed"))
        return
      }

      if (data?.user?.id || data?.user_id) {
        setSuccess(t("register_success_signing_in"))
        window.dispatchEvent(new Event("auth-changed"))
        navigate("/home")
        return
      }

      setSuccess(t("register_success_please_login"))
      setTimeout(() => navigate("/login"), 700)
    } catch {
      setError(t("cannot_connect_server"))
    } finally {
      setLoading(false)
    }
  }

  const submitGoogleVoiceSetup = async ({ sampleName, avatarFile, voiceFile, recordedBlob }: VoiceSampleSubmitPayload) => {
    try {
      setLoading(true)
      setError("")
      setSuccess("")

      const formData = new FormData()
      formData.append("speakerName", sampleName)

      if (voiceFile) {
        formData.append("voiceSample", voiceFile)
      } else if (recordedBlob) {
        const recordedFile = new File([recordedBlob], `voice-sample-${Date.now()}.webm`, {
          type: recordedBlob?.type || "audio/webm",
        })
        formData.append("voiceSample", recordedFile)
      }

      if (avatarFile) {
        formData.append("avatar", avatarFile)
      }

      const res = await fetch(`${API_BASE}/voice-samples`, {
        method: "POST",
        credentials: "include",
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.detail || t("failed_create_voice_sample"))
        return
      }

      setSuccess(t("save_voice_sample_success"))
      setTimeout(() => navigate("/home", { replace: true }), 450)
    } catch {
      setError(t("cannot_connect_server"))
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitBasicInfo = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError("")
    setSuccess("")

    if (!fullName.trim() || !email.trim() || !password || !dateOfBirth) {
      setError(t("please_enter_all_fields"))
      return
    }
    setStep(2)
  }

  return (
    <div className="register-page">
      <div className="register-container">
        <aside className="left-panel">
          <h2 className="left-title">{isGoogleOnboarding ? t("one_more_step") : t("already_one_of_us")}</h2>
          <p className="left-desc">
            {isGoogleOnboarding
              ? t("voice_setup_desc")
              : t("create_account_desc")}
          </p>
          {!isGoogleOnboarding && (
            <button className="pill-outline" onClick={() => navigate("/login")}>
              {t("login")}
            </button>
          )}

          <img src="/signup-illustration.png" alt="illustration" className="register-illustration" />
        </aside>

        <div className="register-card">
          <h2 className="register-title">{isGoogleOnboarding ? t("setup_voice_sample") : t("create_free_account")}</h2>

          {!isGoogleOnboarding && step === 1 ? (
            <form onSubmit={handleSubmitBasicInfo} className="register-form">
              <div className="field">
                <label>{t("full_name")}</label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t("your_name")}
                  required
                />
              </div>

              <div className="field">
                <label>{t("email_address")}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div className="field">
                <label>{t("date_of_birth")}</label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  max={today}
                  required
                />
              </div>

              <div className="field password-field">
                <label>{t("password")}</label>

                <div className="input-wrapper">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                    required
                  />

                  <span
                    className="toggle-password"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
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
                  </span>
                </div>
              </div>

              <div className="form-actions">
                <button className="submit-btn" type="submit">{t("continue")}</button>
              </div>

              <div className="divider"><span>{t("or_continue_with")}</span></div>

              <div className="provider-list">
                <button type="button" className="provider-btn" onClick={continueWithGoogle}>
                  <svg width="18" height="18" viewBox="0 0 48 48">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.7 1.1 7.8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.2-.1-2.3-.4-3.5z" />
                    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c3 0 5.7 1.1 7.8 3l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" />
                    <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.3l-6.3-5.2C29.3 36 26.8 37 24 37c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 40.3 16.3 44 24 44z" />
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-1.1 3-3.5 5.3-6.7 6.6l6.3 5.2C38.3 36.6 44 30.9 44 24c0-1.2-.1-2.3-.4-3.5z" />
                  </svg>
                </button>
              </div>
            </form>
          ) : (
            <VoiceSampleSetup
              loading={loading}
              error={error}
              success={success}
              defaultSampleName={fullName}
              showBackButton={!isGoogleOnboarding}
              onBack={() => setStep(1)}
              onSubmit={isGoogleOnboarding ? submitGoogleVoiceSetup : submitRegister}
            />
          )}

          {step === 1 && error ? <p className="msg error">{error}</p> : null}
          {step === 1 && success ? <p className="msg success">{success}</p> : null}
        </div>
      </div>
    </div>
  )
}

export default Register
