import React, { useEffect, useRef, useState } from "react"
import { useLocation, useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import "./Forgot.css"

export default function Forgot() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"
  const hasAutoSentOtpRef = useRef(false)

  const initialEmail = String(location.state?.email || "").trim().toLowerCase()

  const [email] = useState(initialEmail)
  const [otp, setOtp] = useState(["", "", "", "", "", ""])
  const [message, setMessage] = useState("")
  const [loadingSend, setLoadingSend] = useState(false)
  const [loadingVerify, setLoadingVerify] = useState(false)
  const isOtpSentFromPreviousStep = Boolean(location.state?.otpSent)

  const handleBack = () => {
    if (location.state?.from === "user") {
      navigate("/profile/user")
    } else {
      navigate("/login")
    }
  }

  const isOtpComplete = otp.every((digit) => digit !== "")

  useEffect(() => {
    inputsRef.current[0]?.focus()
  }, [])

  useEffect(() => {
    if (!email) {
      setMessage(t("forgot_enter_email_first"))
      return
    }

    if (isOtpSentFromPreviousStep) {
      setMessage(t("otp_sent_to_email"))
      return
    }

    if (hasAutoSentOtpRef.current) {
      return
    }
    hasAutoSentOtpRef.current = true

    const sendOtp = async () => {
      setLoadingSend(true)
      setMessage("")
      try {
        const res = await fetch(`${API_BASE}/auth/password/forgot`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setMessage(data?.detail || t("cannot_send_otp"))
          return
        }
        setMessage(t("otp_sent_to_email"))
      } catch {
        setMessage(t("cannot_connect_server"))
      } finally {
        setLoadingSend(false)
      }
    }

    sendOtp().catch(() => {})
  }, [API_BASE, email, isOtpSentFromPreviousStep, t])

  const resendOtp = async () => {
    if (!email || loadingSend) return
    setLoadingSend(true)
    setMessage("")
    try {
      const res = await fetch(`${API_BASE}/auth/password/forgot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data?.detail || t("cannot_send_otp"))
        return
      }
      setMessage(t("otp_resent"))
      setOtp(["", "", "", "", "", ""])
      inputsRef.current[0]?.focus()
    } catch {
      setMessage(t("cannot_connect_server"))
    } finally {
      setLoadingSend(false)
    }
  }

  const verifyOtp = async () => {
    if (!isOtpComplete || !email) return
    setLoadingVerify(true)
    setMessage("")
    try {
      const code = otp.join("")
      const res = await fetch(`${API_BASE}/auth/password/verify-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          otp: code,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setMessage(data?.detail || t("invalid_otp"))
        return
      }

      navigate("/password/reset", {
        state: {
          email,
          accessToken: data?.access_token || "",
        },
      })
    } catch {
      setMessage(t("cannot_connect_server"))
    } finally {
      setLoadingVerify(false)
    }
  }

  return (
    <div className="forgot-page">
      <div className="forgot-top"></div>

      <div className="forgot-container">
        <div className="forgot-illustration">
          <img src="/forgot-illustration.png" alt="illustration" className="forgot-illustration" />
        </div>

        <p className="forgot-text">
          {t("forgot_verify_instruction")}
        </p>

        <div className="otp-group">
          {otp.map((value, index) => (
            <input
              key={index}
              ref={(el) => {
                inputsRef.current[index] = el
              }}
              className="otp-input"
              maxLength={1}
              value={value}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/, "")
                if (!val) return

                const newOtp = [...otp]
                newOtp[index] = val
                setOtp(newOtp)

                if (index < otp.length - 1) {
                  inputsRef.current[index + 1]?.focus()
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Backspace") {
                  if (otp[index]) {
                    const newOtp = [...otp]
                    newOtp[index] = ""
                    setOtp(newOtp)
                  } else if (index > 0) {
                    inputsRef.current[index - 1]?.focus()
                  }
                }
              }}
            />
          ))}
        </div>

        <div className="resend">
          {t("otp_not_received")} <span onClick={resendOtp}>{loadingSend ? t("sending") : t("resend_otp")}</span>
        </div>

        <button
          className={`verify-btn ${isOtpComplete ? "active" : ""}`}
          disabled={!isOtpComplete || loadingVerify}
          onClick={verifyOtp}
        >
          {loadingVerify ? t("verifying") : t("verify")}
        </button>

        {message ? <p className="forgot-text-message" style={{ marginTop: 14 }}>{message}</p> : null}

        <div className="forgotback-btn" onClick={handleBack}>
          {t("back")}
        </div>
      </div>
    </div>
  )
}
