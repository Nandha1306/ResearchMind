# AI Service (`ai-service`)

Artificial Intelligence, Document Vector Embedding, RAG LLM Query Engine, and Session Persistence microservice for **ResearchMind**.

---

## 1. Purpose
The AI Service handles document chunking, Voyage AI vector embedding generation, Pinecone multi-tenant vector storage, real-time RAG LLM streaming via Server-Sent Events (SSE), source citation resolution, and MongoDB interaction logging.

---

## 2. Key Responsibilities
- **Background Redis Queue Consumer**: The HTTP server (`npm run dev`) starts the embedding worker in-process; `npm run dev:worker` runs an additional standalone worker (optional — a second consumer on the same queue is safe but not required). The worker consumes jobs from the Redis list `researchmind:embedding:jobs`, claims the document from document-service before processing, splits the text into overlapping chunks (LangChain `RecursiveCharacterTextSplitter`, ~400 estimated tokens with 60 overlap), embeds them with Voyage AI (model `VOYAGE_MODEL`, default `voyage-3`, 1024 dimensions by default) and upserts the vectors to Pinecone under `namespace = workspaceId`. It reports `indexed` or `failed` (with a reason) back to document-service, which allows up to 3 attempts per document.
- **Pure Vector Retrieval (`POST /api/ai/search`)**: Embeds the query and returns the raw retrieval results (chunks with similarity scores) from Pinecone. Not streamed.
- **Real-Time RAG Stream (`POST /api/ai/query`)**: Validates workspace membership, retrieves chunks, builds the context with `[Source N]` references and streams the answer as Server-Sent Events: `start` → `sources` → `token` (repeated) → `done` (`sessionId`, `unverifiedCitations`), or `error` (`message`, `partial`) if generation fails. The query is trimmed and must be 1–2000 characters; `topK` is 1–10 (default 5).
- **Session History (`GET /api/ai/sessions/workspace/:workspaceId`)**: Lists the workspace's past Q&A sessions (`AISession` Mongoose model).
- **Meeting Summarizer (`POST /api/ai/summarize-meeting`)**: Turns 10–50000 characters of meeting notes into structured JSON (`meeting_date`, `attendees`, `summary`, `decisions`, `action_items`, `open_questions`, `next_meeting`). Not streamed and not stored.
- **Vector cleanup (internal)**: `DELETE /internal/vectors/workspaces/:workspaceId/documents/:documentId`, called by document-service before a document is deleted; protected by the `X-Internal-Token` header (`INTERNAL_SERVICE_TOKEN`).
- **LLM provider**: Groq or xAI through the OpenAI SDK (`src/config/grok.ts`). A key starting with `gsk_` selects Groq (default model `openai/gpt-oss-120b`); any other key selects xAI (default model `grok-4.5`).

---

## 3. Architecture & Data Flow

```
REDIS QUEUE → WORKER → VOYAGE AI (voyage-3 by default, 1024 dims) → PINECONE (namespace: workspaceId)
                                                      ↓
POST /api/ai/query → JWT Auth → Membership Check → Vector Search → Context Builder → Groq/xAI LLM → SSE Stream → MongoDB AISession
```

---

## 4. API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check endpoint |
| `POST` | `/api/ai/search` | JWT + membership | Raw vector retrieval results (`{ workspaceId, query, topK? }`) |
| `POST` | `/api/ai/query` | JWT + membership | RAG answer streamed as `text/event-stream` (`{ workspaceId, query, topK?, sessionId? }`) |
| `GET` | `/api/ai/sessions/workspace/:workspaceId` | JWT + membership | List past Q&A sessions |
| `POST` | `/api/ai/summarize-meeting` | JWT + membership | Structured meeting summary JSON (`{ workspaceId, text }`) |
| `DELETE` | `/internal/vectors/workspaces/:workspaceId/documents/:documentId` | `X-Internal-Token` | Remove a document's vectors (called by document-service) |

Membership is checked against workspace-service: malformed workspace id → `400`, not a member → `403`, check could not run → `503`.

---

## 5. Environment Variables (`services/ai-service/.env`, see `.env.example`)

```env
PORT=5006
REDIS_URL=redis://127.0.0.1:6379

VOYAGE_API_KEY=<your_voyage_key>
# Must match the model/dimension the Pinecone index was built with (code default: voyage-3 / 1024).
VOYAGE_MODEL=voyage-3
VOYAGE_EMBEDDING_DIMENSION=1024

PINECONE_API_KEY=<your_pinecone_key>
PINECONE_INDEX=researchmind

DOCUMENT_SERVICE_URL=http://localhost:5003
WORKSPACE_SERVICE_URL=http://localhost:5002

# Groq or xAI key (GROQ_API_KEY is accepted as an alternative name)
XAI_API_KEY=<your_groq_or_xai_key>
# Optional overrides: XAI_MODEL, XAI_BASE_URL, LLM_REQUEST_TIMEOUT_MS (default 60000), LLM_STREAM_IDLE_TIMEOUT_MS (default 30000)

# MONGODB_URI is read first, then MONGO_URI
MONGO_URI=mongodb://<user>:<password>@localhost:27017/researchmind_ai?authSource=admin

# Required: the service refuses to start without these (min. 32 characters each)
JWT_ACCESS_SECRET=<same value as every other service>
INTERNAL_SERVICE_TOKEN=<same value as document-service>
```

---

## 6. Local Development Commands

```bash
# Start AI Service HTTP Server
npm run dev

# Start AI Embedding Worker
npm run dev:worker

# Typecheck TypeScript
npx tsc --noEmit