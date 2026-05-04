import React, { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import VoiceSampleSetup, { type VoiceSampleSubmitPayload } from "../../components/VoiceSampleSetup"
import "./Voice.css"

export default function Voice() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"

  const ITEMS_PER_PAGE = 5
  const [samples, setSamples] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [syncingQueue, setSyncingQueue] = useState(false)
  const [error, setError] = useState("")

  const [currentPage, setCurrentPage] = useState(1)
  const [isAddSampleModalOpen, setIsAddSampleModalOpen] = useState(false)
  const [addSampleError, setAddSampleError] = useState("")
  const [addSampleSuccess, setAddSampleSuccess] = useState("")
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)

  const [editingSample, setEditingSample] = useState<any | null>(null)
  const [editName, setEditName] = useState("")
  const [editAvatarFile, setEditAvatarFile] = useState<File | null>(null)
  const [editAvatarPreviewUrl, setEditAvatarPreviewUrl] = useState("")

  const totalPages = Math.max(1, Math.ceil(samples.length / ITEMS_PER_PAGE))
  const normalizedCurrentPage = Math.min(currentPage, totalPages)
  const startIndex = (normalizedCurrentPage - 1) * ITEMS_PER_PAGE
  const currentItems = samples.slice(startIndex, startIndex + ITEMS_PER_PAGE)

  const fetchSamples = useCallback(async () => {
    try {
      setLoading(true)
      setError("")
      const res = await fetch(`${API_BASE}/voice-samples`, {
        method: "GET",
        credentials: "include",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.detail || t("failed_load_samples"))
        setSamples([])
        return
      }
      setSamples(Array.isArray(data?.items) ? data.items : [])
    } catch {
      setError(t("failed_connect_server"))
      setSamples([])
    } finally {
      setLoading(false)
    }
  }, [API_BASE, t])

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchSamples().catch(() => {})
    }, 0)
    return () => clearTimeout(timer)
  }, [fetchSamples])

  useEffect(() => {
    if (!editAvatarFile) {
      return
    }
    const url = URL.createObjectURL(editAvatarFile)
    const timer = setTimeout(() => setEditAvatarPreviewUrl(url), 0)
    return () => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
    }
  }, [editAvatarFile])

  const getPages = () => {
    const pages = []
    const maxVisible = 5

    let start = Math.max(normalizedCurrentPage - 2, 1)
    let end = Math.min(start + maxVisible - 1, totalPages)

    if (end - start < maxVisible - 1) {
      start = Math.max(end - maxVisible + 1, 1)
    }

    for (let i = start; i <= end; i += 1) {
      pages.push(i)
    }

    return pages
  }

  const defaultAvatar = useMemo(() => {
    return (
      <div className="sample-avatar-placeholder">
        <svg viewBox="0 0 24 24" width="34" height="34">
          <path fill="currentColor" d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.97 0-9 2.24-9 5v1h18v-1c0-2.76-4.03-5-9-5z" />
        </svg>
      </div>
    )
  }, [])

  const submitAddSample = async ({ sampleName, avatarFile, voiceFile, recordedBlob }: VoiceSampleSubmitPayload) => {
    const finalVoiceFile =
      voiceFile ||
      (recordedBlob
        ? new File([recordedBlob], `voice-sample-${Date.now()}.webm`, {
            type: recordedBlob.type || "audio/webm",
          })
        : null)

    if (!finalVoiceFile) {
      setAddSampleError(t("voice_sample_required"))
      return
    }

    try {
      setSubmitting(true)
      setAddSampleError("")
      setAddSampleSuccess("")

      const beforeCount = samples.length
      const formData = new FormData()
      formData.append("speakerName", sampleName.trim())
      formData.append("voiceSample", finalVoiceFile)
      if (avatarFile) formData.append("avatar", avatarFile)

      const res = await fetch(`${API_BASE}/voice-samples`, {
        method: "POST",
        credentials: "include",
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setAddSampleError(data?.detail || t("failed_create_sample"))
        return
      }

      setAddSampleSuccess(t("add_sample_btn"))
      setIsAddSampleModalOpen(false)
      await fetchSamples()
      setCurrentPage(1)

      setSyncingQueue(true)
      const maxRounds = 20
      for (let i = 0; i < maxRounds; i += 1) {
        await new Promise((r) => setTimeout(r, 1500))
        await fetchSamples()
        const latestRes = await fetch(`${API_BASE}/voice-samples`, {
          method: "GET",
          credentials: "include",
        })
        const latestData = await latestRes.json().catch(() => ({}))
        const latestCount = Array.isArray(latestData?.items) ? latestData.items.length : 0
        if (latestCount > beforeCount) {
          break
        }
      }
      setSyncingQueue(false)
    } catch {
      setAddSampleError(t("failed_connect_server"))
    } finally {
      setSubmitting(false)
      setSyncingQueue(false)
    }
  }

  const openEditModal = (item: any) => {
    setEditingSample(item)
    setEditName(String(item?.speaker_name || ""))
    setEditAvatarFile(null)
    setEditAvatarPreviewUrl(String(item?.avatar_signed_url || ""))
    setError("")
    setIsEditModalOpen(true)
  }

  const closeEditModal = () => {
    setIsEditModalOpen(false)
    setEditingSample(null)
    setEditName("")
    setEditAvatarFile(null)
  }

  const submitEditSample = async () => {
    if (!editingSample?.id) return
    if (!editName.trim()) {
      setError(t("please_enter_sample_name"))
      return
    }

    try {
      setSubmitting(true)
      setError("")
      const formData = new FormData()
      formData.append("speakerName", editName.trim())
      if (editAvatarFile) formData.append("avatar", editAvatarFile)

      const res = await fetch(`${API_BASE}/voice-samples/${editingSample.id}`, {
        method: "PATCH",
        credentials: "include",
        body: formData,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.detail || t("failed_update_sample"))
        return
      }

      closeEditModal()
      await fetchSamples()
    } catch {
      setError(t("failed_connect_server"))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteSample = async () => {
    if (!editingSample?.id) return
    try {
      setSubmitting(true)
      setError("")
      const res = await fetch(`${API_BASE}/voice-samples/${editingSample.id}`, {
        method: "DELETE",
        credentials: "include",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.detail || t("failed_delete_sample"))
        return
      }

      closeEditModal()
      await fetchSamples()
    } catch {
      setError(t("failed_connect_server"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="voice-page">
      <div className="voice-container">
        <div className="voice-header">
          <button className="back-btn" onClick={() => navigate("/profile")}>
            ? {t("back")}
          </button>
          <h1>{t("voice_sample_title")}</h1>
        </div>

        <div className="voice-panel">
          <div className="voice-top">
            <div className="voice-count">
              {t("all_samples")} <span>{samples.length}</span>
            </div>

            <button
              className="addvoice-btn"
              onClick={() => {
                setAddSampleError("")
                setAddSampleSuccess("")
                setIsAddSampleModalOpen(true)
              }}
            >
              <svg viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <span>{t("add_new_sample")}</span>
            </button>
          </div>

          {error && <div className="voice-alert">{error}</div>}
          {syncingQueue && <div className="voice-alert">{t("voice_sample_processing_notice")}</div>}

          <div className="voice-table-header">
            <div className="col name">{t("name")}</div>
            <div className="col id">{t("id")}</div>
            <div className="col sample">{t("sample")}</div>
            <div className="col action"></div>
          </div>

          <div className="voice-rows">
            {!loading && currentItems.length === 0 && <div className="voice-empty">{t("no_voice_samples")}</div>}

            {currentItems.map((item) => (
              <div className="voice-row" key={item.id}>
                <div className="col name">
                  {item.avatar_signed_url ? (
                    <img className="avatar small" src={item.avatar_signed_url} alt={t("avatar")} />
                  ) : (
                    <div className="avatar small"></div>
                  )}
                  <span>{item.speaker_name || t("unknown")}</span>
                </div>

                <div className="col id">{String(item.id || "").slice(0, 8) || "xxxxx"}</div>

                <div className="col sample">
                  {item.audio_url ? (
                    <audio
                      className="voice-audio-player"
                      controls
                      preload="none"
                      controlsList="nodownload noplaybackrate noremoteplayback"
                      src={item.audio_url}
                      {...({ disablePictureInPicture: true } as React.AudioHTMLAttributes<HTMLAudioElement>)}
                    />
                  ) : (
                    <span className="no-audio">{t("no_audio")}</span>
                  )}
                </div>

                <div className="col action">
                  <button type="button" className="dot-menu" onClick={() => openEditModal(item)}>
                    <svg viewBox="0 0 24 24" width="18" height="18">
                      <circle cx="5" cy="12" r="2" fill="currentColor" />
                      <circle cx="12" cy="12" r="2" fill="currentColor" />
                      <circle cx="19" cy="12" r="2" fill="currentColor" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="pagination">
            <button disabled={normalizedCurrentPage === 1} onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}>
              {t("prev")}
            </button>

            {getPages().map((page) => (
              <button key={page} className={normalizedCurrentPage === page ? "active" : ""} onClick={() => setCurrentPage(page)}>
                {page}
              </button>
            ))}

            <button
              disabled={normalizedCurrentPage === totalPages || samples.length === 0}
              onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
            >
              {t("next")}
            </button>
          </div>
        </div>
      </div>

      {isAddSampleModalOpen && (
        <div className="voice-modal-overlay" onClick={() => setIsAddSampleModalOpen(false)}>
          <div className="voice-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="voice-modal-title">{t("upload_voice_sample")}</h3>
            <VoiceSampleSetup
              loading={submitting}
              error={addSampleError}
              success={addSampleSuccess}
              continueLabel={t("continue")}
              onSubmit={submitAddSample}
            />
          </div>
        </div>
      )}

      {isEditModalOpen && (
        <div className="voice-modal-overlay" onClick={closeEditModal}>
          <div className="sample-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="sample-modal-title">{t("sample_info")}</h3>

            <div className="sample-avatar-block">
              <label className="sample-avatar-picker">
                {editAvatarPreviewUrl ? <img src={editAvatarPreviewUrl} alt={t("avatar")} className="sample-avatar-image" /> : defaultAvatar}
                <span className="sample-avatar-plus">+</span>
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    if (!file) return
                    if (!file.type?.startsWith("image/")) {
                      setError(t("avatar_must_be_image"))
                      return
                    }
                    setEditAvatarFile(file)
                    setError("")
                  }}
                />
              </label>
            </div>

            <div className="sample-readonly-id-wrap">
              <span className="sample-readonly-id-label">{t("id")}</span>
              <input className="sample-readonly-id" value={String(editingSample?.id || "").slice(0, 8)} readOnly />
            </div>

            <div className="sample-name-wrap">
              <input className="sample-name-input" placeholder={t("username")} value={editName} onChange={(e) => setEditName(e.target.value)} />
            </div>

            <div className="sample-edit-actions">
              <button type="button" className="sample-delete-btn" onClick={deleteSample} disabled={submitting}>
                {t("delete_sample")}
              </button>
              <div className="sample-modal-actions right">
                <button type="button" className="sample-cancel-btn" onClick={closeEditModal}>
                  {t("cancel")}
                </button>
                <button type="button" className="sample-save-btn" onClick={submitEditSample} disabled={submitting || !editName.trim()}>
                  {t("save_changes")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
