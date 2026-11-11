# Developer Onboarding Guide — ResearchMind

Welcome to **ResearchMind**! This guide will help you set up and run the platform locally.

---

## 1. Prerequisites

Ensure you have the following installed on your developer machine:
- **Node.js**: `v22.x` (CI uses Node 22; several dependencies declare `node >= 22`)
- **npm**: `v10.x` or later
- **Docker Desktop**: Required to run MongoDB and Redis infrastructure containers
- **Git**: For version control
- Accounts/keys for external services: **Cloudinary** (file storage), **Voyage AI** (embeddings), **Pinecone** (vector index with dimension `1024`, cosine metric; create it yourself, there is no setup script), and **Groq or xAI** (LLM).

Install all workspace dependencies once, from the repository root:

```bash
npm install
```

---

## 2. Infrastructure Setup (Docker)

Start MongoDB and Redis containers using Docker Compose:

```bash
docker-compose up -d
```

Verify that the containers are running:
- **MongoDB**: `localhost:27017`. Authentication is enabled (root user from `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD`, see `docker-compose.yml`), so connection strings need `<user>:<password>@...?authSource=admin`.
- **Redis**: `localhost:6379`
- **Mongo Express UI**: `http://localhost:8081` (basic auth from `MONGO_EXPRESS_USERNAME` / `MONGO_EXPRESS_PASSWORD`)

---

## 3. Microservice Setup & Ports

| Service | Directory | Dev Command | Port | Database / Storage |
|---------|-----------|-------------|------|--------------------|
| **API Gateway** | `services/api-gateway` | `npm run dev` | `5000` | Redis Rate Limiter |
| **Auth Service** | `services/auth-service` | `npm run dev` | `5001` | `researchmind-auth` |
| **Workspace Service** | `services/workspace-service` | `npm run dev` | `5002` | `researchmind-workspace` |
| **Document Service** | `services/document-service` | `npm run dev` | `5003` | `researchmind-documents`, Cloudinary, Redis queue producer |
| **Task Service** | `services/task-service` | `npm run dev` | `5004` | `researchmind-tasks` |
| **AI Service (HTTP + worker)** | `services/ai-service` | `npm run dev` | `5006` | `researchmind_ai` / Pinecone / Redis queue consumer |
| **AI Service (standalone worker, optional)**| `services/ai-service` | `npm run dev:worker` | — | Extra Redis queue consumer |
| **Frontend SPA** | `frontend` | `npm run dev` | `5173` | Browser / LocalStorage |

- The AI HTTP service already runs the embedding worker in-process; the standalone worker is optional.
- From the repository root, `npm run dev` starts the gateway, the five backend services and the frontend together (`npm run dev:services` starts only the backend).
- The notification service is not implemented and is not started.
- Database names are examples: each service uses whatever database its connection string names.

---

## 4. Environment Configuration

Copy each service's `.env.example` to `.env` in the same directory and fill it in. The variable names below match the code.

Rules that apply to every service:
- `JWT_ACCESS_SECRET` must be identical in every service. `JWT_REFRESH_SECRET` (auth-service only) must differ from it. `INTERNAL_SERVICE_TOKEN` must be identical wherever it is set.
- Services refuse to start if a required secret is missing, a `<placeholder>`, shorter than 32 characters, or a known-insecure value. Generate each one with `openssl rand -hex 48`.
- `INTERNAL_SERVICE_TOKEN` is not checked at startup by auth-service and workspace-service, but every service refuses internal (service-to-service) calls while it is missing, a `<placeholder>` or weak. Without a valid shared token, workspace member lists show a placeholder name instead of real names.
- MongoDB: auth-service and workspace-service read only `MONGO_URI`; document-, task- and ai-service read `MONGODB_URI` first, then `MONGO_URI`.

### Gateway (`services/api-gateway/.env`)
```env
PORT=5000
AUTH_SERVICE_URL=http://127.0.0.1:5001
WORKSPACE_SERVICE_URL=http://127.0.0.1:5002
DOCUMENT_SERVICE_URL=http://127.0.0.1:5003
TASK_SERVICE_URL=http://127.0.0.1:5004
AI_SERVICE_URL=http://127.0.0.1:5006
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=<generate-with-openssl-rand-hex-48>
```

### Auth Service (`services/auth-service/.env`)
```env
PORT=5001
MONGO_URI=mongodb://<user>:<password>@127.0.0.1:27017/researchmind-auth?authSource=admin
# Redis is connected at startup but not used by any route
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
ACCESS_TOKEN_EXPIRES=15m
REFRESH_TOKEN_EXPIRES=7d
# Optional, default 10000 (ms)
# REFRESH_REUSE_GRACE_MS=10000
JWT_ACCESS_SECRET=<generate-with-openssl-rand-hex-48>
JWT_REFRESH_SECRET=<generate-with-openssl-rand-hex-48>
# Needed for workspace member names (POST /internal/users/bulk); same value as workspace-service
INTERNAL_SERVICE_TOKEN=<generate-with-openssl-rand-hex-48>
```

### Workspace Service (`services/workspace-service/.env`)
```env
PORT=5002
MONGO_URI=mongodb://<user>:<password>@127.0.0.1:27017/researchmind-workspace?authSource=admin
JWT_ACCESS_SECRET=<generate-with-openssl-rand-hex-48>
# Optional: resolve member names from auth-service (otherwise members show a placeholder name)
AUTH_SERVICE_URL=http://127.0.0.1:5001
INTERNAL_SERVICE_TOKEN=<same value as auth-service>
```

### Document Service (`services/document-service/.env`)
```env
PORT=5003
MONGO_URI=mongodb://<user>:<password>@127.0.0.1:27017/researchmind-documents?authSource=admin
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=<generate-with-openssl-rand-hex-48>
# Required; same value as ai-service
INTERNAL_SERVICE_TOKEN=<generate-with-openssl-rand-hex-48>
CLOUDINARY_CLOUD_NAME=<cloudinary-cloud-name>
CLOUDINARY_API_KEY=<cloudinary-api-key>
CLOUDINARY_API_SECRET=<your_secret>
WORKSPACE_SERVICE_URL=http://127.0.0.1:5002
# Used to remove a document's vectors when it is deleted
AI_SERVICE_URL=http://127.0.0.1:5006
```

### Task Service (`services/task-service/.env`)
```env
PORT=5004
MONGO_URI=mongodb://<user>:<password>@127.0.0.1:27017/researchmind-tasks?authSource=admin
WORKSPACE_SERVICE_URL=http://127.0.0.1:5002
JWT_ACCESS_SECRET=<generate-with-openssl-rand-hex-48>
```

### AI Service (`services/ai-service/.env`)
```env
PORT=5006
REDIS_URL=redis://127.0.0.1:6379
VOYAGE_API_KEY=<your_voyage_key>
# Must match the Pinecone index (code default voyage-3 / 1024). Changing it requires re-indexing every document.
VOYAGE_MODEL=voyage-3
VOYAGE_EMBEDDING_DIMENSION=1024
PINECONE_API_KEY=<your_pinecone_key>
PINECONE_INDEX=researchmind
DOCUMENT_SERVICE_URL=http://localhost:5003
WORKSPACE_SERVICE_URL=http://localhost:5002
# Groq key (gsk_...) or xAI key; GROQ_API_KEY is accepted as an alternative name
XAI_API_KEY=<your_groq_or_xai_key>
MONGO_URI=mongodb://<user>:<password>@localhost:27017/researchmind_ai?authSource=admin
JWT_ACCESS_SECRET=<generate-with-openssl-rand-hex-48>
# Required; same value as document-service
INTERNAL_SERVICE_TOKEN=<same value as document-service>
```

### Frontend (`frontend/.env`)
```env
# Must include the /api suffix (default http://localhost:5000/api)
VITE_API_URL=http://localhost:5000/api
```

---

## 5. Verification Workflow

1. Open `http://localhost:5173/` in your browser.
2. Register a new user account (e.g., `user@test.com` / `Password123!`).
3. Create a workspace (e.g., `"AI Engineering Research"`).
4. Navigate to Documents (`/dashboard/documents`).
5. Click **"+ Upload document"** and select a PDF or DOCX file (max 10 MB).
6. Verify the document appears in the library grid and its status moves from `pending` to `indexed` (or `failed`, with a reason).
7. Click the PDF card to render the document in the **In-App PDF Viewer**.
8. Ask a question on the AI Q&A page (`/dashboard/ai-researcher`), which streams from `POST /api/ai/query`. `POST /api/ai/search` returns raw retrieval results.
9. Run the automated tests from the repository root with `npm test`. The integration tests need `TEST_MONGO_URI` and are skipped without it.
