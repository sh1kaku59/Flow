# FLOW

## 1. Project Overview
FLOW is a meeting-audio post-processing system. Users upload meeting audio, then FLOW processes it into structured transcript segments, speaker-related data, summaries, semantic-search data, diary records, and contextual playback data for reviewing conversations.

## 2. Main Project Structure
- `frontend/`: React + Vite web app for authentication, upload, diary list/detail, transcript review, semantic search, playback, profile, and settings screens.
- `backend-node/`: Node.js API service for auth/session handling, Supabase integration, upload intake, Redis/BullMQ job orchestration, and AI-service communication.
- `ai_service/`: Python FastAPI service for audio preprocessing, STT/ASR, speaker processing, semantic analysis, and output generation.
- `reverse-proxy/`: Nginx reverse-proxy and certificate automation helpers for deployment.
- `docker-compose.yml`: Multi-service stack for `redis`, `backend`, `worker`, `ai-service`, `frontend`, `reverse-proxy`, and `certbot`.
- Root environment config: root `.env` is used by Docker Compose build args for frontend; `backend-node/.env` is used by backend/worker and also consumed by AI service in Docker mode.

## 3. Setup Steps

### Step 1: Clone the Repository
```bash
git clone https://github.com/sh1kaku59/Flow.git
cd Flow
```

### Step 2: Install Required Software
Install these tools first:
- Git
- Node.js + npm
- Python
- Docker Desktop + Docker Compose
- Redis (if running without Docker)
- FFmpeg (required for local AI audio processing)

Recommended versions based on the current source:
- Node.js: `20.x` LTS (Dockerfiles use `node:20-alpine`)
- npm: `10+`
- Python: `3.11.x` recommended (AI Dockerfile uses `python:3.11-slim`)
- Docker Desktop: latest stable
- Docker Compose: v2+
- Redis: `7.x` (Compose uses `redis:7-alpine`)

### Step 3: Setup Frontend Environment
```bash
cd frontend
npm install
npm run dev
```

Default local URL:
- `http://localhost:5173`

Important env behavior:
- Vite is configured with `envDir: "../backend-node"` in `frontend/vite.config.js`, so local frontend env values are read from `backend-node/.env` (or prefixed env loaded there).

### Step 4: Setup Backend Environment
```bash
cd backend-node
npm install
npm run dev
```

Run worker in a second terminal:
```bash
cd backend-node
npm run dev:worker
```

Backend health check:
- `http://localhost:9000/health`

Required backend env variables (placeholders only):
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
REDIS_URL=redis://127.0.0.1:6379
AI_SERVICE_URL=http://127.0.0.1:8001
BACKEND_CALLBACK_URL=http://127.0.0.1:9000/ai/progress
FRONTEND_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
SESSION_COOKIE_NAME=sid
VOICE_BUCKET=voice-samples
AVATAR_BUCKET=avatars
MEETING_AUDIO_BUCKET=meeting-audios
```

### Step 5: Setup AI Processing Service
From repository root:
```bash
python -m venv .venv
```

Activate virtual environment:

Windows:
```bash
.venv\Scripts\activate
```

macOS/Linux:
```bash
source .venv/bin/activate
```

Install dependencies:
```bash
pip install -r ai_service/requirements.txt
```

Run AI service:
```bash
python -m uvicorn ai_service.main:app --host 0.0.0.0 --port 8001
```

AI health check:
- `http://localhost:8001/health`

Notes:
- `HF_TOKEN` is required for pyannote-based embedding/diarization paths.
- `ffmpeg` must be available on `PATH` for robust audio normalization.

### Step 6: Setup Database with Supabase
1. Create a Supabase project.
2. Configure authentication providers used by the app (email/password and Google OAuth if needed).
3. Apply the project database schema used by backend services. Tables referenced by code include:
   - `account`
   - `setting`
   - `voice_sample`
   - `meeting`
   - `processing_job`
   - `processing_step`
   - `audio_file`
   - `speaker`
   - `transcript_segment`
   - `semantic_segment`
   - `speaker_statistic`
   - `search_index`
   - `meeting_summary`
4. Create storage buckets (or set custom names via env):
   - `voice-samples`
   - `avatars`
   - `meeting-audios`
5. Copy Supabase URL + service role key into `backend-node/.env`.
6. Never expose service role keys in frontend code or public repositories.

### Step 7: Setup Redis
Option A, using Docker Compose:
```bash
docker compose up -d redis
```

Option B, local Redis:
```bash
redis-server
```

Redis is required for BullMQ queues used by backend/worker processing stages.

### Step 8: Run Full System with Docker Compose
Before running, set:
- root `.env` for frontend build args (`VITE_API_BASE_URL`, `VITE_SUPABASE_URL`)
- `backend-node/.env` for backend/worker/AI runtime env

Start full stack:
```bash
docker compose up -d --build
```

Services started:
- `redis`
- `backend`
- `worker`
- `ai-service`
- `frontend`
- `reverse-proxy`
- `certbot`

### Step 9: Verify System Integration
1. Open frontend UI.
2. Register or log in.
3. Upload meeting audio.
4. Confirm job progresses through preprocessing, STT, and analysis.
5. Check diary list and diary detail view.
6. Verify transcript segments, speaker labels/statistics, summary generation, semantic search, and audio playback context.

### Step 10: Code Standards and Tools
- Frontend linting:
```bash
cd frontend
npm run lint
```
- Frontend production build:
```bash
cd frontend
npm run build
```
- Keep secrets out of Git.
- Prefer `.env.example` templates for onboarding.
- Keep folder naming and service boundaries consistent with current structure.

## 4. Environment Variables

### Root `.env` (Docker Compose build args for frontend)
```env
VITE_API_BASE_URL=https://your-domain-or-api-base
VITE_SUPABASE_URL=https://your-project.supabase.co
```

### `backend-node/.env` (runtime env for backend, worker, and AI in Compose)
```env
PORT=9000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
HF_TOKEN=your_huggingface_token
FRONTEND_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
AI_SERVICE_URL=http://127.0.0.1:8001
BACKEND_CALLBACK_URL=http://127.0.0.1:9000/ai/progress
REDIS_URL=redis://127.0.0.1:6379
VOICE_BUCKET=voice-samples
AVATAR_BUCKET=avatars
MEETING_AUDIO_BUCKET=meeting-audios
SESSION_COOKIE_NAME=sid
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAMESITE=lax
QUEUE_WORKER_CONCURRENCY=1
RATE_LIMIT_DISABLED=false
```

### Optional AI tuning env
`ai_service/main.py` also reads optional tuning values such as `MAX_MEETING_FILE_MB`, diarization limits, overlap thresholds, and matching thresholds.

## 5. Common Issues and Troubleshooting
- Docker/Compose not installed:
  Install Docker Desktop and ensure `docker compose` works in terminal.
- Redis connection refused:
  Ensure Redis is running and `REDIS_URL` matches runtime network.
- Backend fails at startup with Supabase error:
  Confirm `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set and key role is `service_role`.
- Frontend cannot call backend:
  Check `VITE_API_BASE_URL` and `FRONTEND_ORIGIN` CORS settings.
- AI service errors about `HF_TOKEN`:
  Set a valid Hugging Face token for pyannote model access.
- Python dependency/runtime mismatch:
  Use Python `3.11.x` (project Docker image baseline) to avoid wheel/compatibility issues.
- Audio decoding problems:
  Install FFmpeg and ensure it is available in `PATH`.

## 6. Deployment Notes
- `docker-compose.yml` is ready for multi-container deployment.
- `reverse-proxy/nginx.conf` routes:
  - `/` to frontend
  - `/api/` to backend
  - `/ai/` to AI service
- `reverse-proxy/init-certbot.sh` contains certificate bootstrap flow and should be reviewed/updated before production use.

## 7. Security Notes
- Never commit `.env` files.
- If a key is exposed, rotate it immediately (Supabase service role key, HF token, etc.).
- Use environment variables or secret managers in deployment.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to frontend/client code.
