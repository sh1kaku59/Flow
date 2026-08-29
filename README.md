# Flow: Meeting Content Digitization & Intelligence Platform

[![Project](https://img.shields.io/badge/Capstone_Project-Van_Lang_University-red.svg)](https://vlu.edu.vn)
[![Scientific Base](https://img.shields.io/badge/Research_Base-FDSE_2025-blue.svg)](https://link.springer.com/chapter/10.1007/978-981-95-4721-0_23)
[![Frontend](https://img.shields.io/badge/Frontend-React.js_%7C_Vite_%7C_TailwindCSS-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Backend](https://img.shields.io/badge/Backend-Node.js_%7C_Express_%7C_BullMQ-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![AI Core](https://img.shields.io/badge/AI_Engine-Python_%7C_FastAPI_%7C_PyTorch-3776AB?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Database](https://img.shields.io/badge/Database-Supabase_%7C_PostgreSQL_%7C_pgvector-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Message Queue](https://img.shields.io/badge/Message_Broker-Redis_7-DC382D?logo=redis&logoColor=white)](https://redis.io/)
[![Containerization](https://img.shields.io/badge/Deployment-Docker_%7C_Docker_Compose_%7C_Nginx-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)

---

## 📌 1. Project Overview

**Flow** is an enterprise-grade digital knowledge management and meeting intelligence platform designed to transform unstructured conversational audio into structured, searchable, and actionable digital assets[cite: 7].

Inheriting the speech processing and diarization pipeline from the **FDSE 2025** research publication (*"V-Scribe: Structured Transcription of Vietnamese Speech for Digital Knowledge Management"*, Springer CCIS Vol 2708)[cite: 6], Flow introduces an asynchronous multi-container architecture that automates meeting transcription, speaker identification, conversational segmentation, and semantic retrieval[cite: 8, 9].

---

## 🏗️ 2. System Architecture

The system implements a **Modular Monolithic Backend** combined with an **Isolated Asynchronous AI Worker Container** orchestrated via Redis / BullMQ queues[cite: 8]. The entire environment is containerized via Docker Compose behind an Nginx Reverse Proxy[cite: 8, 14]:

```text
[ Client Browser (React SPA) ]
              │
              ▼ HTTPS (Port 443 / 80)
┌────────────────────────────────────────────────────────────────────────┐
│ Virtual Machine (Host Environment)                                     │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │ Nginx Reverse Proxy Container (TLS Termination & Rate Limiting)│   │
│   └───────┬────────────────────────┬───────────────────────┬───────┘   │
│           │ /                      │ /api/                 │ /ai/      │
│           ▼                        ▼                       ▼           │
│   ┌───────────────┐        ┌───────────────┐       ┌───────────────┐   │
│   │ Frontend UI   │        │ Backend API   │       │ AI Service    │   │
│   │ (React + Vite)│        │ (Node.js REST)│       │ (FastAPI App) │   │
│   └───────────────┘        └───────┬───────┘       └───────▲───────┘   │
│                                    │                       │           │
│                      Dispatch Job  ▼                       │ HTTP Task │
│                        ┌───────────────────┐               │ Invocation│
│                        │  Redis Message    │               │           │
│                        │  Broker (BullMQ)  │               │           │
│                        └─────────┬─────────┘               │           │
│                                  │                         │           │
│                     Consume Task ▼                         │           │
│                        ┌───────────────────────────────────┴───┐       │
│                        │ Node.js Background Worker Container   │       │
│                        └───────────────────┬───────────────────┘       │
└────────────────────────────────────────────┼───────────────────────────┘
                                             │ Outbound TLS / HTTPS
                                             ▼
                      ┌─────────────────────────────────────────┐
                      │ External Managed BaaS (Supabase Cloud)  │
                      │ • PostgreSQL: Structured Relational DB  │
                      │ • pgvector: 512-dim Semantic Embeddings │
                      │ • Object Storage: Audios & Avatars      │
                      └─────────────────────────────────────────┘
```

---

## ✨ 3. Core Features

* **Voice Profiling & Speaker Enrollment:** Enrolls user voice samples to construct reference acoustic embeddings, eliminating manual speaker labeling during meeting post-processing[cite: 7, 9].
* **Automated Neural Processing Pipeline:**
  * **Speaker Diarization:** Pyannote.audio sequence labeling for Voice Activity Detection (VAD) and Speaker Change Detection (SCD)[cite: 6, 8].
  * **Vietnamese Speech-to-Text (ASR):** High-precision transcription powered by fine-tuned `PhoWhisper-large`[cite: 6, 8].
  * **Meeting Intelligence:** Automated topic extraction, executive summarization, and speaker participation intensity metrics[cite: 7, 8].
* **Vector Semantic Search:** Natural language conceptual queries (e.g., *"budget decisions"*) powered by PostgreSQL `pgvector` HNSW indexes[cite: 8, 9].
* **Contextual Playback (Click-to-Play):** Interactive bidirectional synchronization between transcript segments and audio timestamps[cite: 7, 8].
* **Enterprise Security:** "No-Download" view-only streaming, Supabase Row Level Security (RLS), and short-lived Signed URLs[cite: 7, 8].

---

## 🗄️ 4. Database Schema & Core Entities

The system uses Supabase (PostgreSQL with `pgvector` extension) to enforce referential integrity across 13 domain tables[cite: 9, 14]:

```text
account                 # User identity, authentication credentials, and profiles
setting                 # User preferences (theme, language, notifications)
voice_sample            # Reference audio samples and voiceprint embedding vectors
meeting                 # Meeting metadata, processing status, and ownership
audio_file              # Raw audio file references, duration, and formats
processing_job          # Job-level lifecycle and progress tracking
processing_step         # Step-level execution tracking (STT, diarization, analysis)
speaker                 # Meeting participants identified by acoustic matching
transcript_segment      # Timestamped transcript segments mapped to speakers
semantic_segment        # Topic-based semantic timeline segments
speaker_statistic       # Speaking frequency and interaction intensity metrics
search_index            # 512-dimension vector embeddings for semantic search
meeting_summary         # AI-generated meeting summaries
```

---

## 📂 5. Project Structure

```text
Flow/
├── ai_service/                  # Python FastAPI AI processing engine
│   ├── analysis/                # NLP summaries, topics, and behavioral analytics
│   ├── asr/                     # PhoWhisper Speech-to-Text pipeline
│   ├── audio/                   # Chunking, noise reduction, and preprocessing
│   ├── speaker/                 # Pyannote diarization & ECAPA-TDNN embeddings
│   ├── Dockerfile               # AI container specification
│   ├── main.py                  # FastAPI service entry point
│   └── requirements.txt         # PyTorch, Transformers, Pyannote dependencies
│
├── backend-node/                # Node.js Modular Monolith & Async Worker
│   ├── src/
│   │   ├── config/              # AppConfig & environment management
│   │   ├── queues/              # RedisQueueManager (BullMQ orchestrator)
│   │   ├── services/            # Domain services (Auth, Meeting, User, Voice)
│   │   └── utils/               # Crypto, Storage, DateTime, Validation helpers
│   ├── server.js                # REST API entry point (Port 9000)
│   ├── worker.js                # Background job queue consumer
│   ├── Dockerfile               # Backend container specification
│   └── package.json             # Node.js dependencies
│
├── frontend/                    # React.js Single Page Application (SPA)
│   ├── src/
│   │   ├── assets/              # Icons, illustrations, and static assets
│   │   ├── components/          # Reusable UI component library (Design System)
│   │   ├── pages/               # Auth, Landing, Dashboard, DiaryDetail, Profile
│   │   ├── services/            # REST API client & Supabase auth service
│   │   └── App.tsx              # SPA routing & application layout
│   ├── nginx.conf               # Internal Nginx web server config (Port 80)
│   ├── Dockerfile               # Multi-stage production build container
│   └── package.json             # React, Vite, Tailwind CSS dependencies
│
├── reverse-proxy/               # Nginx gateway reverse proxy configuration
├── docker-compose.yml           # Multi-service container orchestration
├── .gitignore                   # Version control exclusion rules
└── README.md                    # Project documentation
```

---

## 🚀 6. Installation & Setup Guide

### Step 1: Clone the Repository
```bash
git clone [https://github.com/sh1kaku59/Flow.git](https://github.com/sh1kaku59/Flow.git)
cd Flow
```

### Step 2: System Requirements & Prerequisites
Ensure the following base tools are installed:
* **Node.js:** `20.x` LTS (Docker images use `node:20-alpine`)[cite: 14, 15]
* **npm:** `10+`[cite: 14, 15]
* **Python:** `3.11.x` (AI Docker image uses `python:3.11-slim`)[cite: 14, 15]
* **Docker Desktop & Docker Compose:** `v2+`[cite: 14, 15]
* **Redis:** `7.x` (if running locally without Docker)[cite: 14, 15]
* **FFmpeg:** Installed and added to system `PATH` (required for local audio normalization)[cite: 14, 15]

---

### Step 3: Frontend Setup (React + Vite)
```bash
cd frontend
npm install
npm run dev
```
* Default local URL: `http://localhost:5173`[cite: 14, 15]
* *Note:* Vite is configured with `envDir: "../backend-node"` in `frontend/vite.config.js`, reading frontend environment variables directly[cite: 14, 15].

---

### Step 4: Backend Setup (Node.js)
In a new terminal window:
```bash
cd backend-node
npm install
npm run dev
```

Run the background worker in a separate terminal:
```bash
cd backend-node
npm run dev:worker
```
* Backend health check: `http://localhost:9000/health`[cite: 14, 15]

---

### Step 5: AI Processing Service Setup (Python)
From the repository root:
```bash
# Create virtual environment
python -m venv .venv

# Activate environment
# On Windows:
.venv\Scripts\activate
# On macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r ai_service/requirements.txt

# Run AI service
python -m uvicorn ai_service.main:app --host 0.0.0.0 --port 8001
```
* AI Service health check: `http://localhost:8001/health`[cite: 14, 15]

---

### Step 6: Supabase & Database Configuration
1. Create a project on [Supabase Dashboard](https://supabase.com)[cite: 14, 15].
2. Apply the database schema via Supabase SQL Editor for the 13 required tables[cite: 14, 15].
3. Create the following Supabase Storage buckets[cite: 14, 15]:
   * `voice-samples`[cite: 14, 15]
   * `avatars`[cite: 14, 15]
   * `meeting-audios`[cite: 14, 15]
4. Copy the Supabase URL and Service Role Key into `backend-node/.env`[cite: 14, 15].

---

## ⚙️ 7. Environment Configuration

### Root `.env` (Docker Compose build arguments for Frontend)
```env
VITE_API_BASE_URL=http://localhost:9000
VITE_SUPABASE_URL=[https://your-project.supabase.co](https://your-project.supabase.co)
```

### `backend-node/.env` (Runtime environment for Backend, Worker, and AI)
```env
PORT=9000
SUPABASE_URL=[https://your-project.supabase.co](https://your-project.supabase.co)
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
HF_TOKEN=your_huggingface_access_token
FRONTEND_ORIGIN=http://localhost:5173,[http://127.0.0.1:5173](http://127.0.0.1:5173)
AI_SERVICE_URL=[http://127.0.0.1:8001](http://127.0.0.1:8001)
BACKEND_CALLBACK_URL=[http://127.0.0.1:9000/ai/progress](http://127.0.0.1:9000/ai/progress)
REDIS_URL=redis://127.0.0.1:6379
VOICE_BUCKET=voice-samples
AVATAR_BUCKET=avatars
MEETING_AUDIO_BUCKET=meeting-audios
SESSION_COOKIE_NAME=sid
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAMESITE=lax
QUEUE_WORKER_CONCURRENCY=1
RATE_LIMIT_DISABLED=false
EMBEDDING_DIM=512
```

---

## 🐳 8. Running Full Stack with Docker Compose

Launch all containerized services with a single command[cite: 14, 15]:

```bash
docker compose up -d --build
```

**Service Endpoints:**

| Service | Container Name | Port | Description |
| :--- | :--- | :--- | :--- |
| **Frontend** | `frontend` | `80` (Internal) | React UI served via Nginx[cite: 14, 15] |
| **Backend API** | `backend` | `9000` | Node.js REST API & Auth orchestration[cite: 14, 15] |
| **Worker** | `worker` | Background | BullMQ Queue consumer[cite: 14, 15] |
| **AI Engine** | `ai-service` | `8001` | FastAPI audio processing & STT[cite: 14, 15] |
| **Redis** | `redis` | `6379` | In-memory message broker[cite: 14, 15] |
| **Gateway** | `reverse-proxy` | `80 / 443` | Nginx reverse proxy & SSL manager[cite: 14, 15] |

To stop all services[cite: 14]:
```bash
docker compose down
```

---

## 🔧 9. Troubleshooting

* **Redis connection refused:** Ensure the Redis container is healthy or local `redis-server` is running, and verify that `REDIS_URL` matches the network[cite: 15].
* **Backend startup failure (Supabase error):** Verify that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are correct and that the key role is `service_role`[cite: 15].
* **AI Service `HF_TOKEN` error:** Pyannote diarization requires an accepted Hugging Face model agreement and a valid user access token[cite: 14, 15].
* **Audio decoding errors:** Verify that `FFmpeg` is correctly installed on the operating system and accessible via terminal[cite: 14, 15].

---

## 🔒 10. Security & Data Protection

* Never commit `.env` files or secret keys into version control[cite: 14, 15].
* `SUPABASE_SERVICE_ROLE_KEY` must **never** be exposed in client-side code or public repositories[cite: 14, 15].
* All storage files are accessed via temporary signed URLs with strict expiry policies[cite: 7, 8].

---

## 👥 11. Contributors & Project Information

* **Institution:** Faculty of Information Technology, Van Lang University, Ho Chi Minh City, Vietnam[cite: 7, 8]
* **Project Mentor & Product Owner:** **Huu Nghia Huynh** (Institute for Experiential Technology)[cite: 7, 8]
* **Development Team (Group 22):**
  - **Ngoc Minh Vu** – Core Architecture, Backend & AI Pipeline ([GitHub](https://github.com/sh1kaku59) | [LinkedIn](https://linkedin.com/in/vungocminh9702) | [Email](mailto:wanbitido090@gmail.com))[cite: 7, 8, 9]
  - **Minh Duc Nhan** – System Design, Documentation & Frontend Integration[cite: 7, 8, 9]
  - **Vu Huy Nguyen** – Requirements Analysis, Testing & Infrastructure[cite: 7, 8, 9]
