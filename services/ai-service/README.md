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

This table summarises this service's routes. The cross-service reference (request/response shapes, errors) is [docs/reference/api.md](../../docs/reference/api.md); where they differ, that file and the code are correct.

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

## 5. Environment Variables

Full list, defaults and examples: [docs/reference/environment-variables.md](../../docs/reference/environment-variables.md).

- **Required (refuses to start without them):** `MONGODB_URI` or `MONGO_URI` (`MONGODB_URI` is read first), `JWT_ACCESS_SECRET` (same value in every service), `INTERNAL_SERVICE_TOKEN` (same value as document-service), `VOYAGE_API_KEY`, `PINECONE_API_KEY`, `PINECONE_INDEX`, and `XAI_API_KEY` (a Groq `gsk_...` key or an xAI key; `GROQ_API_KEY` is accepted instead). The two secrets must be at least 32 characters and not placeholders or known-insecure values.
- **Embedding model:** `VOYAGE_MODEL` (default `voyage-3`) and `VOYAGE_EMBEDDING_DIMENSION` (default `1024`) must match the Pinecone index. At startup the service exits if the index is missing or its dimension differs; if Pinecone cannot be reached it logs a warning and continues. Changing the model requires re-indexing every document.
- **Optional:** `PORT` (default `5006`), `REDIS_URL` (embedding queue, default `redis://127.0.0.1:6379`), `DOCUMENT_SERVICE_URL` (worker claim/status, default `http://localhost:5003`), `WORKSPACE_SERVICE_URL` (membership checks), `XAI_MODEL`, `XAI_BASE_URL`, `LLM_REQUEST_TIMEOUT_MS` (default `60000`), `LLM_STREAM_IDLE_TIMEOUT_MS` (default `30000`).
- The standalone worker (`src/worker.ts`) reads the same `.env`; it needs `INTERNAL_SERVICE_TOKEN`, Redis, document-service and the Voyage/Pinecone settings, but not MongoDB or `JWT_ACCESS_SECRET`.

---

## 6. Local Development Commands

Run from the repository root: one `npm install` there installs every workspace. The service reads `services/ai-service/.env` (copy `.env.example`). Status: TESTED = run in the Wave 1–4 audits, UNTESTED = not run.

```bash
npm run dev:ai                        # HTTP server + in-process worker, live reload; same as `npm run dev -w ai-service`  [UNTESTED]
npm run dev:worker -w ai-service      # optional extra standalone worker, live reload  [UNTESTED]
npm run build -w ai-service           # compile to services/ai-service/dist  [TESTED]
npm start -w ai-service               # run the compiled HTTP server + worker  [TESTED, with dummy provider keys]
npm run start:worker -w ai-service    # run the compiled standalone worker  [UNTESTED]
./node_modules/.bin/tsc --noEmit -p services/ai-service   # typecheck, as CI does  [TESTED]
curl http://localhost:5006/health     # MongoDB + Redis health  [UNTESTED]

# Live-provider utilities (need real Pinecone keys)
npm run test:pinecone -w ai-service   # upserts, then deletes, a test vector in namespace "researchmind-test-workspace"  [UNTESTED]
npm run verify:vectors -w ai-service -- <documentId> <workspaceId>   # prints index stats and the workspace namespace's record count only (documentId is not used)  [UNTESTED]
```

`test:pinecone` is not part of the automated test suite. The service's automated tests are in the root `tests/` folder and run with `npm test` (see [Testing](../../docs/testing.md)); they stub Voyage, Pinecone and the LLM. Graceful shutdown waits up to 30 s so an embedding job in progress can finish.

---

## 7. Related Documentation

- [Developer onboarding](../../docs/onboarding.md)
- [Environment variables](../../docs/reference/environment-variables.md)
- [API reference](../../docs/reference/api.md)
- [Documents and AI](../../docs/architecture/documents-and-ai.md)
- [Background jobs](../../docs/operations/background-jobs.md)
- [Testing](../../docs/testing.md)
- [Deployment and operations](../../docs/deployment/docker-process.md)
