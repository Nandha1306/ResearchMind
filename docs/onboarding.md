# Developer Onboarding Guide — ResearchMind

Welcome to **ResearchMind**! This guide will help you set up and run the platform locally.

---

## 1. Prerequisites

Ensure you have the following installed on your developer machine:
- **Node.js**: `v20.x` or later
- **npm**: `v10.x` or later
- **Docker Desktop**: Required to run MongoDB and Redis infrastructure containers
- **Git**: For version control

---

## 2. Infrastructure Setup (Docker)

Start MongoDB and Redis containers using Docker Compose:

```bash
docker-compose up -d
```

Verify that the containers are running:
- **MongoDB**: `localhost:27017`
- **Redis**: `localhost:6379`
- **Mongo Express UI**: `http://localhost:8081`

---

## 3. Microservice Setup & Ports

| Service | Directory | Dev Command | Port | Database / Storage |
|---------|-----------|-------------|------|--------------------|
| **API Gateway** | `services/api-gateway` | `npm run dev` | `5000` | Redis Rate Limiter |
| **Auth Service** | `services/auth-service` | `npm run dev` | `5001` | `researchmind-auth` |
| **Workspace Service** | `services/workspace-service` | `npm run dev` | `5002` | `researchmind-workspace` |
| **Document Service** | `services/document-service` | `npm run dev` | `5003` | `researchmind-documents` |
| **AI Service (HTTP)** | `services/ai-service` | `npm run dev` | `5006` | `researchmind_ai` / Pinecone |
| **AI Service (Worker)**| `services/ai-service` | `npm run dev:worker` | — | Redis Queue Consumer |
| **Frontend SPA** | `frontend` | `npm run dev` | `5173` | Browser / LocalStorage |

---

## 4. Environment Configuration

Ensure environment variables are configured in each service directory (or `.env`):

### Gateway (`services/api-gateway/.env`)
```env
PORT=5000
AUTH_SERVICE_URL=http://127.0.0.1:5001
WORKSPACE_SERVICE_URL=http://127.0.0.1:5002
DOCUMENT_SERVICE_URL=http://127.0.0.1:5003
AI_SERVICE_URL=http://127.0.0.1:5006
JWT_ACCESS_SECRET=researchmind_access_secret
```

### Auth Service (`services/auth-service/.env`)
```env
PORT=5001
MONGODB_URI=mongodb://127.0.0.1:27017/researchmind-auth
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=researchmind_access_secret
JWT_REFRESH_SECRET=researchmind_refresh_secret
```

### Workspace Service (`services/workspace-service/.env`)
```env
PORT=5002
MONGODB_URI=mongodb://127.0.0.1:27017/researchmind-workspace
JWT_ACCESS_SECRET=researchmind_access_secret
```

### Document Service (`services/document-service/.env`)
```env
PORT=5003
MONGODB_URI=mongodb://127.0.0.1:27017/researchmind-documents
REDIS_URL=redis://127.0.0.1:6379
JWT_ACCESS_SECRET=researchmind_access_secret
CLOUDINARY_CLOUD_NAME=qje2tu3s
CLOUDINARY_API_KEY=812348284878871
CLOUDINARY_API_SECRET=<your_secret>
WORKSPACE_SERVICE_URL=http://127.0.0.1:5002
```

### AI Service (`services/ai-service/.env`)
```env
PORT=5006
REDIS_URL=redis://127.0.0.1:6379
VOYAGE_API_KEY=<your_voyage_key>
VOYAGE_MODEL=voyage-4
VOYAGE_EMBEDDING_DIMENSION=1024
PINECONE_API_KEY=<your_pinecone_key>
PINECONE_INDEX=researchmind
DOCUMENT_SERVICE_URL=http://localhost:5003
WORKSPACE_SERVICE_URL=http://localhost:5002
XAI_API_KEY=<your_groq_or_xai_key>
MONGO_URI=mongodb://admin:password@localhost:27017/researchmind_ai?authSource=admin
```

---

## 5. Verification Workflow

1. Open `http://localhost:5173/` in your browser.
2. Register a new user account (e.g., `user@test.com` / `Password123!`).
3. Create a workspace (e.g., `"AI Engineering Research"`).
4. Navigate to Documents (`/dashboard/documents`).
5. Click **"+ Upload document"** and select a PDF file.
6. Verify the document appears in the library grid.
7. Click the PDF card to render the document in the **In-App PDF Viewer**.
8. Test vector search via `POST /api/ai/search` or streaming RAG SSE queries via `POST /api/ai/query`.
