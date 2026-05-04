import { useNavigate } from "react-router-dom"
import React, { useEffect, useState, useRef } from "react"
import { useTranslation } from "react-i18next"
import "./User.css"
export default function User() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:9000"
    const today = new Date().toISOString().split("T")[0]
    const [user, setUser] = useState({
      name: "",
      email: "",
      dob: "",
      avatarUrl: "",
      isOAuth: false,
      canEditEmail: true,
      canChangePassword: true,
    })

    // Modal states
    const [isInfoModalOpen, setIsInfoModalOpen] = useState(false)
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false)
    const [isAvatarModalOpen, setIsAvatarModalOpen] = useState(false)

    // Form states
    const [editInfo, setEditInfo] = useState({ name: "", email: "", dob: "" })
    const [passwords, setPasswords] = useState({ current: "", new: "", confirm: "" })
    const [avatarZoom, setAvatarZoom] = useState(50)
    const [selectedFile, setSelectedFile] = useState<File | null>(null)
    const [isDragging, setIsDragging] = useState(false)
    const [avatarModalStep, setAvatarModalStep] = useState<"upload" | "preview">("upload")
    const [previewUrl, setPreviewUrl] = useState<string>("")
    const fileInputRef = useRef<HTMLInputElement>(null)

    const openInfoModal = () => {
      setEditInfo({ name: user.name || "", email: user.email || "", dob: user.dob || "" })
      setIsInfoModalOpen(true)
    }

    const openPasswordModal = () => {
      setPasswords({ current: "", new: "", confirm: "" })
      setIsPasswordModalOpen(true)
    }

    const openAvatarModal = () => {
      setSelectedFile(null)
      setPreviewUrl("")
      setAvatarZoom(50)
      setAvatarModalStep("upload")
      setIsAvatarModalOpen(true)
    }

    useEffect(() => {
      let cancelled = false

      const loadSession = async () => {
        try {
          const res = await fetch(`${API_BASE}/auth/session`, { credentials: "include" })
          const data = await res.json().catch(() => ({}))
          if (!cancelled && res.ok) {
            const email = String(data?.user?.email || "")
            const dob = String(data?.user?.date_of_birth || "").trim()
            setUser({
              name: data?.user?.name || (email ? email.split("@")[0] : "John Doe"),
              email: email || "johndoe@gmail.com",
              dob: dob || "01/01/1999",
              avatarUrl: String(data?.user?.avatar_url || "").trim(),
              isOAuth: Boolean(data?.user?.is_oauth),
              canEditEmail: data?.user?.can_edit_email !== undefined
                ? data.user.can_edit_email
                : !data?.user?.is_oauth,
              canChangePassword: data?.user?.can_change_password !== undefined
                ? data.user.can_change_password
                : !data?.user?.is_oauth,
            })
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

  return (
    <div className="user-page">
      <div className="user-container">

        {/* BACK */}
        <div className="user-header">
          <button className="back-btn" onClick={() => navigate("/profile")}>
          ? {t("back")}
          </button>

          <h1>{t("user_information")}</h1>
        </div>

        {/* CARD */}
        <div className="user-card">

          {/* AVATAR */}
          <div className="avatar-section" onClick={openAvatarModal} style={{cursor: 'pointer'}}>
            <div className="avatar">
              {user.avatarUrl ? (
                <img src={user.avatarUrl} alt="avatar" className="avatar-image" />
              ) : (
                <svg viewBox="0 0 24 24" width="60" height="60">
                  <path
                    fill="white"
                    d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"
                  />
                </svg>
              )}
            </div>

            <div className="avatar-add">+</div>
          </div>

          {/* FORM */}
          <div className="user-form">

            {/* USERNAME */}
            <div className="form-group">
              <label>{t("username")}</label>
              <div className="input-row">
                <input
                  type="text"
                  value={user.name || "John Doe"}
                  readOnly
                />
                <button className="edit-btn" onClick={openInfoModal}>
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path
                      fill="grey"
                      d="M3 17.2V21h3.8l11-11-3.8-3.8-11 11zM20.7 7c.4-.4.4-1 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8L20.7 7z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* EMAIL */}
            <div className="form-group">
              <label>{t("email")}</label>
              <div className="input-row">
                <input
                  type="text"
                  value={user.email || "johndoe@gmail.com"}
                  readOnly
                />
                <button className="edit-btn" onClick={openInfoModal}>
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path
                      fill="grey"
                      d="M3 17.2V21h3.8l11-11-3.8-3.8-11 11zM20.7 7c.4-.4.4-1 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8L20.7 7z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* DOB */}
            <div className="form-group">
              <label>{t("date_of_birth")}</label>
              <div className="input-row">
                <input
                  type="text"
                  value={user.dob || "01/01/1999"}
                  readOnly
                />
                <button className="edit-btn" onClick={openInfoModal}>
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path
                      fill="grey"
                      d="M3 17.2V21h3.8l11-11-3.8-3.8-11 11zM20.7 7c.4-.4.4-1 0-1.4l-2.3-2.3a1 1 0 0 0-1.4 0l-1.8 1.8 3.8 3.8L20.7 7z"
                    />
                  </svg>
                </button>
              </div>
            </div>

            {/* BUTTON */}
            {user.canChangePassword && (
              <button className="password-btn" onClick={openPasswordModal}>
                {t("change_password")}
              </button>
            )}

          </div>
        </div>

      </div>

      {/* INFORMATION MODAL */}
      {isInfoModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>{t("user_information")}</h2>
            
            <div className="modal-form-group">
              <label>{t("username")}</label>
              <input 
                type="text" 
                className="modal-input" 
                value={editInfo.name} 
                onChange={e => setEditInfo({...editInfo, name: e.target.value})}
              />
            </div>

            <div className="modal-form-group">
              <label>{t("email")} {!user.canEditEmail ? `(${t("cannot_be_changed")})` : ""}</label>
              <input 
                type="text" 
                className="modal-input" 
                style={!user.canEditEmail ? { cursor: "not-allowed" } : undefined}
                value={editInfo.email} 
                onChange={!user.canEditEmail ? undefined : e => setEditInfo({...editInfo, email: e.target.value})}
                disabled={!user.canEditEmail}
              />
            </div>

            <div className="modal-form-group">
              <label>{t("date_of_birth")}</label>
                <input 
                  type="date" 
                  className="modal-input" 
                  value={editInfo.dob} 
                  max={today}
                  onChange={e => setEditInfo({...editInfo, dob: e.target.value})}
                />
              <svg className="modal-input-icon" viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zm0-12H5V6h14v2z"/>
              </svg>
            </div>

            <div className="modal-actions">
              <button className="modal-btn-cancel" onClick={() => setIsInfoModalOpen(false)}>{t("cancel")}</button>
              <button className="modal-btn-save" onClick={async () => {
                try {
                  const res = await fetch(`${API_BASE}/users/me`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      name: editInfo.name,
                      email: !user.canEditEmail ? undefined : editInfo.email,
                      dob: editInfo.dob
                    }),
                    credentials: "include"
                  })
                  if (res.ok) {
                    setUser(prev => ({
                      ...prev,
                      name: editInfo.name,
                      email: !user.canEditEmail ? prev.email : editInfo.email,
                      dob: editInfo.dob
                    }))
                    setIsInfoModalOpen(false)
                  } else {
                    const data = await res.json()
                    alert(data.detail || t("failed_update_profile"))
                  }
                } catch (e) {
                  console.error(e)
                  alert(t("failed_update_profile"))
                }
              }}>{t("save_changes")}</button>
            </div>
          </div>
        </div>
      )}

      {/* PASSWORD MODAL */}
      {isPasswordModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>{t("change_password")}</h2>
            
            <div className="modal-form-group">
              <label>{t("current_password")}</label>
              <input 
                type="password" 
                className="modal-input" 
                value={passwords.current}
                onChange={e => setPasswords({...passwords, current: e.target.value})}
              />
              <svg className="modal-input-icon" viewBox="0 0 24 24" width="18" height="18">
                <path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
            </div>

            <div className="modal-form-group">
              <label>{t("new_password")}</label>
              <input 
                type="password" 
                className="modal-input" 
                value={passwords.new}
                onChange={e => setPasswords({...passwords, new: e.target.value})}
              />
            </div>

            <div className="modal-form-group">
              <label>{t("confirm_new_password")}</label>
              <input 
                type="password" 
                className="modal-input" 
                value={passwords.confirm}
                onChange={e => setPasswords({...passwords, confirm: e.target.value})}
              />
            </div>

            <div className="modal-actions">
              <button
                className="modal-forgot-btn"
                onClick={() => {
                  const email = String(user.email || "").trim().toLowerCase()
                  if (!email) {
                    alert(t("forgot_enter_email_first"))
                    return
                  }
                  setIsPasswordModalOpen(false)
                  navigate("/password/forgot", {
                    state: {
                      from: "user",
                      email,
                    },
                  })
                }}
              >
                <svg viewBox="0 0 24 24" width="16" height="16">
                  <path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>
                </svg>
                {t("forgot_password")}
              </button>
              <button className="modal-btn-cancel" onClick={() => setIsPasswordModalOpen(false)}>{t("cancel")}</button>
              <button
                className="modal-btn-save"
                onClick={async () => {
                  if (passwords.new !== passwords.confirm) {
                    alert(t("password_not_match"))
                    return
                  }
                
                  const res = await fetch(`${API_BASE}/users/me/password`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    credentials: "include",
                    body: JSON.stringify({
                      currentPassword: passwords.current,
                      newPassword: passwords.new,
                    }),
                  })
                
                  const data = await res.json()
                
                  if (res.ok) {
                    alert(t("password_changed_success"))
                    setIsPasswordModalOpen(false)
                  } else {
                    alert(data.detail)
                  }
                }}
              >
                {t("save_changes")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AVATAR MODAL */}
      {isAvatarModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h2>{t("avatar")}</h2>
            
            {avatarModalStep === "upload" ? (
              <div 
                className={`avatar-upload-dropzone ${isDragging ? "dragging" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                    const file = e.dataTransfer.files[0]
                    setSelectedFile(file)
                    setPreviewUrl(URL.createObjectURL(file))
                    setAvatarModalStep("preview")
                  }
                }}
              >
                <div className="dropzone-icon">
                  <svg width="60" height="60" viewBox="0 0 60 60" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M30 40V12" stroke="url(#paint0_linear)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M20 22L30 12L40 22" stroke="url(#paint0_linear)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M10 35C10 35 15 25 25 35C35 45 40 35 50 25V40C50 45.5228 45.5228 50 40 50H20C14.4772 50 10 45.5228 10 40V35Z" stroke="#0ea5e9" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M10 25V20C10 14.4772 14.4772 10 20 10H25" stroke="#8b5cf6" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                    <defs>
                      <linearGradient id="paint0_linear" x1="30" y1="12" x2="30" y2="40" gradientUnits="userSpaceOnUse">
                        <stop stopColor="#8b5cf6"/>
                        <stop offset="1" stopColor="#0ea5e9"/>
                      </linearGradient>
                    </defs>
                  </svg>
                </div>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  style={{ display: "none" }} 
                  accept="image/*"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      const file = e.target.files[0]
                      setSelectedFile(file)
                      setPreviewUrl(URL.createObjectURL(file))
                      setAvatarModalStep("preview")
                    }
                  }} 
                />
                
                <p className="dropzone-text">
                  {selectedFile ? selectedFile.name : t("drag_drop")}
                </p>
                <p className="dropzone-or">{t("or")}</p>
                
                <button 
                  className="browse-file-btn" 
                  onClick={(e) => {
                    e.stopPropagation()
                    fileInputRef.current?.click()
                  }}
                >
                  {t("browse_file")}
                </button>
              </div>
            ) : (
              <div className="avatar-preview-box">
                <div className="avatar-preview-circle">
                  {(previewUrl || user.avatarUrl) ? (
                     <img src={previewUrl || user.avatarUrl} alt="avatar preview" style={{width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${1 + avatarZoom/100})`}} />
                  ) : (
                    <svg viewBox="0 0 24 24">
                      <path d="M12 12c2.7 0 5-2.3 5-5s-2.3-5-5-5-5 2.3-5 5 2.3 5 5 5zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z" />
                    </svg>
                  )}
                </div>
                
                <div className="avatar-slider-container">
                  <svg viewBox="0 0 24 24" width="16" height="16">
                    <path fill="currentColor" d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z"/>
                  </svg>
                  <input 
                    type="range" 
                    className="avatar-slider" 
                    min="0" 
                    max="100" 
                    value={avatarZoom}
                    onChange={e => setAvatarZoom(parseInt(e.target.value))}
                  />
                  <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M19 5v14H5V5h14m0-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4.86 8.86l-3 3.87L9 13.14 6 17h12l-3.86-5.14z"/>
                  </svg>
                </div>
              </div>
            )}

            <div className="modal-actions">
              {avatarModalStep === "preview" && (
                <button 
                  className="modal-btn-cancel" 
                  style={{marginRight: 'auto', border: 'none'}} 
                  onClick={() => setAvatarModalStep("upload")}
                >
                  {t("back")}
                </button>
              )}
              <button className="modal-btn-cancel" onClick={() => setIsAvatarModalOpen(false)}>{t("cancel")}</button>
              <button 
                className={selectedFile ? "modal-btn-save" : "modal-btn-save-disabled"} 
                disabled={!selectedFile}
                onClick={async () => {
                  if (selectedFile) {
                    try {
                      const formData = new FormData()
                      formData.append("avatar", selectedFile)
                      const res = await fetch(`${API_BASE}/users/me/avatar`, {
                        method: "PATCH",
                        body: formData,
                        credentials: "include"
                      })
                      if (res.ok) {
                        const data = await res.json()
                        setUser(prev => ({ ...prev, avatarUrl: data.avatar_url }))
                      }
                    } catch (e) {
                      console.error(e)
                    }
                    setIsAvatarModalOpen(false)
                  }
                }}
              >
                {t("save_changes")}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

