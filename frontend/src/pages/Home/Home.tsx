import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import "./Home.css"
const PHASES = [
  { key: "preprocessing", label: "voice_separation_speaker_recognition", subtitle: "stt_next" },
  { key: "stt", label: "speech_to_text", subtitle: "analyze_next" },
  { key: "analysis", label: "analyzing", subtitle: "almost_there" },
]

const PHASE_LABELS = PHASES.reduce((acc, p) => {
  acc[p.key] = p.label
  return acc
}, {})
const ACTIVE_AUDIO_KEY = "flowActiveAudioId"

function Home() {
  const { t } = useTranslation()
  const uploadInputRef = useRef(null)
  const [uploadFile, setUploadFile] = useState(null)
  const [notice, setNotice] = useState("")
  const [noticeType, setNoticeType] = useState("info")
  const [loading, setLoading] = useState(false)
  const [audioId, setAudioId] = useState("")
  const [dragging, setDragging] = useState(false)
  const [steps, setSteps] = useState([])
  const [sseConnected, setSseConnected] = useState(false)
  const [showTranscriptModal, setShowTranscriptModal] = useState(false)
  const [transcriptSegments, setTranscriptSegments] = useState([])
  const [processingElapsedSec, setProcessingElapsedSec] = useState(null)


  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"
  const completionHandledRef = useRef("")

  const getAuthOptions = (): RequestInit => ({ credentials: "include" })

  const formatTime = (value) => {
    const sec = Number(value)
    if (!Number.isFinite(sec) || sec < 0) return "00:00"
    const hh = Math.floor(sec / 3600)
    const mm = Math.floor((sec % 3600) / 60)
    const ss = Math.floor(sec % 60)
    if (hh > 0) {
      return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    }
    return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
  }

  const fetchMeetingResultAndOpenModal = async (meetingId: string, options: { maxAttempts?: number; retryMs?: number } = {}) => {
    const maxAttempts = Number(options?.maxAttempts || 8)
    const retryMs = Number(options?.retryMs || 1000)
    let lastError = null

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const res = await fetch(`${API_BASE}/audio/${meetingId}`, getAuthOptions())
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.detail || t("cannot_open_transcript"))
        }

        const segs = Array.isArray(data?.segments) ? data.segments : []
        const normalized = segs.map((s, idx) => ({
          id: s?.id || `${idx}`,
          speaker: String(s?.speaker_label || s?.speaker || "UNKNOWN").trim() || "UNKNOWN",
          start: Number(s?.start_time || 0),
          end: Number(s?.end_time || 0),
          text: String(s?.content || "").trim(),
        }))

        const isCompleted = String(data?.audio?.status || "").toLowerCase() === "completed"
        const hasTranscript = normalized.length > 0
        if (isCompleted && (hasTranscript || attempt === maxAttempts)) {
          const elapsed = Number(data?.audio?.processing_time?.elapsed_seconds)
          setProcessingElapsedSec(Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null)
          setTranscriptSegments(normalized)
          setShowTranscriptModal(true)
          return
        }
      } catch (e) {
        lastError = e
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, retryMs))
      }
    }

    if (lastError) {
      throw lastError
    }
    throw new Error(t("cannot_open_transcript"))
  }

  const pickUploadFile = () => uploadInputRef.current?.click()

  const setUploadFromFile = (file) => {
    if (!file) return
    if (!file.type.startsWith("audio/")) {
      setNoticeType("error")
      setNotice(t("only_audio_supported"))
      return
    }
    setUploadFile(file)
    setAudioId("")
    setSteps([])
    setProcessingElapsedSec(null)
    setNoticeType("info")
    setNotice(`${t("selected")}: ${file.name}`)
  }

  const handleUploadFileChange = (e) => {
    const file = e.target.files?.[0]
    setUploadFromFile(file)
  }

  const handleDropUpload = (e) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    setUploadFromFile(file)
  }

  const clearSelectedFile = () => {
    setUploadFile(null)
    setAudioId("")
    setSteps([])
    setProcessingElapsedSec(null)
    setTranscriptSegments([])
    setShowTranscriptModal(false)
    setLoading(false)
    completionHandledRef.current = ""
    localStorage.removeItem(ACTIVE_AUDIO_KEY)
    if (uploadInputRef.current) uploadInputRef.current.value = ""
    setNoticeType("info")
    setNotice(t("file_cleared"))
  }

  const applyStatusUpdate = async (data, targetAudioId = audioId) => {
    const stepList = Array.isArray(data?.steps) ? data.steps : []
    setSteps(stepList)

    const elapsed = Number(data?.processing_time?.elapsed_seconds)
    if (Number.isFinite(elapsed) && elapsed >= 0) {
      setProcessingElapsedSec(elapsed)
    }

    if (data?.meeting_status === "completed" && targetAudioId) {
      if (completionHandledRef.current === targetAudioId) return
      completionHandledRef.current = targetAudioId
      setLoading(false)
      setNoticeType("success")
      const doneElapsed = Number(data?.processing_time?.elapsed_seconds)
      const suffix = Number.isFinite(doneElapsed) && doneElapsed >= 0 ? ` ${t("in")} ${formatTime(doneElapsed)}` : ""
      setNotice(`${t("processing_complete")}${suffix}`)
      try {
        await fetchMeetingResultAndOpenModal(targetAudioId, { maxAttempts: 10, retryMs: 1200 })
      } catch (e) {
        setNoticeType("error")
        setNotice(String(e?.message || t("cannot_open_transcript")))
      }
      localStorage.removeItem(ACTIVE_AUDIO_KEY)
    }

    if (data?.meeting_status === "failed") {
      setLoading(false)
      setNoticeType("error")
      const failed = stepList.find((s) => s.status === "failed")
      const failedMsg = String(
        failed?.error_message ||
        data?.current_message ||
        data?.job?.error_message ||
        ""
      ).trim()
      setNotice(`${t("processing_failed")}${failedMsg ? `: ${failedMsg}` : "."}`)
      localStorage.removeItem(ACTIVE_AUDIO_KEY)
    }
  }

  useEffect(() => {
    const restore = async () => {
      const savedAudioId = String(localStorage.getItem(ACTIVE_AUDIO_KEY) || "").trim()
      if (!savedAudioId) return

      try {
        const res = await fetch(`${API_BASE}/audio/${savedAudioId}/status`, getAuthOptions())
        if (!res.ok) {
          localStorage.removeItem(ACTIVE_AUDIO_KEY)
          return
        }
        const data = await res.json()
        const meetingStatus = String(data?.meeting_status || "").toLowerCase()

        if (meetingStatus === "processing" || meetingStatus === "pending") {
          setAudioId(savedAudioId)
          setLoading(true)
          setNoticeType("info")
          setNotice(`${t("request_received")} Audio ID: ${savedAudioId}`)
          await applyStatusUpdate(data, savedAudioId)
          return
        }

        if (meetingStatus === "completed") {
          setAudioId(savedAudioId)
          await applyStatusUpdate(data, savedAudioId)
          return
        }

        localStorage.removeItem(ACTIVE_AUDIO_KEY)
      } catch {
        // keep key for next retry
      }
    }

    restore().catch(() => { })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE])

  useEffect(() => {
    if (!audioId || !loading) return

    const streamUrl = `${API_BASE}/audio/${audioId}/stream`
    const source = new EventSource(streamUrl, { withCredentials: true })
    let closed = false

    source.addEventListener("open", () => {
      if (!closed) setSseConnected(true)
    })

    source.addEventListener("status", (event) => {
      try {
        const payload = JSON.parse(event?.data || "{}")
        applyStatusUpdate(payload).catch(() => { })
      } catch {
        // ignore invalid payload
      }
    })

    source.addEventListener("error", () => {
      if (!closed) {
        setSseConnected(false)
      }
    })

    return () => {
      closed = true
      setSseConnected(false)
      source.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE, audioId, loading])

  useEffect(() => {
    if (!audioId || !loading) return

    let isCancelled = false
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/audio/${audioId}/status`, getAuthOptions())
        if (!res.ok) return

        const data = await res.json()
        if (isCancelled) return
        await applyStatusUpdate(data)
      } catch {
        // Silent poll error; next tick will retry.
      }
    }, sseConnected ? 3000 : 1500)

    return () => {
      isCancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API_BASE, audioId, loading, sseConnected])



  const handleUploadMeeting = async () => {
    if (!uploadFile) {
      setNoticeType("error")
      setNotice(t("please_select_meeting_file"))
      return
    }

    try {
      setLoading(true)
      setNoticeType("info")
      setNotice(t("uploading_init"))

      const formData = new FormData()
      formData.append("file", uploadFile)

      const res = await fetch(`${API_BASE}/audio/upload`, {
        method: "POST",
        credentials: "include",
        body: formData,
      })

      const data = await res.json()
      if (!res.ok) {
        setLoading(false)
        setNoticeType("error")
        setNotice(data?.detail || t("upload_failed"))
        return
      }

      setAudioId(data.audio_id || "")
      localStorage.setItem(ACTIVE_AUDIO_KEY, data.audio_id || "")
      completionHandledRef.current = ""
      setSteps([])
      setProcessingElapsedSec(null)
      setNoticeType("info")
      setNotice(t("request_received"))
      setUploadFile(null)
      if (uploadInputRef.current) uploadInputRef.current.value = ""
    } catch {
      setLoading(false)
      setNoticeType("error")
      setNotice(t("cannot_connect_backend"))
    }
  }


  return (
    <div className="home-page">

      <main className="mock-main">
        {!loading ? (
          <>
            <h2 className="main-title">{t("upload_title")}</h2>
            <div
              className={`upload-drop 
                ${dragging ? "is-dragging" : ""} 
                ${uploadFile ? "has-file" : ""}`}
              role="button"
              tabIndex={0}
              onClick={pickUploadFile}
              onDrop={handleDropUpload}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") pickUploadFile()
              }}
            >
              {!uploadFile ? (
                <>
                  <div className="upload-icon">
                    <svg viewBox="0 0 24 24" width="40" height="40">
                      <path
                        fill="currentColor"
                        d="M12 3l4 4h-3v6h-2V7H8l4-4zm-7 14h14v2H5v-2z"
                      />
                    </svg>
                  </div>

                  <div className="upload-text">{t("drag_drop")}</div>
                  <div className="upload-or">{t("or")}</div>

                  <button
                    className="browse-btn"
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      pickUploadFile()
                    }}
                  >
                    {t("browse_file")}
                  </button>
                </>
              ) : (
                <div className="file-preview">
                  <div className="file-icon">
                    <svg viewBox="0 0 24 24" width="80" height="80">
                      <path
                        fill="currentColor"
                        d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z"
                      />
                    </svg>
                  </div>

                  <div className="file-info">
                    <div className="file-name">{uploadFile.name}</div>
                    <div className="file-size">
                      {(uploadFile.size / (1024 * 1024)).toFixed(2)} MB
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="footer-actions">
              <button className="action-btn primary" type="button" onClick={handleUploadMeeting}>
                {t("process_upload")}
              </button>
              <button className="action-btn" type="button" onClick={clearSelectedFile}>
                {t("clear")}
              </button>
              {audioId && !loading && (
                <button
                  className="action-btn"
                  type="button"
                  onClick={() => fetchMeetingResultAndOpenModal(audioId).catch(() => {
                    setNoticeType("error")
                    setNotice(t("cannot_open_transcript_notice"))
                  })}
                >
                  {t("view_transcript")}
                </button>
              )}
            </div>
          </>
        ) : (
          (() => {
            let currentStepIndex = 1;
            const processingStep = steps.find((s) => s.status === "processing");
            if (processingStep && processingStep.step_order) {
              currentStepIndex = processingStep.step_order;
            } else {
              const completedSteps = steps.filter(s => s.status === "completed").sort((a, b) => b.step_order - a.step_order);
              if (completedSteps.length > 0) {
                currentStepIndex = Math.min(completedSteps[0].step_order + 1, 3);
              }
            }
            const currentPhase = PHASES[currentStepIndex - 1] || PHASES[0];

            return (
              <div className={`dynamic-processing-modal step-${currentStepIndex}`}>
                <div className="dpm-glass-layer"></div>
                <div className="dpm-progress-header">
                  <div className={`dpm-step ${currentStepIndex >= 1 ? "active" : ""}`}>{t("step")} 1</div>
                  <div className={`dpm-line ${currentStepIndex >= 2 ? "active" : ""}`}></div>
                  <div className={`dpm-step ${currentStepIndex >= 2 ? "active" : ""}`}>{t("step")} 2</div>
                  <div className={`dpm-line ${currentStepIndex >= 3 ? "active" : ""}`}></div>
                  <div className={`dpm-step ${currentStepIndex >= 3 ? "active" : ""}`}>{t("step")} 3</div>
                </div>

                <div className="dpm-content">
                  <h2 className="dpm-title">{t(currentPhase.label)}</h2>
                  <p className="dpm-subtitle">{t(currentPhase.subtitle)}</p>

                  <div className="dpm-icon-wrapper">
                    {currentStepIndex === 1 && (
                      <svg viewBox="0 0 24 24" width="100" height="100" fill="white">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                        <path d="M18.85 5.86l-1.05 1.05c1.32 1.32 1.32 3.46 0 4.77l1.05 1.05c1.9-1.9 1.9-4.97 0-6.87z" />
                        <path d="M20.95 3.75l-1.06 1.06c2.47 2.47 2.47 6.49 0 8.96l1.06 1.06c3.06-3.06 3.06-8.03 0-11.08z" />
                      </svg>
                    )}
                    {currentStepIndex === 2 && (
                      <svg viewBox="0 0 24 24" width="100" height="100" fill="white">
                        <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                        <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
                        <text x="18" y="22" fontSize="12" fontWeight="bold" fill="white" fontFamily="sans-serif">A</text>
                        <path d="M14 18l3-3 3 3M17 15v8" stroke="white" strokeWidth="2" fill="none" />
                      </svg>
                    )}
                    {currentStepIndex === 3 && (
                      <div className="dpm-spinner"></div>
                    )}
                  </div>

                  <p className="dpm-footer">{t("processing_msg")}</p>
                  <p className="dpm-footer">{t("leave_page_msg")}</p>
                </div>
              </div>
            );
          })()
        )}
      </main>

      {notice && <div className={`mock-notice ${noticeType}`}>{notice}</div>}
      {audioId && !loading && (
        <div className="audio-id">Audio ID: {audioId}</div>
      )}

      <input
        ref={uploadInputRef}
        type="file"
        accept=".aac,.adts,.m4a,.mp3,.wav,.flac,.ogg,.opus,.webm,audio/*"
        hidden
        onChange={handleUploadFileChange}
      />

      {showTranscriptModal && (
        <div className="transcript-modal-overlay" onClick={() => setShowTranscriptModal(false)}>
          <div className="transcript-modal" onClick={(e) => e.stopPropagation()}>
            <div className="transcript-header">
              <div>
                <h3>{t("transcript_result")}</h3>
                {processingElapsedSec !== null && (
                  <div className="transcript-processing-time">{t("processing_time")}: {formatTime(processingElapsedSec)}</div>
                )}
              </div>
              <button
                type="button"
                className="transcript-close"
                onClick={() => setShowTranscriptModal(false)}
              >
                x
              </button>
            </div>

            <div className="transcript-list">
              {transcriptSegments.length === 0 ? (
                <div className="transcript-empty">{t("no_transcript_content")}</div>
              ) : (
                transcriptSegments.map((row) => (
                  <div key={row.id} className="transcript-item">
                    <div className="transcript-meta">
                      <span className="speaker">{row.speaker}</span>
                      <span className="time">
                        {formatTime(row.start)} - {formatTime(row.end)}
                      </span>
                    </div>
                    <div className="transcript-text">{row.text || t("no_content")}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Home
