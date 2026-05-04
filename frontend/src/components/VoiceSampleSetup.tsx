import { useEffect, useRef, useState } from "react"
import type { ChangeEvent, DragEvent } from "react"
import { useTranslation } from "react-i18next"
import "./VoiceSampleSetup.css"

export type VoiceSampleSubmitPayload = {
  sampleName: string
  avatarFile: File | null
  voiceFile: File | null
  recordedBlob: Blob | null
}

type VoiceSampleSetupProps = {
  loading?: boolean
  error?: string
  success?: string
  defaultSampleName?: string
  continueLabel?: string
  showBackButton?: boolean
  onBack?: () => void
  onSubmit: (payload: VoiceSampleSubmitPayload) => Promise<void> | void
}

export default function VoiceSampleSetup({
  loading = false,
  error = "",
  success = "",
  defaultSampleName = "",
  continueLabel = "",
  showBackButton = false,
  onBack,
  onSubmit,
}: VoiceSampleSetupProps) {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [voiceFile, setVoiceFile] = useState<File | null>(null)
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null)
  const [audioPreviewUrl, setAudioPreviewUrl] = useState("")

  const [isSampleModalOpen, setIsSampleModalOpen] = useState(false)
  const [sampleName, setSampleName] = useState("")
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState("")
  const [localError, setLocalError] = useState("")

  useEffect(() => {
    let url = ""
    if (voiceFile) url = URL.createObjectURL(voiceFile)
    if (!voiceFile && recordedBlob) url = URL.createObjectURL(recordedBlob)
    setAudioPreviewUrl(url)
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [voiceFile, recordedBlob])

  useEffect(() => {
    if (!avatarFile) {
      setAvatarPreviewUrl("")
      return
    }
    const url = URL.createObjectURL(avatarFile)
    setAvatarPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [avatarFile])

  const pickFile = () => fileInputRef.current?.click()

  const setVoiceFromFile = (file: File | null) => {
    if (!file) return
    setVoiceFile(file)
    setRecordedBlob(null)
    setLocalError("")
  }

  const handleVoiceFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    setVoiceFromFile(file)
  }

  const handleDropVoice = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const file = e.dataTransfer?.files?.[0] || null
    setVoiceFromFile(file as File | null)
  }

  const handleDragOverVoice = (e: DragEvent<HTMLDivElement>) => e.preventDefault()

  const clearVoiceSample = () => {
    setVoiceFile(null)
    setRecordedBlob(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const handleAvatarFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null
    if (!file) return
    if (!file.type?.startsWith("image/")) {
      setLocalError(t("avatar_must_be_image"))
      return
    }
    setAvatarFile(file)
    setLocalError("")
  }

  const closeSampleModal = () => setIsSampleModalOpen(false)

  const openSampleModal = () => {
    if (!voiceFile && !recordedBlob) {
      setLocalError(t("voice_sample_required"))
      return
    }
    if (!sampleName.trim() && defaultSampleName.trim()) {
      setSampleName(defaultSampleName.trim())
    }
    setLocalError("")
    setIsSampleModalOpen(true)
  }

  const submitSample = async () => {
    if (!sampleName.trim()) {
      setLocalError(t("please_enter_sample_name"))
      return
    }

    setLocalError("")
    await onSubmit({
      sampleName: sampleName.trim(),
      avatarFile,
      voiceFile,
      recordedBlob,
    })
  }

  const displayError = error || localError

  return (
    <div className="voice-sample-setup">
      <input
        ref={fileInputRef}
        type="file"
        accept=".aac,.adts,.m4a,.mp3,.wav,.flac,.ogg,.opus,.webm,audio/*"
        onChange={handleVoiceFile}
        hidden
      />

      <div
        className="upload-zone"
        role="button"
        tabIndex={0}
        onClick={pickFile}
        onDrop={handleDropVoice}
        onDragOver={handleDragOverVoice}
      >
        <div className="upload-title">{t("drag_drop_upload")}</div>
        <div className="upload-file">{voiceFile ? voiceFile.name : t("no_file_selected")}</div>
        <div className="upload-or">{t("or")}</div>
        <button type="button" className="browse-btn" onClick={pickFile}>{t("browse_file_btn")}</button>
      </div>

      <div className="voice-actions">
        <button type="button" className="clear-btn" onClick={clearVoiceSample}>{t("delete")}</button>
      </div>

      {audioPreviewUrl && (
        <div className="audio-preview">
          <audio
            className="voice-audio-player"
            controls
            controlsList="nodownload noplaybackrate noremoteplayback"
            src={audioPreviewUrl}
            {...({ disablePictureInPicture: true } as React.AudioHTMLAttributes<HTMLAudioElement>)}
          />
        </div>
      )}

      {displayError && <p className="msg error">{displayError}</p>}
      {success && <p className="msg success">{success}</p>}

      <div className="form-actions">
        {showBackButton && onBack ? (
          <button type="button" className="back-outline" onClick={onBack}>{t("back")}</button>
        ) : null}
        <button className="submit-btn" type="button" disabled={loading} onClick={openSampleModal}>
          {loading ? t("processing_dots") : (continueLabel || t("continue"))}
        </button>
      </div>

      {isSampleModalOpen && (
        <div className="sample-modal-overlay">
          <div className="sample-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="sample-modal-title">{t("add_new_sample")}</h3>

            <div className="sample-avatar-block">
              <label className="sample-avatar-picker">
                {avatarPreviewUrl ? (
                  <img src={avatarPreviewUrl} alt={t("avatar")} className="sample-avatar-image" />
                ) : (
                  <div className="sample-avatar-placeholder">
                    <svg viewBox="0 0 24 24" width="54" height="54" color="white">
                      <path fill="currentColor" d="M12 12a5 5 0 100-10 5 5 0 000 10zm0 2c-4.97 0-9 2.24-9 5v1h18v-1c0-2.76-4.03-5-9-5z" />
                    </svg>
                  </div>
                )}
                <span className="sample-avatar-plus">+</span>
                <input type="file" accept="image/*" hidden onChange={handleAvatarFile} />
              </label>
            </div>

            <div className="sample-readonly-id-wrap">
              <span className="sample-readonly-id-label">{t("id")}</span>
              <input className="sample-readonly-id" value="xxxxx" readOnly />
            </div>

            <div className="sample-name-wrap">
              <input
                className="sample-name-input"
                placeholder={t("username")}
                value={sampleName}
                onChange={(e) => setSampleName(e.target.value)}
              />
            </div>

            <div className="sample-modal-actions">
              <button type="button" className="sample-cancel-btn" onClick={closeSampleModal}>{t("cancel")}</button>
              <button
                type="button"
                className="sample-add-btn"
                onClick={submitSample}
                disabled={loading || !sampleName.trim()}
              >
                {t("add_sample_btn")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
