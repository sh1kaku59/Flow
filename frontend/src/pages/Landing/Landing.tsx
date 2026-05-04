import React, { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import "./Landing.css"

export default function Landing() {
	const { t } = useTranslation()
	const navigate = useNavigate()
	const SUPABASE_URL = import.meta.env.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL || ""
	const [oauthMsg, setOauthMsg] = useState("")

	const showcaseData = [
		{
			title: t("smart_transcription"),
			desc: t("smart_transcription_desc"),
			image: "/preview1.png",
		},
		{
			title: t("speaker_insights"),
			desc: t("speaker_insights_desc"),
			image: "/preview2.png",
		},
		{
			title: t("semantic_search"),
			desc: t("semantic_search_desc"),
			image: "/preview3.png",
		},
	]

	const [activeIndex, setActiveIndex] = useState(0)

	const continueWithGoogle = () => {
		setOauthMsg("")
		if (!SUPABASE_URL) {
			setOauthMsg(t("missing_supabase_url"))
			return
		}
		const redirectTo = `${window.location.origin}/login?oauth=1`
		const authUrl = `${SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`
		window.location.assign(authUrl)
	}

	return (
		<div className="landing-page">

			{/* ===== TOP BAR ===== */}
			<header className="landing-topbar">
				<div className="logo">
					<img src="/logo.png" alt="logo" />
				</div>
			</header>

			{/* ===== HERO ===== */}
			<main className="landing-hero">
				<div className="landing-inner">
					<h1 className="landing-title">
						{t("hero_title_1")}<br />{t("hero_title_2")}
					</h1>

					<p className="landing-sub">
					{t("hero_sub")}
					</p>

					<div className="landing-cta">
						<button className="pill primary" onClick={() => navigate('/register')}>
							{t("sign_up")}
						</button>
						<button className="pill" onClick={() => navigate('/login')}>
							{t("login")}
						</button>
					</div>

					<div className="landing-or">{t("or")}</div>

					<button type="button" className="btn-google" onClick={continueWithGoogle}>
						<svg className="g-icon" viewBox="0 0 48 48">
							<path fill="#EA4335" d="M24 9.5c3.54 0 6.73 1.22 9.24 3.6l6.9-6.9C35.64 2.3 30.2 0 24 0 14.6 0 6.46 5.48 2.56 13.44l8.06 6.26C12.6 13.2 17.8 9.5 24 9.5z"/>
							<path fill="#4285F4" d="M46.1 24.5c0-1.6-.14-3.14-.4-4.62H24v9.24h12.5c-.54 2.9-2.2 5.36-4.7 7.04l7.3 5.68c4.28-3.94 6.76-9.74 6.76-17.34z"/>
							<path fill="#FBBC05" d="M10.62 28.7c-1-2.9-1-6.04 0-8.94l-8.06-6.26C.92 17.2 0 20.5 0 24s.92 6.8 2.56 10.5l8.06-6.26z"/>
							<path fill="#34A853" d="M24 48c6.2 0 11.4-2.04 15.2-5.54l-7.3-5.68c-2.02 1.36-4.6 2.16-7.9 2.16-6.2 0-11.4-3.7-13.38-8.94l-8.06 6.26C6.46 42.52 14.6 48 24 48z"/>
						</svg>
						<span>{t("continue_with_google")}</span>
					</button>
					{oauthMsg && <p className="login-msg">{oauthMsg}</p>}
				</div>
			</main>

			{/* ===== SHOWCASE ===== */}
			<section className="landing-showcase">

				{/* TOP CARDS */}
				<div className="showcase-top">
					{showcaseData.map((item, index) => (
						<div
							key={index}
							className={`showcase-card ${activeIndex === index ? "active" : ""}`}
							onClick={() => setActiveIndex(index)}
						>
							<img src={item.image} alt="" />
						</div>
					))}
				</div>

				<div className="landing-arrow">
					<img src="/arrow.png" alt="scroll down"/>
				</div>

				{/* CONTENT */}
				<div className="showcase-content">

					{/* LEFT TEXT */}
					<div className="showcase-text">
						<h3>{showcaseData[activeIndex].title}</h3>
						<p>{showcaseData[activeIndex].desc}</p>
					</div>

					{/* RIGHT IMAGE */}
					<div className="showcase-preview">
						<img
							key={showcaseData[activeIndex].image} // 🔥 trigger animation
							src={showcaseData[activeIndex].image}
							alt="preview"
							className="fade-in"
						/>
					</div>

				</div>
			</section>
		</div>
	)
}
