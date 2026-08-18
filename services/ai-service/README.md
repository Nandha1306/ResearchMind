# AI Service (`ai-service`)

Artificial Intelligence, Document Vector Embedding, RAG LLM Query Engine, and Session Persistence microservice for **ResearchMind**.

---

## 1. Purpose
The AI Service handles document chunking, Voyage AI vector embedding generation, Pinecone multi-tenant vector storage, real-time RAG LLM streaming via Server-Sent Events (SSE), source citation resolution, and MongoDB interaction logging.

---

## 2. Key Responsibilities
- **Background Redis Queue Consumer (`npm run dev:worker`)**: Consumes embedding jobs from Redis queue `researchmind:embedding:jobs`, performs paragraph-boundary text chunking, generates 1024-dimension Voyage AI embeddings (`voyage-4`), and upserts vectors to Pinecone under `namespace = workspaceId`.
- **Pure Vector Retrieval (`POST /api/ai/search`)**: Vectorizes queries with `embedQuery()` and returns numeric similarity scores and `RetrievedChunk[]` from Pinecone.
- **Real-Time RAG Stream (`POST /api/ai/query`)**: Validates workspace membership, performs vector retrieval, formats RAG context with `[Source N]` references, streams LLM tokens via SSE (`start` $\rightarrow$ `sources` $\rightarrow$ `token` $\rightarrow$ `done`), and logs session data to MongoDB.
- **Session Persistence**: Saves Q&A sessions (`AISession` Mongoose model) to MongoDB database `researchmind_ai`.

---

## 3. Architecture & Data Flow

```
REDIS QUEUE → WORKER → VOYAGE AI (1024 dims) → PINECONE (namespace: workspaceId)
                                                      ↓
POST /api/ai/query → JWT Auth → Membership Check → Vector Search → Context Builder → Groq/xAI LLM → SSE Stream → MongoDB AISession
```

---

## 4. API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | No | Health check endpoint |
| `POST` | `/api/ai/search` | JWT | Pure vector retrieval / debugging endpoint returning `RetrievedChunk[]` |
| `POST` | `/api/ai/query` | JWT | Complete RAG stream endpoint returning `text/event-stream` SSE tokens |

---

## 5. Environment Variables (`services/ai-service/.env`)

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
XAI_MODEL=openai/gpt-oss-120b
MONGO_URI=mongodb://admin:password@localhost:27017/researchmind_ai?authSource=admin
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
```
