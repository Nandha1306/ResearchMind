# 🎓 ResearchMind
### AI Research & Project Workspace for Engineering Student Teams

> Engineering students generate massive amounts of project knowledge — research papers, reports,
> meeting notes, code docs, and discussions — scattered across drives, chats, and emails.
> **ResearchMind** brings it all into one intelligent workspace that doesn't just store information —
> it *understands* it, and actively assists teams throughout the entire project lifecycle.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://reactjs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?logo=mongodb)](https://mongodb.com)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis)](https://redis.io)
[![Pinecone](https://img.shields.io/badge/Pinecone-Vector_DB-000000)](https://pinecone.io)
[![LLM](https://img.shields.io/badge/LLM-Groq_%2F_xAI-orange)](https://groq.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://docker.com)

---

## Current Implementation Status

This README describes the full product design. Much of it is **not built yet**. This section describes what the code in this repository actually does. Where a later section disagrees with it, this section is correct, and any feature not listed here as implemented is **Roadmap / not yet implemented**. Per-service details are in `services/*/README.md`, `docs/onboarding.md` and `docs/architecture/system-architecture.md`.

**Repository layout.** An npm-workspaces monorepo: `frontend/` (React 19 + Vite + TypeScript), `services/*` (Express 5 + TypeScript microservices) and `packages/{shared,validation}` (shared backend code and zod schemas). There is no `apps/` directory.

| Service | Directory | Default port | Status |
|---------|-----------|--------------|--------|
| API Gateway | `services/api-gateway` | 5000 | Implemented |
| Auth Service | `services/auth-service` | 5001 | Implemented |
| Workspace Service | `services/workspace-service` | 5002 | Implemented (separate service, not part of auth) |
| Document Service | `services/document-service` | 5003 | Implemented |
| Task Service | `services/task-service` | 5004 | Implemented |
| AI Service (+ embedding worker) | `services/ai-service` | 5006 | Implemented |
| Notification Service | `services/notification-service` | — | Not implemented (empty placeholder) |
| Chat Service | — | — | Not implemented (does not exist) |
| Frontend | `frontend` | 5173 | Implemented |

**Actual stack.** LLM: Groq or xAI, called through the OpenAI SDK (`services/ai-service/src/config/grok.ts`; a `gsk_` key selects Groq, default model `openai/gpt-oss-120b`, otherwise xAI, default `grok-4.5`). Anthropic Claude is not used. Embeddings: Voyage AI, model `VOYAGE_MODEL` (default `voyage-3`, 1024 dimensions). Vector store: Pinecone, one namespace per workspace. Validation: zod (`packages/validation`), not Joi. Storage: MongoDB (Mongoose), Redis (gateway rate limits and the embedding queue), Cloudinary (original files).

**Implemented behaviour.**
- **Auth**: register, login, refresh, logout, `GET /api/auth/me`. Access token (default 15 min) plus refresh token (default 7 days). The refresh token is sent in the JSON request body (no cookie) and stored only as a SHA-256 hash in MongoDB (not Redis). The client keeps both tokens in `localStorage`. Every refresh rotates the pair. Reusing an already-rotated token revokes all of the user's sessions, except within `REFRESH_REUSE_GRACE_MS` (default 10 s), where a concurrent refresh is only rejected.
- **Gateway**: verifies the JWT, applies Redis-backed rate limits and proxies to the services. It does not check workspace membership: each service checks membership against workspace-service. A malformed workspace id answers `400`, a non-member gets `403`, and `503` means the check could not run.
- **Workspaces**: create, list and join with an invite code (case-insensitive; unknown code → `404`, already a member → `409`), plus the member list. There is no role system, and invite codes do not expire.
- **Documents**: upload PDF or DOCX only (max 10 MB; wrong type → `415`, empty or unreadable → `422`, too large → `413`). Text is extracted, the file is stored on Cloudinary, and the document is embedded in the background through a Redis queue consumed by an ai-service worker. Status is `pending` / `indexing` / `indexed` / `failed` (with a failure reason). Indexing is retried automatically up to 3 attempts, and manual re-index is available. Deleting a document removes its vectors first and answers `503` if that fails. Markdown and TXT are not supported.
- **AI Q&A**: `POST /api/ai/query` streams Server-Sent Events: `start`, `sources`, `token`, then `done` (`sessionId`, `unverifiedCitations`), or `error` (`message`, `partial`). The query is trimmed and must be 1–2000 characters; `topK` is 1–10. `GET /api/ai/sessions/workspace/:workspaceId` lists past sessions, and `POST /api/ai/search` returns raw retrieval results. The frontend Q&A page streams from `/api/ai/query`.
- **Meeting summarizer**: `POST /api/ai/summarize-meeting` returns structured JSON (not streamed). The page can create tasks from action items.
- **Tasks**: boards, tasks, subtasks, activity log and a drag-and-drop Kanban board. The assignee must be a workspace member's user id (`400` otherwise). Bulk creation (`POST /api/tasks/workspaces/:workspaceId/tasks/bulk`) takes at most 50 tasks, is all-or-nothing, and is idempotent with an optional `importKey`.
- **Tests/CI**: `npm test` runs `tests/*.test.ts` with Node's test runner via `tsx`. GitHub Actions (`.github/workflows/ci.yml`) typechecks the services, builds the frontend and runs the tests.

**Known limitations / not yet implemented.** No notifications of any kind, no Google sign-in (button shows "coming soon"), no password reset, no profile editing, no real-time chat or WebSockets, no AI agent, no literature review generator, report drafter or onboarding summary, no progress dashboard (the Overview page only shows indexed-document, Q&A-session and member counts plus the latest session), no caching layer or Redis pub/sub, no Dockerfiles or deployment, no demo seed script. The Sources, Analytics, Literature Review, Report Drafter and Settings pages are placeholders.

---

## 📌 Table of Contents

0. [Current Implementation Status](#current-implementation-status)
1. [Problem Statement](#1-problem-statement)
2. [Proposed Solution](#2-proposed-solution)
3. [Key Features](#3-key-features)
4. [Why This Is a Real AI Project](#4-why-this-is-a-real-ai-project)
5. [Use Cases & User Stories](#5-use-cases--user-stories)
6. [System Architecture](#6-system-architecture)
7. [Tech Stack](#7-tech-stack)
8. [Microservices Breakdown](#8-microservices-breakdown)
9. [RAG Pipeline — Deep Dive](#9-rag-pipeline--deep-dive)
10. [AI Agent System — Deep Dive](#10-ai-agent-system--deep-dive)
11. [All AI Features](#11-all-ai-features)
12. [Database Design](#12-database-design)
13. [API Reference](#13-api-reference)
14. [Real-Time & System Design Concepts](#14-real-time--system-design-concepts)
15. [Frontend Modules](#15-frontend-modules)
16. [Phase-by-Phase Build Plan](#16-phase-by-phase-build-plan)
17. [Folder Structure](#17-folder-structure)
18. [Environment Variables](#18-environment-variables)
19. [Local Development Setup](#19-local-development-setup)
20. [Docker Setup](#20-docker-setup)
21. [Testing Strategy](#21-testing-strategy)
22. [Deployment Plan](#22-deployment-plan)
23. [Portfolio & Presentation Guide](#23-portfolio--presentation-guide)

---

## 1. Problem Statement

Engineering student teams face a persistent and growing knowledge management crisis:

- **Scattered information** — Research papers live in Google Drive, meeting notes in WhatsApp, task lists in Notion, code docs in GitHub, and discussions in email threads.
- **No institutional memory** — When a team member leaves or a project resumes after a semester break, knowledge is lost or impossible to recover.
- **Redundant research** — Students re-read the same papers because they can't recall what was already reviewed or what conclusions were drawn.
- **Manual documentation overhead** — Writing literature reviews, meeting summaries, progress reports, and task lists consumes time that should go toward actual engineering.
- **Context loss in discussions** — A question like *"What did we decide about the microcontroller choice?"* requires someone to dig through weeks of chat history.

> **The result:** Teams spend more time managing information than acting on it.

---

## 2. Proposed Solution

**ResearchMind** is a centralized AI-powered workspace purpose-built for engineering project teams.

It solves the problem at three levels:

### Level 1 — Centralized Knowledge Base
All project artifacts — research papers (PDF), meeting notes, reports, code documentation, and discussions — are uploaded to one place. The system ingests and understands them.

### Level 2 — Semantic Intelligence (RAG)
The platform builds a **semantic knowledge base** from all uploaded content. Students ask natural language questions:
- *"Which papers support using LSTM for our prediction model?"*
- *"What are the hardware constraints mentioned in our project report?"*
- *"Has anyone already reviewed this topic?"*

The system retrieves relevant content from across all documents and generates a grounded, cited answer.

### Level 3 — Autonomous AI Agents
Beyond answering questions, AI agents **actively work** alongside the team:
- Automatically generate a literature review from uploaded papers
- Summarize meeting notes into decisions, action items, and open questions
- Create and assign tasks based on what was discussed
- Draft project documentation sections on demand
- Monitor project progress and surface risks

---

## 3. Key Features

| Module | Feature | AI Technique | Status |
|--------|---------|-------------|--------|
| 📄 Document Ingestion | Upload PDF, DOCX (MD, TXT planned) | Chunking + Embedding pipeline | Implemented for PDF and DOCX only |
| 🔍 Semantic Search | Natural language Q&A over all documents | RAG — vector similarity search | Implemented |
| 🤖 AI Agent | Multi-step task automation | Tool calling + ReAct loop | Roadmap / not yet implemented |
| 📚 Literature Review Generator | Auto-generate review from papers | RAG + structured generation | Roadmap / not yet implemented (placeholder page) |
| 📝 Meeting Summarizer | Paste notes → decisions + tasks | Structured output prompting | Implemented |
| ✅ Task Manager | Kanban board + AI task creation | Agent tool execution | Kanban board implemented; tasks are created from meeting action items via bulk creation (no agent) |
| 💬 Project Chat | Real-time team messaging | WebSocket + pub/sub | Roadmap / not yet implemented |
| 📊 Progress Tracker | Visual project timeline | Aggregation + AI insight | Roadmap / not yet implemented |
| 🔔 Smart Notifications | Relevant alerts, not noise | Event-driven + AI filtering | Roadmap / not yet implemented |
| 👥 Team Workspace | Isolated per project team | Multi-tenant architecture | Implemented (invite code join, no roles) |

---

## 4. Why This Is a Real AI Project

Most student projects that "use AI" simply call the ChatGPT API and display a response. That is AI-*consumption*, not AI-*engineering*.

ResearchMind implements AI at the **system design level**:

### ✅ RAG — Retrieval-Augmented Generation

The system does not send all documents into a prompt (too expensive, hits context limits). Instead:

1. Every uploaded document is **chunked** into overlapping text segments
2. Each chunk is converted into a **vector embedding** (a numerical representation of meaning)
3. Embeddings are stored in **Pinecone** (a vector database)
4. When a user asks a question, the question is also embedded
5. **Semantic similarity search** finds the most relevant chunks — not by keyword, but by meaning
6. Only the relevant chunks are injected into the LLM prompt
7. The LLM generates an answer **grounded in actual project documents** with citations

This means:
- No hallucination — AI only answers from what your team actually wrote
- Cost-efficient — only relevant context hits the LLM
- Scalable — works with hundreds of documents

### 🔜 AI Agent with Tool Calling (roadmap)

> **Roadmap / not yet implemented.** No agent endpoint or agent UI exists. The project's LLM is Groq/xAI through the OpenAI SDK, not Claude.

The planned agent uses the LLM's **function calling API** with a ReAct (Reasoning + Acting) loop:

- Agent receives a natural language instruction
- Reasons about what steps are needed
- Calls tools (search docs, create task, summarize, post message) in sequence
- Observes results and decides next steps
- Reports what it did with full transparency

This is not a chatbot. It is an **autonomous workflow executor**.

### ✅ Document Embedding Pipeline

A real background data pipeline:
- Triggered on every document upload
- Handles PDF text extraction and DOCX parsing (Markdown parsing is roadmap / not yet implemented)
- Intelligent chunking (respects paragraph boundaries, overlapping windows)
- Batch embedding with retry logic
- Incremental upsert to Pinecone (not full re-index on every change)

### ✅ Structured Output Generation

> **Status:** only the meeting summarizer exists. It uses schema-guided prompting, and the JSON output is validated with zod. Literature reviews, multi-pass generation and page-level citation tracking are roadmap / not yet implemented.

For literature reviews and meeting summaries, the system uses:
- Schema-guided prompting to force structured JSON output
- Multi-pass generation (outline → section → full review)
- Citation tracking — every claim linked back to source document + page

### 🔜 Context-Aware Prompting at Scale (roadmap)

> **Status:** roadmap. Today the Q&A prompt injects only the retrieved chunks (with `[Source N]` labels) and the user's question.

Every AI call dynamically injects:
- Project name, domain, and description
- Team member names and roles
- Relevant retrieved chunks (RAG context)
- Task and document history
- Current date and project timeline

This is **system-level prompt engineering**, not ad-hoc prompting.

---

## 5. Use Cases & User Stories

### 👤 As a Student Team Member

- I can upload a research paper and immediately ask *"What methodology does this paper use?"*
- I can ask *"Which of our papers compare CNN vs LSTM for time series?"* and get an answer with citations
- I can paste raw meeting notes and have them formatted into a structured summary with action items
- I can ask the AI agent to *"Create tasks for all action items from today's meeting"*
- I can search across all project documents in plain English

### 👨‍💼 As a Project Team Lead

- I can see all tasks generated from meetings, assigned to team members
- I can ask *"What is the current status of the literature review?"*
- I can trigger the AI to generate a literature review draft from all uploaded papers
- I can view a progress dashboard showing completed vs open tasks by week
- I can ask the agent to *"Draft the methodology section of our report based on our notes"*

### 👩‍🏫 As a Faculty Advisor / Guide

- I can be added to a project workspace in read-only mode
- I can view the team's knowledge base, documents, and progress
- I can ask questions about the project state — *"Has the team reviewed papers on transformer architectures?"*
- I can see the AI-generated literature review and task history

### 🧑‍💻 As a New Team Member (Mid-project join)

- I upload zero documents but can immediately ask *"What has the team done so far?"*
- I get onboarded by the AI: *"Summarize this project for a new member joining today"*
- I can explore all past decisions, papers reviewed, and current task status through natural language

---

## 6. System Architecture

> **Target design.** The diagram below is the planned architecture. The ports `3000–3006`, the Chat and Notification services, Socket.io, Redis pub/sub, request-ID tracing and the notification mailer are **not implemented**. The real services and ports are API Gateway `5000`, Auth `5001`, Workspace `5002`, Document `5003`, Task `5004` and AI `5006`; see [Current Implementation Status](#current-implementation-status) and `docs/architecture/system-architecture.md`.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          REACT CLIENT                               │
│  Upload │ Q&A │ Agent │ Literature Review │ Tasks │ Chat │ Dashboard│
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS + WSS
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         API GATEWAY  :3000                          │
│   JWT Auth Middleware  │  Rate Limiting (Redis)  │  Request Routing │
│   CORS  │  Request ID Tracing  │  Logging (Winston)                 │
└──┬───────────┬──────────┬──────────┬──────────┬──────────┬──────────┘
   │           │          │          │          │          │
   ▼           ▼          ▼          ▼          ▼          ▼
┌──────┐  ┌────────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────────┐
│ Auth │  │  Doc   │  │ Chat │  │Tasks │  │  AI  │  │  Notif.  │
│ Svc  │  │  Svc   │  │ Svc  │  │ Svc  │  │ Svc  │  │  Svc     │
│:3001 │  │ :3002  │  │:3003 │  │:3004 │  │:3005 │  │ :3006    │
└──┬───┘  └───┬────┘  └──┬───┘  └──┬───┘  └──┬───┘  └────┬─────┘
   │          │           │         │          │           │
   └──────────┴───────────┴─────────┴──────────┴───────────┘
                                    │
           ┌────────────────────────┼────────────────────────┐
           ▼                        ▼                        ▼
    ┌────────────┐          ┌──────────────┐         ┌──────────────┐
    │  MongoDB   │          │    Redis     │         │   Pinecone   │
    │            │          │  Cache +     │         │  Vector DB   │
    │  Primary   │          │  Pub/Sub +   │         │  (RAG Store) │
    │  Data Store│          │  Rate Limit  │         │              │
    └────────────┘          └──────────────┘         └──────────────┘
                                    │
                         ┌──────────┴───────────┐
                         │    Socket.io Server   │
                         │   (Redis Adapter)     │
                         └───────────────────────┘

    ┌─────────────────────────────────────────────────────┐
    │               BACKGROUND WORKERS                    │
    │  Embedding Pipeline Worker  │  Notification Mailer  │
    │  (Triggered on doc upload)  │  (Redis subscriber)   │
    └─────────────────────────────────────────────────────┘
```

### Data Flow Summary

```
DOCUMENT UPLOAD FLOW
User uploads PDF/DOCX
  → Doc Service extracts text (pdf-parse / mammoth)
  → Stores the original file on Cloudinary
  → Pushes an embedding job to the Redis list researchmind:embedding:jobs
  → AI Service worker claims the job, chunks text → generates embeddings → upserts to Pinecone
  → Doc record in MongoDB updated: embeddingStatus = "indexed" (or "failed" with a reason)

SEMANTIC SEARCH FLOW
User asks: "Which papers mention BERT?"
  → AI Service embeds the query
  → Queries Pinecone (topK=5 by default, max 10, namespace=workspaceId)
  → Retrieves relevant chunks with source metadata
  → Builds prompt: system + context chunks + user question
  → Streams the Groq/xAI response back via SSE
  → Sources event lists documentId, chunkIndex, score, fileType (no page numbers)

AGENT FLOW (roadmap / not yet implemented)
User: "Summarize today's meeting and create tasks"
  → AI Service starts ReAct agent loop
  → Agent calls: read_document(meetingNotesId)
  → Agent calls: summarize_meeting(content)
  → Agent calls: create_task × N (for each action item)
  → Agent streams steps to client as they happen
  → Final report: "Created 4 tasks, summary saved as new document"
```

---

## 7. Tech Stack

> Rows marked *(planned)* are not used in the current code.

### Frontend
| Purpose | Technology | Why |
|---------|-----------|-----|
| Framework | React 19 + Vite + TypeScript | Fast dev server, modern tooling |
| State Management | Zustand (+ TanStack React Query for server state) | Lightweight, no boilerplate |
| Styling | Tailwind CSS + shadcn/ui | Fast, consistent UI |
| File Upload | react-dropzone *(planned)* | PDF/DOCX drag-and-drop |
| Rich Text Editor | TipTap *(planned)* | Extensible, supports collaboration |
| Real-time | Socket.io-client *(planned)* | Chat + live updates |
| HTTP Client | Axios + interceptors | Auto token refresh |
| Routing | React Router v7 | Standard SPA routing |
| Drag and Drop | @dnd-kit/core | Kanban board |
| AI Streaming | `fetch` + `ReadableStream` SSE parser | Token-by-token output from `POST /api/ai/query` (EventSource cannot send a POST body) |
| Charts | Recharts *(installed; no page uses it yet)* | Progress dashboard |
| PDF Viewer | react-pdf | View uploaded papers in-app |

### Backend (per microservice)
| Purpose | Technology | Why |
|---------|-----------|-----|
| Runtime | Node.js 22 (TypeScript, `ts-node` in development) | V8 performance, huge ecosystem |
| Framework | Express 5 | Minimal, flexible |
| Real-time | Socket.io *(planned)* | WebSocket + fallbacks |
| Auth | jsonwebtoken + bcryptjs | Industry standard |
| Validation | zod (`packages/validation`) | Declarative schema validation |
| File handling | Multer + Cloudinary | Upload + CDN storage |
| PDF extraction | pdf-parse | Extract text from PDFs |
| DOCX extraction | mammoth | Extract text from DOCX |
| Logging | Morgan (HTTP logs); Winston only in document-service | Structured logs |
| Process manager | PM2 (prod) *(planned)* | Restart on crash |

### Data & AI Infrastructure
| Tool | Purpose |
|------|---------|
| MongoDB + Mongoose | Primary data store — documents, tasks, users |
| Redis (ioredis) | Gateway rate limiting and the embedding job queue (caching, pub/sub and presence are planned) |
| Pinecone | Vector database for semantic search |
| Groq / xAI via the OpenAI SDK | LLM for Q&A and meeting summaries (Anthropic Claude is not used) |
| Voyage AI embeddings (`voyage-3` by default) | Generate document + query embeddings |
| Docker + Compose | Local infrastructure only (MongoDB, Redis, Mongo Express) |

### DevOps
| Tool | Purpose |
|------|---------|
| Docker Compose | Local infrastructure (the Node services are not containerized) |
| GitHub Actions | CI — typecheck services, build frontend, run tests (no lint or deploy step) |
| Railway *(planned)* | Deploy all backend services |
| Vercel *(planned)* | Deploy React frontend |
| MongoDB Atlas *(planned)* | Production DB |
| Upstash Redis *(planned)* | Serverless production Redis |

---

## 8. Microservices Breakdown

> The real services and default ports are: API Gateway `5000`, Auth `5001`, **Workspace `5002`** (a separate service; workspaces are not part of auth-service), Document `5003`, Task `5004`, AI `5006`. Chat and Notification services are not implemented. Endpoint lists marked *(design)* below are the original plan; the implemented endpoints are listed in each `services/*/README.md`.

### 8.1 API Gateway — Port 5000

The gateway is the **only** entry point. The React client never calls services directly.

**Middleware stack (as implemented):**
```
Request arrives
  → CORS, Helmet, Morgan logger
  → Per-IP rate limiter on POST /api/auth/login and /api/auth/register
  → /api/auth/* proxied without JWT check
  → Other routes: JWT verifier (Authorization: Bearer <accessToken>)
  → Per-user rate limiters (Redis-backed express-rate-limit; fail open if Redis is down)
  → HTTP proxy to the downstream service (the Authorization header is forwarded;
    each service verifies the JWT itself and checks workspace membership)
```
Request-ID tracing and injected user/role headers are not implemented.

**Route mapping:**
```
/api/auth/*        → Auth Service        :5001
/api/workspaces/*  → Workspace Service   :5002
/api/documents/*   → Document Service    :5003
/api/tasks/*       → Task Service        :5004
/api/ai/*          → AI Service          :5006
```

**Rate Limits (as implemented):**
| Endpoint | Limit | Window |
|---------|-------|--------|
| POST /api/auth/login | 5 failed requests | 15 minutes per IP |
| POST /api/auth/register | 3 requests | 1 hour per IP |
| POST /api/ai/query + POST /api/ai/search (shared) | 30 requests | 1 hour per user |
| POST /api/ai/summarize-meeting | 20 requests | 1 hour per user |
| All other authenticated endpoints | 100 requests | 1 minute per user |

---

### 8.2 Auth Service — Port 5001 (Workspace Service — Port 5002)

Handles identity and authentication. Workspaces live in the separate Workspace Service (`services/workspace-service`, port 5002).

**Endpoints (as implemented):**
```
POST  /api/auth/register                 Create account (name, email, password)
POST  /api/auth/login                    Login → { user, accessToken, refreshToken } in the JSON body
POST  /api/auth/refresh                  Rotate the token pair ({ refreshToken } in the body)
POST  /api/auth/logout                   Revoke the given refresh token (MongoDB)
GET   /api/auth/me                       Current user profile

POST  /api/workspaces                    Create workspace (Workspace Service)
GET   /api/workspaces                    List user's workspaces
POST  /api/workspaces/join               Join with an invite code (case-insensitive; 404 unknown, 409 already a member)
GET   /api/workspaces/:workspaceId               Workspace detail (members only)
GET   /api/workspaces/:workspaceId/members       Member list with names
GET   /api/workspaces/:workspaceId/membership    { isMember } for the caller (used by other services)
```
Roadmap / not yet implemented: `PUT /auth/me` (profile update), forgot/reset password, Google sign-in, email invites, member roles, removing members. Invite codes do not expire.

**JWT Auth Flow (as implemented):**
```
Login
  → verify password with bcrypt
  → issue accessToken (JWT, default 15 min, payload: { userId })
  → issue refreshToken (JWT, default 7 days, separate secret)
  → store SHA256(refreshToken) in MongoDB (RefreshToken collection) — not Redis
  → return both tokens in the JSON response body (no cookie);
    the client keeps them in localStorage

Every request
  → Gateway verifies the Bearer token's signature and expiry
  → Forwards the Authorization header unchanged; each service verifies it again
    and asks Workspace Service whether the caller is a member of the workspace
    (malformed id → 400, not a member → 403, check could not run → 503)

Token refresh
  → Client sends { refreshToken } in the request body
  → Server verifies the JWT, then atomically marks the stored hash as rotated
  → Issues a NEW accessToken + NEW refreshToken (rotation on every refresh)
  → Token already rotated within REFRESH_REUSE_GRACE_MS (default 10 s, e.g. a second tab):
    401, other sessions untouched
  → Token rotated earlier, revoked or unknown (reuse): delete all refresh tokens
    for the user → force re-login
```

---

### 8.3 Document Service — Port 5003

Core service. Manages file uploads, document storage, and triggers the embedding pipeline.

**Endpoints (as implemented):**
```
GET    /api/documents/workspace/:workspaceId   List all documents in workspace (with embedding status)
POST   /api/documents/upload                   Upload new document (multipart/form-data: file, workspaceId)
POST   /api/documents                          Create document metadata
GET    /api/documents/:id                      Get document metadata + content
DELETE /api/documents/:id                      Delete document: vectors first (503 if that fails), then file + record
POST   /api/documents/:id/reindex              Manually trigger re-embedding (resets the retry budget)
```
Roadmap / not yet implemented: separate `/content`, `/file` and `/status` endpoints.

**Document Upload Flow (as implemented):**
```javascript
// 1. Client uploads file via multipart form (one file, max 10 MB)
// 2. Multer saves to a temp directory; only .pdf / .docx extensions pass
// 3. Workspace membership is checked against Workspace Service
// 4. The file's bytes must match its extension (else 415); empty file → 422
// 5. Extract text based on file type (unreadable file → 422):
//    - PDF  → pdf-parse
//    - DOCX → mammoth
// 6. Upload original to Cloudinary (for viewing)
// 7. Save document record to MongoDB
//    { originalName, fileType, fileSize, cloudinaryUrl, extractedText, uploadedBy, embeddingStatus: "pending" }
// 8. Push an embedding job onto the Redis list researchmind:embedding:jobs (no pub/sub)
// 9. Return document record immediately (don't wait for embedding)
// 10. AI Service worker claims the job, embeds it and reports "indexed" or "failed" (with a reason);
//     up to 3 attempts, plus a 5-minute recovery sweep for stuck or lost jobs
```

**Supported File Types:**
- `.pdf` — Research papers, reports, presentations
- `.docx` — Word documents, reports
- `.md`, `.txt` — **not supported** (roadmap / not yet implemented); rejected with `415`

---

### 8.4 Chat Service — Roadmap / not yet implemented

> No chat service, WebSocket server or channel UI exists. Everything in this subsection is design.

Real-time team messaging with WebSocket.

**Endpoints:**
```
GET    /chat/workspace/:wid/channels          List channels
POST   /chat/workspace/:wid/channels          Create channel
GET    /chat/channels/:id/messages            Message history (cursor paginated)
DELETE /chat/messages/:id                     Soft delete message
POST   /chat/messages/:id/reactions           Add/remove emoji reaction
```

**WebSocket Events:**
```
channel:join          Join a channel room
channel:message       Send / receive message
channel:typing        Typing indicator
message:reaction      Reaction update
user:online           User came online
user:offline          User went offline
notification:new      Push notification to user room
```

**Cross-service events (publishes to Redis):**
```javascript
// When @mention detected in message
redis.publish("workspace:events", JSON.stringify({
  type: "user:mentioned",
  workspaceId, targetUserId, sourceUserId, channelId, messageId
}))
```

---

### 8.5 Task Service — Port 5004

Kanban task management. Tasks are created manually or in bulk from meeting-summary action items (there is no AI agent).

**Endpoints (as implemented, all under `/api/tasks/workspaces/:workspaceId`):**
```
POST   /boards                 Create board
GET    /boards                 List boards
GET    /boards/:id             Board detail
PATCH  /boards/:id             Update board
DELETE /boards/:id             Delete board
POST   /tasks                  Create task
POST   /tasks/bulk             Bulk create tasks (max 50, all-or-nothing, idempotent with optional importKey)
GET    /tasks                  List tasks
GET    /tasks/:id              Task detail
GET    /tasks/:id/activities   Activity log
PATCH  /tasks/:id              Update task (including status changes from drag and drop)
DELETE /tasks/:id              Delete task
```
Roadmap / not yet implemented: summary stats and overdue endpoints.

**Task Schema Fields (as implemented):**
- title, description, status (todo / in_progress / done)
- priority (low / medium / high)
- boardId, assigneeId (must be the user id of a workspace member, else `400`), dueDate
- parentTaskId (subtasks)
- createdBy (user id), activity log
- Roadmap: review status, urgent priority, estimatedHours, linkedDocId, tags

---

### 8.6 AI Service — Port 5006

The intelligence layer. All AI features are handled here. The LLM is Groq or xAI through the OpenAI SDK.

**Endpoints (as implemented):**
```
POST  /api/ai/query                             RAG Q&A, streamed via SSE
POST  /api/ai/search                            Raw retrieval results (not streamed)
GET   /api/ai/sessions/workspace/:workspaceId   Past Q&A sessions
POST  /api/ai/summarize-meeting                 Meeting notes → structured JSON summary (not streamed)
DELETE /internal/vectors/workspaces/:workspaceId/documents/:documentId   Internal (X-Internal-Token)
```
The embedding worker runs inside this service's process (a standalone worker is optional: `npm run dev:worker`).

**Roadmap / not yet implemented:** `/ai/agent`, `/ai/generate-review`, `/ai/draft-section`, `/ai/explain-document`, `/ai/suggest-tasks`, `/ai/onboard`, `/ai/embed`. Only `/api/ai/query` streams.

---

### 8.7 Notification Service — Roadmap / not yet implemented

> `services/notification-service` is an empty placeholder: no routes, no port, no Redis subscriber, no email. The application sends no notifications. Everything below is design.

Event-driven. Never called directly — reacts to Redis events.

**Endpoints:**
```
GET  /notif/                        List notifications (paginated)
PUT  /notif/:id/read                Mark as read
PUT  /notif/read-all                Mark all as read
GET  /notif/count                   Unread count
PUT  /notif/preferences             Update preferences
```

**Subscribed Redis events:**
```
user:mentioned       → notify + email
task:assigned        → notify + email
doc:indexed          → notify (document ready for search)
workspace:invited    → invite email
task:overdue         → daily digest email
```

---

## 9. RAG Pipeline — Deep Dive

### 9.1 Indexing Pipeline (Document Upload)

```
┌──────────────────────────────────────────────────────┐
│                  INDEXING PIPELINE                   │
│                                                      │
│  PDF/DOCX uploaded (MD planned)                      │
│       ↓                                              │
│  Text Extraction                                     │
│    PDF  → pdf-parse (preserves layout)               │
│    DOCX → mammoth (clean text, no styling)           │
│    MD   → remark  (planned, not implemented)         │
│       ↓                                              │
│  Preprocessing                                       │
│    - Remove "-- N of M --" page markers              │
│    - Normalize whitespace and line breaks            │
│       ↓                                              │
│  Chunking  (size=400, overlap=60 estimated tokens)   │
│    - LangChain RecursiveCharacterTextSplitter        │
│    - Prefers paragraph, line, then sentence breaks   │
│    - Overlapping window preserves cross-boundary ctx │
│       ↓                                              │
│  Embedding  (Voyage AI, VOYAGE_MODEL, default        │
│              voyage-3)                               │
│    - Batch chunks in groups of 8, retried on error   │
│    - Each chunk → 1024-dimension float vector        │
│       ↓                                              │
│  Pinecone Upsert                                     │
│    - namespace = workspaceId (team isolation)        │
│    - id = `{docId}-chunk-{index}`                    │
│    - values = embedding vector                       │
│    - metadata = { documentId, workspaceId,           │
│                   uploadedBy, chunkIndex, text,      │
│                   fileType, embeddingModel }         │
│       ↓                                              │
│  Document Service status: "indexed" (or "failed")    │
└──────────────────────────────────────────────────────┘
```

### 9.2 Query Pipeline (Semantic Search)

```
┌──────────────────────────────────────────────────────┐
│                   QUERY PIPELINE                     │
│                                                      │
│  User: "Which papers discuss BERT for NLP tasks?"    │
│       ↓                                              │
│  Embed the query (same model as indexing)            │
│       ↓                                              │
│  Pinecone query                                      │
│    topK = 5 by default (1–10)                        │
│    namespace = workspaceId                           │
│    (no metadata filter yet)                          │
│       ↓                                              │
│  Retrieved chunks (ranked by cosine similarity)      │
│    [chunk from paper A, score: 0.91]                 │
│    [chunk from paper B, score: 0.87]                 │
│    [chunk from meeting notes, score: 0.72]           │
│    ...                                               │
│       ↓                                              │
│  Build Prompt                                        │
│    System: project context + instruction             │
│    Context: retrieved chunks with source labels      │
│    User: original question                           │
│       ↓                                              │
│  Groq / xAI via OpenAI SDK (streaming)               │
│       ↓                                              │
│  Stream answer token by token via SSE                │
│    + sources: [{ documentId, chunkIndex, score,      │
│                  fileType }]                         │
└──────────────────────────────────────────────────────┘
```

### 9.3 Chunking Algorithm

> Design sketch. The implementation (`services/ai-service/src/services/chunking.service.ts`) uses LangChain's `RecursiveCharacterTextSplitter` with `chunkSize = 400` and `chunkOverlap = 60`, measured in estimated tokens (~4 characters per token).

```javascript
function chunkDocument(text, options = {}) {
  const { maxTokens = 400, overlapTokens = 60 } = options;

  // Split by paragraph first (respect natural boundaries)
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let currentChunk = [];
  let currentTokenCount = 0;

  for (const para of paragraphs) {
    const paraTokens = estimateTokens(para); // ~4 chars per token

    if (currentTokenCount + paraTokens > maxTokens && currentChunk.length > 0) {
      // Save current chunk
      chunks.push(currentChunk.join('\n\n'));

      // Start new chunk with overlap (last N tokens of previous chunk)
      const overlapText = getLastNTokens(currentChunk.join('\n\n'), overlapTokens);
      currentChunk = [overlapText, para];
      currentTokenCount = overlapTokens + paraTokens;
    } else {
      currentChunk.push(para);
      currentTokenCount += paraTokens;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join('\n\n'));
  }

  return chunks;
}
```

### 9.4 Namespace Isolation (Multi-tenancy)

Each project workspace gets its own Pinecone namespace. This is critical:

```javascript
// Upsert — always scope to workspaceId
await pinecone.index(INDEX_NAME).namespace(workspaceId).upsert(vectors);

// Query — always scope to workspaceId
await pinecone.index(INDEX_NAME).namespace(workspaceId).query({ vector, topK });

// Delete all vectors for a document (as implemented)
await pineconeIndex.namespace(workspaceId).deleteMany({
  documentId: { "$eq": documentId }
});

// Delete entire workspace (planned: workspace deletion is not implemented)
await pinecone.index(INDEX_NAME).namespace(workspaceId).deleteAll();
```

### 9.5 Vector Lifecycle

| Event | Pinecone Action |
|-------|----------------|
| Document uploaded + processed | Upsert all chunks (ids `{documentId}-chunk-{index}`, so a retry overwrites) |
| Document re-uploaded / edited | Not supported (roadmap) |
| Document deleted | Delete all chunks with `documentId` filter first; if that fails the deletion is rolled back (`503`) |
| Workspace deleted | Not supported (roadmap) |
| Manual reindex triggered | Re-queue → re-chunk → re-embed → upsert |

---

## 10. AI Agent System — Deep Dive

> **Roadmap / not yet implemented.** There is no agent endpoint, tool executor or agent UI. The code samples below are design sketches; they reference the Anthropic SDK, which this project does not use (the LLM is Groq/xAI through the OpenAI SDK).

### 10.1 What the Agent Can Do

The agent handles complex multi-step instructions that no single API call can fulfill.

**Example instructions the agent handles:**
```
"Summarize today's meeting notes and create tasks for each action item, assign them to the relevant team member"

"Generate a literature review from all uploaded research papers"

"Find all papers about neural networks and list their key contributions"

"What tasks are overdue? Send a summary to the #general channel"

"Draft the Introduction section of our project report using our research notes"
```

### 10.2 Agent Tools

```javascript
const agentTools = [
  {
    name: "search_knowledge_base",
    description: "Semantically search all project documents for relevant information",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query" },
        filter_type: {
          type: "string",
          enum: ["all", "pdf", "docx", "meeting_notes", "report"],
          description: "Filter by document type"
        },
        top_k: { type: "number", default: 5 }
      },
      required: ["query"]
    }
  },
  {
    name: "read_document",
    description: "Read the full extracted text content of a specific document",
    input_schema: {
      type: "object",
      properties: {
        doc_id: { type: "string" },
        doc_title: { type: "string", description: "Use if you know the title but not ID" }
      }
    }
  },
  {
    name: "list_documents",
    description: "List all documents in the workspace with their titles and types",
    input_schema: {
      type: "object",
      properties: {
        type_filter: { type: "string", enum: ["all", "pdf", "meeting_notes", "report"] }
      }
    }
  },
  {
    name: "create_task",
    description: "Create a new task in the project task board",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        assignee_name: { type: "string" },
        due_date: { type: "string", description: "ISO date string" },
        priority: { type: "string", enum: ["low", "medium", "high", "urgent"] }
      },
      required: ["title"]
    }
  },
  {
    name: "create_document",
    description: "Create a new text document in the workspace",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        content: { type: "string", description: "Full document content in markdown" },
        type: { type: "string", enum: ["meeting_summary", "literature_review", "report_section", "note"] }
      },
      required: ["title", "content"]
    }
  },
  {
    name: "list_tasks",
    description: "List tasks with optional filters",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["todo", "in_progress", "review", "done"] },
        assignee_name: { type: "string" },
        overdue_only: { type: "boolean" }
      }
    }
  },
  {
    name: "get_team_members",
    description: "Get list of team members and their roles",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "post_channel_message",
    description: "Post a message to a project channel",
    input_schema: {
      type: "object",
      properties: {
        channel_name: { type: "string" },
        message: { type: "string" }
      },
      required: ["channel_name", "message"]
    }
  }
];
```

### 10.3 Agent Execution Loop (ReAct)

```javascript
async function runAgent(instruction, workspaceContext, onStep) {
  const messages = [{ role: "user", content: instruction }];
  const steps = [];

  while (true) {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: buildAgentSystemPrompt(workspaceContext),
      tools: agentTools,
      messages
    });

    // Agent finished reasoning
    if (response.stop_reason === "end_turn") {
      const finalAnswer = response.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("");

      return { answer: finalAnswer, steps };
    }

    // Agent wants to use a tool
    if (response.stop_reason === "tool_use") {
      const toolUseBlock = response.content.find(b => b.type === "tool_use");

      // Stream step to client so user sees progress
      onStep({ tool: toolUseBlock.name, input: toolUseBlock.input });

      // Execute the tool
      const toolResult = await executeAgentTool(
        toolUseBlock.name,
        toolUseBlock.input,
        workspaceContext
      );

      steps.push({
        tool: toolUseBlock.name,
        input: toolUseBlock.input,
        result: toolResult
      });

      // Add result back to conversation
      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          content: JSON.stringify(toolResult)
        }]
      });
    }
  }
}
```

### 10.4 Agent System Prompt

```javascript
function buildAgentSystemPrompt(ctx) {
  return `
You are an intelligent AI assistant for an engineering student project team.

PROJECT CONTEXT:
- Project Name: ${ctx.projectName}
- Domain: ${ctx.domain}
- Description: ${ctx.description}
- Team Members: ${ctx.members.map(m => `${m.name} (${m.role})`).join(', ')}
- Today's Date: ${new Date().toDateString()}

YOUR ROLE:
You help the team manage their project knowledge, tasks, and documentation.
You have access to tools to search documents, create tasks, post messages, and draft content.

BEHAVIOR RULES:
1. Always use tools to get real data before answering. Never assume or hallucinate.
2. When creating tasks from meeting notes, infer the assignee from context (who was mentioned in relation to that action).
3. When drafting documents, ground every claim in retrieved document content.
4. Be transparent — explain each step you take.
5. If you cannot complete a step, explain why and continue with what you can do.
6. Prioritize accuracy over speed. It is better to take more steps and be correct.
  `.trim();
}
```

---

## 11. All AI Features

### 11.1 Semantic Q&A (RAG Search) — Implemented

**Endpoint:** `POST /api/ai/query` (streamed). `POST /api/ai/search` takes the same `workspaceId` / `query` / `topK` fields and returns the raw retrieval results as JSON, without an answer.

**Request:**
```json
{
  "workspaceId": "<24-hex workspace id>",
  "query": "Which papers propose using attention mechanisms for our problem?",
  "topK": 5
}
```
`query` is trimmed and must be 1–2000 characters; `topK` is optional, 1–10 (default 5); an optional `sessionId` may be sent. Metadata filters are not supported yet.

**Response (`text/event-stream`, one event per step):**
```
event: start    data: { "query": "..." }
event: sources  data: { "sources": [ { "documentId": "...", "chunkIndex": 3, "score": 0.87, "fileType": "pdf" } ] }
event: token    data: { "text": "Based on" }        (repeated)
event: done     data: { "sessionId": "...", "unverifiedCitations": [...] }
event: error    data: { "message": "...", "partial": true|false }   (instead of done, if generation fails)
```
Past sessions: `GET /api/ai/sessions/workspace/:workspaceId`.

---

### 11.2 Meeting Notes Summarizer

**Endpoint:** `POST /api/ai/summarize-meeting` — Implemented

**Input:** `{ workspaceId, text }`. The text is pasted meeting notes, 10–50000 characters; selecting a document is not supported.

**Output (structured JSON, returned in the response; not streamed and not saved as a document):**
```json
{
  "meeting_date": "2024-11-15",
  "attendees": ["Arjun", "Priya", "Karthik"],
  "summary": "Team reviewed two candidate models...",
  "decisions": [
    "Decided to use LSTM over GRU due to better performance on validation set"
  ],
  "action_items": [
    { "task": "Run final benchmark comparison", "assignee": "Arjun", "due": "2024-11-20" },
    { "task": "Update methodology section in report", "assignee": "Priya", "due": "2024-11-22" }
  ],
  "open_questions": [
    "Should we include the ablation study in the final submission?"
  ],
  "next_meeting": "2024-11-22"
}
```

The frontend displays this as a formatted summary and offers task creation from selected action items (`POST /api/tasks/workspaces/:workspaceId/tasks/bulk` with an `importKey`, so repeating the same import does not duplicate tasks).

---

### 11.3 Literature Review Generator — Roadmap / not yet implemented

**Endpoint (planned):** `POST /ai/generate-review`

**How it works:**
```
1. Fetch all PDF documents in workspace
2. For each paper — RAG query: extract title, authors, methodology, findings, limitations
3. Group papers by theme (using clustering prompt)
4. For each theme — synthesize a paragraph comparing approaches
5. Generate: Introduction → Thematic sections → Gap Analysis → Conclusion
6. Each claim includes inline citation [Doc Name]
7. Save as a new document in workspace
```

**Output structure:**
```markdown
# Literature Review — [Project Name]

## 1. Introduction
[Overview of the research domain and scope of review]

## 2. [Theme 1: e.g., Deep Learning Approaches]
[Synthesized comparison of papers on this theme, with citations]

## 3. [Theme 2: e.g., Traditional ML Baselines]
[...]

## 4. Research Gaps
[What the reviewed papers don't address — where your project fits]

## 5. Conclusion
[Summary of state of the art and positioning of your work]

## References
[Automatically generated from uploaded paper metadata]
```

---

### 11.4 Project Report Section Drafter — Roadmap / not yet implemented

**Endpoint (planned):** `POST /ai/draft-section`

**Request:**
```json
{
  "section": "methodology",
  "instructions": "Focus on the data preprocessing pipeline and model architecture we chose"
}
```

Agent searches the knowledge base for relevant notes, decisions, and technical details, then drafts the section grounded in real project content.

---

### 11.5 New Member Onboarding — Roadmap / not yet implemented

**Endpoint (planned):** `POST /ai/onboard`

When a new team member joins:
- AI searches all documents for: project overview, current status, key decisions
- Generates an onboarding brief: what the project is, what has been done, what's in progress, key papers to read, open questions
- Delivered as a formatted document the new member sees on first login

---

### 11.6 Streaming Implementation

> **Design sketch.** Only `POST /api/ai/query` streams today. The real server (`services/ai-service/src/controllers/query.controller.ts`, `services/rag.service.ts`) uses the OpenAI SDK against Groq/xAI and writes named events (`event: start|sources|token|done|error`), not the `data:`-only format shown here. The real client is `frontend/src/api/ai.api.ts` + `frontend/src/utils/sse.ts`.

All writing AI features stream token-by-token via Server-Sent Events:

```javascript
// Server — Express SSE handler
async function streamAIResponse(req, res, promptBuilder) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      system: promptBuilder.system,
      messages: promptBuilder.messages
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ token: event.delta.text })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
}
```

```javascript
// Client — React hook for streaming
function useAIStream() {
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  const stream = async (endpoint, payload) => {
    setOutput('');
    setLoading(true);

    const response = await fetch(`/api${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAccessToken()}`
      },
      body: JSON.stringify(payload)
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const lines = decoder.decode(value).split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          if (data.token) setOutput(prev => prev + data.token);
          if (data.done) setLoading(false);
        }
      }
    }
  };

  return { output, loading, stream };
}
```

---

## 12. Database Design

> **Design vs. implementation.** The schemas below are the original design. What exists today (each service has its own database, named by its connection string):
> - `users` (name, email, hashed password, avatar) and `refreshtokens` (userId, SHA-256 token hash, expiresAt, rotatedAt) — auth-service.
> - `workspaces` (name, description, ownerId, `inviteCode`, `members` as a plain array of user ids; no roles, slug, domain or invite tokens) — workspace-service.
> - `documents` (workspaceId, uploadedBy, originalName, fileType `pdf|docx`, fileSize, cloudinaryUrl, cloudinaryPublicId, extractedText, `embeddingStatus` `pending|indexing|indexed|failed`, embeddingAttempts, embeddingError, indexingStartedAt, deletedAt) — document-service.
> - `boards` (workspaceId, name), `tasks` (status `todo|in_progress|done`, priority `low|medium|high`, assigneeId, dueDate, parentTaskId, createdBy, importKey/importIndex) and `taskactivities` — task-service.
> - `aisessions` (workspaceId, userId, query, answer, sources, aiModel) — ai-service.
> - `channels`, `messages` and `notifications` do not exist (roadmap).

### MongoDB Collections

#### `users`
```json
{
  "_id": "ObjectId",
  "name": "string",
  "email": "string (unique, indexed)",
  "passwordHash": "string",
  "avatar": "string (url)",
  "createdAt": "Date"
}
```

#### `workspaces`
```json
{
  "_id": "ObjectId",
  "name": "string",
  "description": "string",
  "domain": "string (e.g. Machine Learning, IoT, Web Dev)",
  "slug": "string (unique)",
  "ownerId": "ObjectId → users",
  "members": [
    {
      "userId": "ObjectId",
      "role": "lead|member|advisor",
      "joinedAt": "Date"
    }
  ],
  "inviteTokens": [
    { "token": "string", "email": "string", "expiresAt": "Date" }
  ],
  "createdAt": "Date"
}
```

#### `documents`
```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId → workspaces",
  "title": "string",
  "type": "pdf|docx|md|txt|meeting_summary|literature_review|report_section|note",
  "originalFileName": "string",
  "cloudinaryUrl": "string",
  "extractedText": "string",
  "wordCount": "number",
  "embeddingStatus": "pending|processing|indexed|failed",
  "chunkCount": "number",
  "uploadedBy": "ObjectId → users",
  "tags": ["string"],
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

#### `channels`
```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId",
  "name": "string",
  "description": "string",
  "memberIds": ["ObjectId → users"],
  "createdBy": "ObjectId",
  "createdAt": "Date"
}
```

#### `messages`
```json
{
  "_id": "ObjectId",
  "channelId": "ObjectId → channels",
  "senderId": "ObjectId → users",
  "content": "string",
  "attachments": [{ "url": "string", "name": "string", "type": "string" }],
  "reactions": [{ "emoji": "string", "userIds": ["ObjectId"] }],
  "threadParentId": "ObjectId (nullable)",
  "createdAt": "Date",
  "deletedAt": "Date (soft delete)"
}
```

#### `boards`
```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId",
  "name": "string",
  "columns": ["Todo", "In Progress", "Review", "Done"],
  "createdBy": "ObjectId",
  "createdAt": "Date"
}
```

#### `tasks`
```json
{
  "_id": "ObjectId",
  "boardId": "ObjectId → boards",
  "workspaceId": "ObjectId",
  "title": "string",
  "description": "string",
  "status": "todo|in_progress|review|done",
  "priority": "low|medium|high|urgent",
  "assigneeId": "ObjectId → users (nullable)",
  "dueDate": "Date (nullable)",
  "estimatedHours": "number",
  "position": "number",
  "subtasks": [{ "title": "string", "completed": "boolean" }],
  "linkedDocId": "ObjectId → documents (nullable)",
  "tags": ["string"],
  "createdBy": "ObjectId|'AI Agent'",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

#### `task_activity`
```json
{
  "_id": "ObjectId",
  "taskId": "ObjectId",
  "userId": "ObjectId|'AI Agent'",
  "action": "created|status_changed|assigned|due_date_set|priority_changed|comment",
  "payload": "object",
  "createdAt": "Date"
}
```

#### `notifications`
```json
{
  "_id": "ObjectId",
  "userId": "ObjectId",
  "workspaceId": "ObjectId",
  "type": "mention|task_assigned|doc_indexed|workspace_invited|task_overdue",
  "title": "string",
  "body": "string",
  "link": "string",
  "read": "boolean",
  "createdAt": "Date"
}
```

#### `ai_sessions`
```json
{
  "_id": "ObjectId",
  "workspaceId": "ObjectId",
  "userId": "ObjectId",
  "type": "search|agent|meeting_summary|literature_review|draft",
  "input": "string",
  "output": "string",
  "steps": "array (agent steps)",
  "tokensUsed": "number",
  "durationMs": "number",
  "createdAt": "Date"
}
```

### Redis Key Design

> **As implemented**, Redis holds only the gateway rate-limit counters (`rl:<limiter>:<key>`, via `rate-limit-redis`) and the embedding job list `researchmind:embedding:jobs`. Refresh tokens are in MongoDB, not Redis. The auth, caching, presence and notification keys below are design only.

```
# Auth
refresh:{userId}                     SHA256 of refresh token, TTL = 7d
reset:{token}                        userId, TTL = 1h

# Rate limiting
rl:{userId}:{windowKey}              Request count, TTL = window size

# Caching
cache:workspace:{id}:members         JSON array, TTL = 10min
cache:doc:{id}:text                  Extracted text, TTL = 30min
cache:ai:search:{hash}               Cached search result, TTL = 1h

# Presence
presence:{userId}                    "online", TTL = 30s (heartbeat)
ws:online:{workspaceId}              Set of online userIds

# Notifications
notif:unread:{userId}                Integer, unread count

# Embedding queue
embed:queue                          Redis list — docId pushed by Doc Service, popped by worker
```

### MongoDB Indexes

> Design. The implemented indexes are declared in each service's Mongoose models (`services/*/src/models`).

```javascript
db.users.createIndex({ email: 1 }, { unique: true });

db.documents.createIndex({ workspaceId: 1, createdAt: -1 });
db.documents.createIndex({ workspaceId: 1, type: 1 });
db.documents.createIndex({ embeddingStatus: 1 });   // for worker to find pending

db.messages.createIndex({ channelId: 1, createdAt: -1 });

db.tasks.createIndex({ boardId: 1, status: 1, position: 1 });
db.tasks.createIndex({ workspaceId: 1, assigneeId: 1, dueDate: 1 });
db.tasks.createIndex({ workspaceId: 1, dueDate: 1, status: 1 });  // overdue query

db.notifications.createIndex({ userId: 1, read: 1, createdAt: -1 });

db.ai_sessions.createIndex({ workspaceId: 1, type: 1, createdAt: -1 });
```

---

## 13. API Reference

### Standard Response Envelope

> **As implemented:** success responses are `{ "success": true, "data": ... }` (some also include `message`); errors are `{ "success": false, "message": "..." }` (zod validation failures also include `errors: [...]`). There are no `error.code` strings or `meta` pagination yet. The envelope below is the design.

**Success:**
```json
{
  "success": true,
  "data": { },
  "meta": { "page": 1, "limit": 20, "total": 84 }
}
```

**Error:**
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "File type not supported. Allowed: pdf, docx, md, txt",
    "field": "file"
  }
}
```

### Error Codes

| Code | HTTP | When |
|------|------|------|
| `UNAUTHORIZED` | 401 | Missing or expired token |
| `FORBIDDEN` | 403 | Token valid but not a member of the workspace |
| `NOT_FOUND` | 404 | Resource does not exist (also: unknown invite code) |
| `VALIDATION_ERROR` | 400 | Invalid request body or params (zod), malformed workspace id, assignee not a workspace member |
| `CONFLICT` | 409 | Already a member of the workspace; document is being indexed |
| `UNSUPPORTED_FILE` | 415 | Upload is not PDF/DOCX, or its bytes do not match its extension |
| `UNPROCESSABLE_FILE` | 422 | Uploaded file is empty or its text cannot be read |
| `RATE_LIMITED` | 429 | Too many requests |
| `BAD_GATEWAY` | 502 | AI provider error or timeout (non-streaming endpoints), Cloudinary unavailable on upload |
| `SERVICE_UNAVAILABLE` | 503 | Membership check could not run, vector cleanup failed on delete, indexing queue unavailable, downstream service unreachable |
| `FILE_TOO_LARGE` | 413 | Upload exceeds the 10 MB limit |

The `Code` column is descriptive only; responses carry the HTTP status and a `message`.

---

## 14. Real-Time & System Design Concepts

### 14.1 API Gateway Pattern
Single entry point for the client. The gateway verifies the JWT and applies rate limits, but services do **not** trust injected headers: each service verifies the forwarded bearer token itself, and every workspace-scoped service asks workspace-service whether the caller is a member (malformed id → `400`, not a member → `403`, check could not run → `503`). In local development the services also listen on their own ports, so they are not network-isolated.

### 14.2 Redis Sliding Window Rate Limiter

> **As implemented:** the gateway uses `express-rate-limit` with a Redis store (`rate-limit-redis`, fixed windows per limiter). If Redis is unreachable the limiters fail open. The function below is a design sketch.

```javascript
async function slidingWindowRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const windowKey = `rl:${key}:${Math.floor(now / windowMs)}`;
  const pipeline = redis.pipeline();
  pipeline.incr(windowKey);
  pipeline.expire(windowKey, Math.ceil(windowMs / 1000) + 1);
  const [[, count]] = await pipeline.exec();
  return count > limit;
}
```

### 14.3 JWT Refresh Token Rotation
Stateless access token (default 15 min) + stateful refresh token (default 7 days). The refresh token travels in the JSON request body and is stored only as a SHA-256 hash in MongoDB (not Redis); the client keeps tokens in `localStorage`. On every refresh the presented token is atomically marked as rotated and a new pair is issued. Presenting a token that was already rotated revokes all of the user's sessions (reuse detection), except within `REFRESH_REUSE_GRACE_MS` (default 10 s), where a concurrent refresh is rejected without revoking anything.

### 14.4 Redis Pub/Sub Event Bus — Roadmap / not yet implemented

> No pub/sub exists. Services call each other over HTTP (membership checks, internal routes with `X-Internal-Token`). The only Redis-based hand-off is the embedding job list `researchmind:embedding:jobs` (document-service → ai-service worker).

Services communicate through events, not direct HTTP calls. This decouples them:

```
Chat Service    → publishes  → "workspace:events" channel
Task Service    → publishes  → "workspace:events" channel
Doc Service     → publishes  → "embed:queue" list (embedding worker)
Notif Service   → subscribes → "workspace:events" channel
Embed Worker    → consumes   → "embed:queue" list
```

### 14.5 WebSocket Rooms (Socket.io) — Roadmap / not yet implemented

```javascript
// User joins their personal room on connect
socket.join(`user:${userId}`)

// User joins workspace room
socket.join(`workspace:${workspaceId}`)

// User joins channel room on open
socket.join(`channel:${channelId}`)
```

Socket.io Redis Adapter ensures rooms work across multiple Node.js processes (horizontal scaling).

### 14.6 Background Embedding Worker

> **As implemented:** the worker runs inside the AI Service process (optionally also as a standalone process via `npm run dev:worker`). It pops jobs from `researchmind:embedding:jobs` and claims each document from document-service before processing, so duplicate deliveries are skipped. It then reports `indexed` or `failed` (with a reason). There is no dead-letter list: a document is retried up to 3 attempts, and a 5-minute recovery sweep in document-service re-queues stuck or lost jobs. The loop below is a design sketch.

The embedding pipeline runs off the HTTP request path, so uploads are not blocked:

```javascript
// Worker process — continuously polls Redis queue
async function embeddingWorker() {
  console.log('Embedding worker started');
  while (true) {
    const docId = await redis.brpop('embed:queue', 0); // blocking pop — waits until item
    if (docId) {
      try {
        await processDocumentEmbedding(docId);
      } catch (err) {
        await redis.lpush('embed:failed', docId); // dead letter queue
        logger.error('Embedding failed', { docId, err });
      }
    }
  }
}
```

### 14.7 Caching Strategy — Roadmap / not yet implemented

| Data | Cache | TTL | Invalidate on |
|------|-------|-----|---------------|
| Workspace members | Redis | 10 min | Member added/removed |
| Document extracted text | Redis | 30 min | Document re-uploaded |
| AI search results | Redis | 1 hour | New document indexed |
| Unread notif count | Redis counter | — | New notif / read-all |

### 14.8 Multi-tenancy via Pinecone Namespaces
Each workspace has its own Pinecone namespace. Vectors from one team are completely invisible to another. Namespace isolation at the query layer means no cross-team data leakage.

---

## 15. Frontend Modules

### Page Routes

> **As implemented** (`frontend/src/routes/AppRouter.tsx`): `/login`, `/register`, `/create-workspace`, `/dashboard` (overview), `/dashboard/documents`, `/dashboard/ai-researcher` (AI Q&A, also `/app/workspace/:id/search`), `/dashboard/meeting-notes`, `/dashboard/tasks` (Kanban). `/dashboard/sources`, `/dashboard/analytics`, `/dashboard/literature-review`, `/dashboard/report-drafter` and `/dashboard/settings` are placeholder pages. Agent, chat, progress dashboard and account settings pages do not exist. The list below is the original design.

```
/                               Landing + login
/register                       Register
/app                            Dashboard (workspace list)
/app/workspace/:id              Workspace home
/app/workspace/:id/documents    Document library (all uploads)
/app/workspace/:id/upload       Upload new document
/app/workspace/:id/search       AI semantic search page
/app/workspace/:id/agent        AI agent command page
/app/workspace/:id/review       Literature review generator
/app/workspace/:id/meeting      Meeting notes summarizer
/app/workspace/:id/channels/:id Chat channel
/app/workspace/:id/tasks        Kanban task board
/app/workspace/:id/dashboard    Progress dashboard
/app/workspace/:id/settings     Workspace settings
/app/settings                   User account settings
```

### Core Components

> Design. Implemented components live in `frontend/src/components/{auth,dashboard,documents,kanban,layout,ui,workspace}`. Agent, literature review, chat and progress dashboard components do not exist.

```
<AppShell>
  <Sidebar>
    <WorkspaceSwitcher />
    <NavSection title="Knowledge">
      <NavLink to="documents" />         ← All uploaded files
      <NavLink to="search" />            ← AI Q&A
      <NavLink to="agent" />             ← AI Agent
    </NavSection>
    <NavSection title="Generate">
      <NavLink to="review" />            ← Literature Review
      <NavLink to="meeting" />           ← Meeting Summarizer
    </NavSection>
    <NavSection title="Team">
      <ChannelList />
      <NavLink to="tasks" />
      <NavLink to="dashboard" />
    </NavSection>
    <UserMenu />
  </Sidebar>

  <MainArea>
    <!-- Documents Page -->
    <DocumentLibrary>
      <UploadDropzone />               ← drag-and-drop file upload
      <DocumentGrid>
        <DocumentCard>
          <EmbeddingStatusBadge />     ← pending / indexing / indexed
          <FileTypeIcon />
          <AskAboutThisButton />       ← opens AI search pre-filled
        </DocumentCard>
      </DocumentGrid>
    </DocumentLibrary>

    <!-- AI Search Page -->
    <SemanticSearchPage>
      <SearchInput />                  ← natural language question
      <FilterBar />                    ← filter by doc type
      <SearchResultCard>
        <AIAnswer />                   ← streamed response
        <SourceList>
          <SourceChip />               ← doc name + open file link
        </SourceList>
      </SearchResultCard>
      <SearchHistory />
    </SemanticSearchPage>

    <!-- Agent Page -->
    <AgentPage>
      <AgentInput />                   ← natural language instruction
      <AgentStepFeed>
        <AgentStep tool="search_knowledge_base" />
        <AgentStep tool="create_task" />
        ...
      </AgentStepFeed>
      <AgentFinalAnswer />
    </AgentPage>

    <!-- Literature Review Page -->
    <LiteratureReviewPage>
      <PaperChecklist />               ← select which papers to include
      <GenerateButton />
      <ReviewPreview>                  ← streaming markdown output
        <ExportToPDFButton />
        <SaveToDocsButton />
      </ReviewPreview>
    </LiteratureReviewPage>

    <!-- Meeting Summarizer -->
    <MeetingSummarizerPage>
      <NotesInput />                   ← paste raw notes or select doc
      <SummarizeButton />
      <SummaryOutput>
        <DecisionsList />
        <ActionItemsList>
          <CreateTasksFromActionsButton />
        </ActionItemsList>
        <OpenQuestionsList />
      </SummaryOutput>
    </MeetingSummarizerPage>

    <!-- Chat -->
    <ChatChannel>
      <MessageList />
      <TypingIndicator />
      <MessageInput />
    </ChatChannel>

    <!-- Tasks -->
    <KanbanBoard>
      <TaskColumn status="todo" />
      <TaskColumn status="in_progress" />
      <TaskColumn status="review" />
      <TaskColumn status="done" />
      <TaskDetailModal />
    </KanbanBoard>

    <!-- Dashboard -->
    <ProgressDashboard>
      <TasksCompletedChart />          ← Recharts bar chart
      <DocumentsIndexedCount />
      <AIUsageStats />
      <OverdueTasksAlert />
      <RecentActivityFeed />
    </ProgressDashboard>
  </MainArea>
</AppShell>
```

### Zustand Stores

> **As implemented:** only `useAuthStore` (`store/auth.store.ts`, user + tokens, persisted to `localStorage`) and `useWorkspaceStore` (`store/workspace.store.ts`). Server data (documents, tasks, sessions) is fetched with TanStack React Query. The other stores below are design only.

```javascript
useAuthStore         // currentUser, tokens, login(), logout()
useWorkspaceStore    // workspaces[], currentWorkspace, members
useDocumentStore     // documents[], embeddingStatus map, upload()
useChatStore         // channels[], messages by channelId, typing
useTaskStore         // boards[], tasks by boardId, drag-drop handler
useNotifStore        // notifications[], unreadCount
useAIStore           // searchResults, agentSteps, streamingOutput
useUIStore           // sidebarOpen, activeModal, theme
```

---

## 16. Phase-by-Phase Build Plan

> Status labels reflect what exists in the code; a checked item means the code for it is present. It does not mean the item was formally verified. Automated tests live in `tests/` (`npm test`).

### 🟦 Phase 1 — Foundation (Week 1–2) — [STATUS: implemented]
**Goal:** All services boot. Auth works end to end.

- [x] Set up monorepo folder structure
- [x] Initialize services (Express + TypeScript; Winston only in document-service)
- [x] Docker Compose: MongoDB + Redis
- [x] Auth Service: register, login, JWT, refresh, logout
- [x] Workspaces: create, list, join by invite code (separate workspace-service; no update/delete, email invites or roles)
- [x] API Gateway: routing + JWT middleware + rate limiting
- [x] React app (Vite + Tailwind CSS + Lucide Icons)
- [x] Login, Register, Workspace onboarding pages
- [x] Axios instance with auto token refresh interceptor
- [x] Protected routes

✅ **Checkpoint:** Register → create workspace → see dashboard.

---

### 🟦 Phase 2 — Document Ingestion (Week 3) — [STATUS: implemented for PDF and DOCX]
**Goal:** Upload documents, extract text, view them in-app.

- [x] Doc Service: upload endpoint with Multer (`POST /api/documents/upload`)
- [x] PDF text extraction (`pdf-parse`)
- [x] DOCX text extraction (`mammoth`)
- [x] Store file on Cloudinary (`image` asset type for PDFs, `raw` for DOCX)
- [x] Document library page (grid view with file type icons, search, filters)
- [x] In-app PDF viewer (`react-pdf` in-app modal with page controls & zoom)
- [x] Embedding status badge (`pending` / `indexing` / `indexed` / `failed`)
- [x] Redis queue for embedding jobs (producer side `researchmind:embedding:jobs`)

✅ **Checkpoint:** Upload a PDF, see it in document library, text extracted and stored.

---

### 🟦 Phase 3 — RAG Pipeline (Week 4) — [STATUS: implemented]
**Goal:** AI can answer questions from uploaded documents.

- [x] Set up Pinecone project + index (`researchmind`)
- [x] Embedding worker (consumes Redis queue `researchmind:embedding:jobs`)
- [x] Chunking algorithm with paragraph overlap
- [x] Voyage AI embedding API integration (`VOYAGE_MODEL`, default `voyage-3`)
- [x] Upsert chunks to Pinecone with metadata & workspace namespace isolation
- [x] Vector delete on document delete (`deleteDocumentEmbeddings`)
- [x] `/ai/search` endpoint (Retrieval debugging endpoint)
- [x] `/ai/query` endpoint (Groq/xAI LLM prompt + SSE token streaming + source citations)
- [x] AI session logged to MongoDB (`AISession` model & persistence)
- [x] Semantic search page with streaming answer + source citations (Frontend, `/dashboard/ai-researcher`)

✅ **Checkpoint:** Upload 3 papers, ask "What models are compared?", get a grounded answer with citations.

---

### 🟦 Phase 4 — Meeting Summarizer + Task Creation (Week 5) — [STATUS: implemented]
**Goal:** Paste meeting notes → structured summary → tasks auto-created.

- [x] Task Service: board + task CRUD
- [x] Bulk task creation endpoint (max 50, all-or-nothing, idempotent with `importKey`)
- [x] `/ai/summarize-meeting` endpoint (structured output)
- [x] Meeting Summarizer page: paste input → formatted output
- [x] "Create tasks from action items" button
- [x] Kanban board UI with @dnd-kit
- [x] Task detail modal (assignee, due date, priority, subtasks)

✅ **Checkpoint:** Paste meeting notes, get structured summary, click to create tasks on board.

---

### 🟦 Phase 5 — AI Agent (Week 6) — [STATUS: not started]
**Goal:** Agent executes multi-step instructions.

- [ ] `/ai/agent` endpoint with ReAct loop
- [ ] All 8 agent tools implemented and wired to real services
- [ ] Agent step streaming (SSE)
- [ ] Agent UI: instruction input + step feed + final answer
- [ ] Test with: "Find all tasks due this week and summarize them"

✅ **Checkpoint:** Agent reads tasks, searches docs, creates new doc — all from one instruction.

---

### 🟦 Phase 6 — Literature Review Generator (Week 7) — [STATUS: not started; placeholder page only]
**Goal:** Auto-generate a literature review from uploaded papers.

- [ ] `/ai/generate-review` endpoint
- [ ] Multi-pass generation (themes → sections → full review)
- [ ] Citation tracking (claim → source doc)
- [ ] Literature Review page with paper selection + streaming preview
- [ ] Save output as new document
- [ ] Export to PDF (html2pdf or puppeteer)

✅ **Checkpoint:** Select 5 papers, generate a formatted literature review with citations, export as PDF.

---

### 🟦 Phase 7 — Real-Time Chat (Week 8) — [STATUS: not started]
**Goal:** Team can communicate in real time inside workspace.

- [ ] Chat Service with channel CRUD
- [ ] Socket.io rooms per channel
- [ ] Real-time message send/receive
- [ ] Cursor-based message pagination
- [ ] Typing indicators
- [ ] Emoji reactions
- [ ] @mention detection → Redis pub/sub → notification
- [ ] Online presence per workspace

✅ **Checkpoint:** Real-time messaging, @mentions trigger notifications.

---

### 🟦 Phase 8 — Notifications + Dashboard (Week 9) — [STATUS: not started]
**Goal:** Smart notifications and progress visibility.

- [ ] Notification Service with Redis pub/sub subscriber
- [ ] In-app notification bell + unread count
- [ ] Real-time notification delivery via WebSocket
- [ ] Email notifications (Resend / Nodemailer)
- [ ] Progress dashboard: task chart, docs indexed count, AI usage stats
- [ ] New member onboarding summary (`/ai/onboard`)

✅ **Checkpoint:** Get notified on task assignment, see progress dashboard.

---

### 🟦 Phase 9 — Polish + Deploy (Week 10) — [STATUS: partial]
**Goal:** Production-ready, live, presentable.

- [ ] Loading states, error states, empty states throughout
- [ ] Mobile responsive layout
- [x] Dark mode toggle
- [x] GitHub Actions CI (typecheck + frontend build + tests; no lint step)
- [ ] Deploy all services to Railway
- [ ] Deploy React to Vercel
- [ ] MongoDB Atlas + Upstash Redis + Pinecone Starter
- [ ] Write final README with architecture diagram
- [ ] Record 3-minute demo video
- [ ] Create demo workspace with sample data

✅ **Checkpoint:** Live URL, working demo credentials, impressive README.

---

## 17. Folder Structure

Actual layout (npm workspaces: `frontend`, `services/*`, `packages/*`). The original design used an `apps/` directory, a `chat-service`, a `doc-service` with an embedded worker, and workspaces inside auth-service; none of those exist.

```
ReserchMind/
│
├── frontend/                               ← React 19 + Vite + TypeScript (port 5173)
│   └── src/
│       ├── api/                            ← axios client, auth interceptors, API modules
│       ├── components/                     ← auth, dashboard, documents, kanban, layout, ui, workspace
│       ├── hooks/                          ← React Query hooks (useDocuments, useAiQuery, ...)
│       ├── layouts/                        ← AppShell
│       ├── lib/                            ← query client, session, token refresh
│       ├── pages/                          ← Overview, Documents, SemanticSearch, MeetingSummarizer, Kanban, ...
│       ├── routes/                         ← AppRouter, ProtectedRoute
│       ├── store/                          ← Zustand: auth.store, workspace.store
│       ├── types/
│       └── utils/                          ← SSE parser, document status, meeting tasks, ...
│
├── services/
│   ├── api-gateway/                        ← Port 5000 (proxy, JWT check, rate limits, Swagger UI)
│   ├── auth-service/                       ← Port 5001 (users, tokens, refresh rotation)
│   ├── workspace-service/                  ← Port 5002 (workspaces, invite codes, membership)
│   ├── document-service/                   ← Port 5003 (upload, extraction, Cloudinary, embedding queue)
│   ├── task-service/                       ← Port 5004 (boards, tasks, activity, bulk import)
│   ├── ai-service/                         ← Port 5006 (embedding worker, RAG SSE, meeting summarizer)
│   │   └── src/{config,controllers,errors,middlewares,models,prompts,routes,scripts,services,types,utils,workers}
│   └── notification-service/               ← Empty placeholder (not implemented)
│   (each service: src/{config,controllers,middlewares,models,routes,services,...}, app.ts, server.ts)
│
├── packages/
│   ├── shared/                             ← auth (JWT, internal token, workspace membership), errors,
│   │                                         secrets check, health check, Mongo/Redis lifecycle, shutdown
│   └── validation/                         ← zod schemas (auth, workspace, document, task, ai) + validate()
│
├── tests/                                  ← node:test suites (`npm test`), integration tests need TEST_MONGO_URI
├── docs/                                   ← onboarding, architecture, docker notes
├── postman/                                ← Postman collections
├── docker-compose.yml                      ← MongoDB, Redis, Mongo Express (infrastructure only)
├── .github/workflows/ci.yml
└── ResearchMind_readme.md
```

Each service and `frontend/` has its own `.env.example`; there is no root `.env.example`.

---

## 18. Environment Variables

Copy each service's own `.env.example` to `.env` in the same directory (`services/<service>/.env.example`, `frontend/.env.example`) and fill in the values. Never commit real values. Names below match the code; see `docs/onboarding.md` for a full example per service.

```env
# ── Every backend service except notification-service ─────────────
PORT=                       # defaults: gateway 5000, auth 5001, workspace 5002,
                            #           document 5003, task 5004, ai 5006
JWT_ACCESS_SECRET=          # required, >= 32 chars, IDENTICAL in every service

# ── MongoDB ───────────────────────────────────────────────────────
MONGO_URI=                  # auth-service and workspace-service read only MONGO_URI;
                            # document-, task- and ai-service read MONGODB_URI first, then MONGO_URI
                            # docker-compose enables auth: mongodb://<user>:<password>@host:27017/<db>?authSource=admin

# ── API Gateway ───────────────────────────────────────────────────
AUTH_SERVICE_URL=  WORKSPACE_SERVICE_URL=  DOCUMENT_SERVICE_URL=  TASK_SERVICE_URL=  AI_SERVICE_URL=
REDIS_URL=                  # rate-limit store

# ── Auth Service ──────────────────────────────────────────────────
JWT_REFRESH_SECRET=         # required, different from JWT_ACCESS_SECRET
ACCESS_TOKEN_EXPIRES=15m    # default 15m
REFRESH_TOKEN_EXPIRES=7d    # default 7d
REFRESH_REUSE_GRACE_MS=     # optional, default 10000
REDIS_HOST=  REDIS_PORT=    # connected but unused
INTERNAL_SERVICE_TOKEN=     # for /internal/users/bulk (same value as workspace-service)

# ── Workspace Service ─────────────────────────────────────────────
AUTH_SERVICE_URL=  INTERNAL_SERVICE_TOKEN=   # optional, resolves member names

# ── Document Service ──────────────────────────────────────────────
REDIS_URL=                  # embedding queue
WORKSPACE_SERVICE_URL=  AI_SERVICE_URL=
INTERNAL_SERVICE_TOKEN=     # required, same value as ai-service
CLOUDINARY_CLOUD_NAME=  CLOUDINARY_API_KEY=  CLOUDINARY_API_SECRET=
# Upload limit is fixed in code at 10 MB (no MAX_FILE_SIZE_MB variable)

# ── Task Service ──────────────────────────────────────────────────
WORKSPACE_SERVICE_URL=

# ── AI Service ────────────────────────────────────────────────────
REDIS_URL=  DOCUMENT_SERVICE_URL=  WORKSPACE_SERVICE_URL=
INTERNAL_SERVICE_TOKEN=     # required, same value as document-service
XAI_API_KEY=                # Groq (gsk_...) or xAI key; GROQ_API_KEY also accepted
XAI_MODEL=  XAI_BASE_URL=   # optional overrides
VOYAGE_API_KEY=
VOYAGE_MODEL=voyage-3       # default; must match the Pinecone index
VOYAGE_EMBEDDING_DIMENSION=1024
PINECONE_API_KEY=
PINECONE_INDEX=researchmind
LLM_REQUEST_TIMEOUT_MS=  LLM_STREAM_IDLE_TIMEOUT_MS=   # optional, defaults 60000 / 30000

# ── Frontend ──────────────────────────────────────────────────────
VITE_API_URL=http://localhost:5000/api   # must include /api
```

Not used by the code (design only): `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_SECRET`, `BCRYPT_ROUNDS`, SMTP/Resend variables, `ANTHROPIC_API_KEY`, `PINECONE_INDEX_NAME`, `PINECONE_ENVIRONMENT`, `DOC_SERVICE_URL`, `CHAT_SERVICE_URL`, `NOTIFICATION_SERVICE_URL`, `CLIENT_URL`, `MAX_FILE_SIZE_MB`. Optional `CORS_ORIGIN` (comma-separated) is read by document- and task-service.

---

## 19. Local Development Setup

### Prerequisites
- Node.js 22 (CI uses Node 22; several dependencies require `node >= 22`)
- Docker Desktop (for MongoDB + Redis)
- Pinecone account, with an index of dimension 1024 (cosine)
- Groq or xAI API key
- Voyage AI API key
- Cloudinary account (free tier)

### Step 1 — Clone the repository

```bash
git clone https://github.com/yourusername/researchmind.git
cd researchmind
```

### Step 2 — Install dependencies

```bash
# One install at the repository root covers frontend/, services/* and packages/* (npm workspaces)
npm install
```

### Step 3 — Start infrastructure

```bash
docker-compose up -d
```

This starts MongoDB (`27017`, authentication enabled), Redis (`6379`) and Mongo Express (`8081`). Verify with `docker-compose ps`.

### Step 4 — Configure environment

```bash
# Each service has its own example file
for dir in services/api-gateway services/auth-service services/workspace-service            services/document-service services/task-service services/ai-service frontend; do
  cp "$dir/.env.example" "$dir/.env"
done
```

Edit each `.env` file with your actual keys and credentials (see Section 18 and `docs/onboarding.md`).

### Step 5 — Set up Pinecone index

No setup script exists in the repository. Create the index yourself (Pinecone console or SDK) with dimension `1024` (matching `VOYAGE_EMBEDDING_DIMENSION`, Voyage `voyage-3`) and the cosine metric, and put its name in `PINECONE_INDEX`. `services/ai-service/src/scripts/test-pinecone.ts` can be used to check connectivity.

### Step 6 — Start all services

```bash
# From the repository root: gateway, auth, workspace, document, task, ai and frontend
npm run dev

# Backend only
npm run dev:services
```

The AI service starts the embedding worker in-process; `npm run dev:worker --workspace=ai-service` runs an optional extra worker.

### Step 7 — Open the app

| Service | URL |
|---------|-----|
| **React App** | http://localhost:5173 |
| API Gateway | http://localhost:5000 (Swagger UI at `/api-docs`) |
| Auth Service | http://localhost:5001 |
| Workspace Service | http://localhost:5002 |
| Document Service | http://localhost:5003 |
| Task Service | http://localhost:5004 |
| AI Service | http://localhost:5006 |

### Step 8 — Seed demo data

Roadmap / not yet implemented: there is no seed script and no demo account.

### Step 9 — Run the tests

```bash
npm test    # integration tests are skipped unless TEST_MONGO_URI points at a disposable MongoDB
```

---

## 20. Docker Setup

> **As implemented:** `docker-compose.yml` runs infrastructure only: `mongodb` (`mongo:7`, root credentials from `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD`), `redis` (`redis:7`) and `mongo-express` (port 8081, basic auth from `MONGO_EXPRESS_USERNAME` / `MONGO_EXPRESS_PASSWORD`). There are no Dockerfiles, and the services are not containerized. The compose file, Dockerfile and service commands below are the **roadmap design**. See `docs/deployment/docker-process.md`.

### docker-compose.yml (design)

```yaml
version: '3.8'

services:
  mongodb:
    image: mongo:7
    restart: unless-stopped
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

  api-gateway:
    build: ./apps/api-gateway
    ports:
      - "3000:3000"
    env_file: ./apps/api-gateway/.env
    depends_on: [mongodb, redis]
    restart: unless-stopped

  auth-service:
    build: ./apps/auth-service
    ports:
      - "3001:3001"
    env_file: ./apps/auth-service/.env
    depends_on: [mongodb, redis]
    restart: unless-stopped

  doc-service:
    build: ./apps/doc-service
    ports:
      - "3002:3002"
    env_file: ./apps/doc-service/.env
    depends_on: [mongodb, redis]
    restart: unless-stopped

  chat-service:
    build: ./apps/chat-service
    ports:
      - "3003:3003"
    env_file: ./apps/chat-service/.env
    depends_on: [mongodb, redis]
    restart: unless-stopped

  task-service:
    build: ./apps/task-service
    ports:
      - "3004:3004"
    env_file: ./apps/task-service/.env
    depends_on: [mongodb, redis]
    restart: unless-stopped

  ai-service:
    build: ./apps/ai-service
    ports:
      - "3005:3005"
    env_file: ./apps/ai-service/.env
    depends_on: [redis]
    restart: unless-stopped

  notification-service:
    build: ./apps/notification-service
    ports:
      - "3006:3006"
    env_file: ./apps/notification-service/.env
    depends_on: [mongodb, redis]
    restart: unless-stopped

  client:
    build: ./apps/client
    ports:
      - "5173:80"
    restart: unless-stopped

volumes:
  mongo_data:
  redis_data:
```

### Dockerfile (design; no Dockerfiles exist yet)

```dockerfile
FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
CMD ["node", "src/index.js"]
```

### Commands

```bash
# Start infrastructure (works today)
docker-compose up -d

# --- The commands below need the roadmap compose file ---
# Start everything
docker-compose up --build

# Stop everything
docker-compose down

# View logs for a specific service
docker-compose logs -f ai-service

# Rebuild one service after code change
docker-compose up --build ai-service
```

---

## 21. Testing Strategy

> **As implemented:** tests use Node's built-in test runner (`node:test`) via `tsx`, not Jest/Supertest. `npm test` runs `tests/*.test.ts`, covering auth flow and refresh rotation, workspace membership/isolation and join, upload and model validation, document extraction errors and lifecycle, the embedding worker, AI validation and streaming, client helpers, error middleware and service lifecycle. Integration tests (`*.integration.test.ts`) need `TEST_MONGO_URI` pointing at a disposable MongoDB; without it they are skipped. CI runs them against a MongoDB service container. The Jest, Supertest and k6 examples below are design sketches (the `/docs/...` routes and `embed:queue` they use do not exist).

### Unit Tests (Jest)

What to unit test:
- `chunker.js` — verify chunk size, overlap, paragraph boundary respect
- `tokenService.js` — token generation, expiry, rotation logic
- `rateLimiter.js` — sliding window counter behavior
- `agentLoop.js` — tool call routing
- Joi validators — correct and incorrect inputs

```bash
cd apps/ai-service && npm test
```

### Integration Tests (Supertest + MongoDB in-memory)

```javascript
// doc-service/tests/upload.test.js
describe('POST /docs/workspace/:id', () => {
  it('accepts PDF and queues for embedding', async () => {
    const res = await request(app)
      .post(`/docs/workspace/${workspaceId}`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', 'tests/fixtures/sample.pdf');

    expect(res.status).toBe(201);
    expect(res.body.data.embeddingStatus).toBe('pending');
    // Verify Redis queue received the job
    const queued = await redis.llen('embed:queue');
    expect(queued).toBe(1);
  });

  it('rejects unsupported file types', async () => {
    const res = await request(app)
      .post(`/docs/workspace/${workspaceId}`)
      .attach('file', 'tests/fixtures/video.mp4');
    expect(res.status).toBe(422);
  });
});
```

### Rate Limiting Demo Test

```javascript
// Run this to demonstrate rate limiting during demo
it('blocks AI search after rate limit exceeded', async () => {
  const requests = Array(31).fill(null).map(() =>
    request(app).post('/ai/search').set('Authorization', `Bearer ${token}`)
      .send({ question: 'test' })
  );
  const responses = await Promise.all(requests);
  const blocked = responses.filter(r => r.status === 429);
  expect(blocked.length).toBeGreaterThan(0);
});
```

### Load Test (k6)

```javascript
// k6/search-load.js
import http from 'k6/http';
import { check } from 'k6';

export const options = { vus: 30, duration: '20s' };

export default function () {
  const res = http.post(
    'http://localhost:3000/api/ai/search',
    JSON.stringify({ question: 'What is BERT?' }),
    { headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ...' } }
  );
  check(res, { 'ok or rate limited': r => [200, 429].includes(r.status) });
}
```

```bash
k6 run k6/search-load.js
# Shows rate limiting in action — great for demo and interviews
```

---

## 22. Deployment Plan

> **Roadmap / not yet implemented.** Nothing is deployed, and there are no Dockerfiles, Railway or Vercel configuration. The real CI workflow (`.github/workflows/ci.yml`) runs on pushes and pull requests to `develop` and `main`: it installs with `npm ci` on Node 22, typechecks the six backend services, builds the frontend and runs `npm test` with a MongoDB service container. It has no lint, per-service matrix or deploy step, unlike the sample below. If the frontend is deployed, `VITE_API_URL` must include the `/api` suffix.

### Production Stack

```
Vercel
  └── React Client (auto-deploy from main branch)

Railway (6 services, each from its own Dockerfile)
  ├── api-gateway
  ├── auth-service
  ├── doc-service
  ├── chat-service
  ├── task-service
  ├── ai-service
  └── notification-service

MongoDB Atlas       ← M0 free tier (512MB)
Upstash Redis       ← free tier (10k commands/day)
Pinecone            ← Starter plan (free, 1 index)
Cloudinary          ← free tier (25GB storage)
```

### GitHub Actions CI/CD

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint-and-test:
    runs-on: ubuntu-latest
    strategy:
      matrix:
        service:
          - auth-service
          - doc-service
          - chat-service
          - task-service
          - ai-service
          - notification-service

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
          cache-dependency-path: apps/${{ matrix.service }}/package-lock.json

      - name: Install dependencies
        run: cd apps/${{ matrix.service }} && npm ci

      - name: Lint
        run: cd apps/${{ matrix.service }} && npm run lint

      - name: Test
        run: cd apps/${{ matrix.service }} && npm test
        env:
          NODE_ENV: test
          MONGODB_URI: mongodb://localhost:27017/test
          REDIS_URL: redis://localhost:6379

    services:
      mongodb:
        image: mongo:7
        ports: ["27017:27017"]
      redis:
        image: redis:7-alpine
        ports: ["6379:6379"]
```

### Railway Deployment Steps

1. Connect your GitHub repo to Railway
2. Create a new Railway project
3. Add a service for each `apps/*` directory
4. Set the root directory for each service (e.g., `apps/ai-service`)
5. Add all environment variables from `.env` in Railway dashboard
6. Enable auto-deploy on push to `main`
7. Note each service's Railway URL and configure gateway env vars

### Vercel Deployment

```bash
cd apps/client
vercel --prod

# Set env vars in Vercel dashboard:
# VITE_API_URL=https://your-gateway.railway.app
# VITE_SOCKET_URL=https://your-chat-service.railway.app
```

---

## 23. Portfolio & Presentation Guide

> This guide describes the **target** product. Several claims below are not true of the current code: no chat, WebSockets, Redis pub/sub, AI agent or literature review generator; no deployment, demo account or seed data; and five implemented backend services plus the gateway (not 7 microservices). Check [Current Implementation Status](#current-implementation-status) before presenting.

### Live Demo Checklist

Before presenting, make sure:
- [ ] Demo workspace exists with 5+ uploaded papers
- [ ] Papers are fully indexed (embeddingStatus = "indexed")
- [ ] Demo account credentials work: `demo@researchmind.dev / Demo1234!`
- [ ] At least 3 channels exist with some messages
- [ ] Kanban board has tasks in multiple columns
- [ ] Literature review has been pre-generated once

### 3-Minute Demo Flow

```
00:00 — Show the problem (scattered student knowledge)
00:20 — Upload a PDF research paper, explain embedding pipeline
00:50 — Ask a natural language question about the paper → answer streams with citations
01:20 — Paste meeting notes → get structured summary + action items
01:40 — Click "Create Tasks" → tasks appear on Kanban board
02:00 — AI Agent: "Generate a literature review from all papers" → show it working
02:40 — Show architecture diagram briefly
03:00 — End with the deployed URL
```

### Elevator Pitch (30 seconds)

> *"ResearchMind is an AI research workspace for engineering student teams. The core innovation is a RAG pipeline — every uploaded document is chunked, embedded, and stored in a vector database. Students ask natural language questions and get answers grounded in their actual project documents, with citations. Beyond Q&A, an AI agent can summarize meeting notes into structured action items, auto-create tasks, and generate literature reviews from uploaded papers. The backend is built with MERN stack using 7 microservices, a Redis pub/sub event bus, rate limiting, JWT with refresh token rotation, and WebSocket real-time communication."*

### Interview Talking Points

| Round | What to highlight |
|-------|------------------|
| **Screening** | What problem it solves, tech stack, live demo URL |
| **Technical** | RAG pipeline design, chunking strategy with overlap, vector namespace isolation, JWT rotation, embedding worker architecture |
| **System Design** | Why microservices (independent scaling, isolated failures), Redis pub/sub vs direct HTTP calls, why Pinecone over in-memory search, MongoDB index design for task queries |
| **AI-Specific** | Difference between RAG and plain LLM, why chunking matters, how namespace isolation prevents data leakage, ReAct agent loop, structured output for meeting summaries |
| **Behavioral** | What was the hardest part (embedding pipeline? streaming SSE?), what you learned, what you'd do differently |

### How This Stands Out

| Typical Student Project | ResearchMind |
|------------------------|-------------|
| Single Express server | 7 microservices + API gateway |
| No authentication system | JWT + refresh rotation + Redis invalidation |
| "Uses ChatGPT" | RAG pipeline with vector embeddings + Pinecone |
| Chatbot add-on | AI agent with tool calling + ReAct loop |
| No rate limiting | Redis sliding window rate limiter |
| REST polling | WebSocket + pub/sub event-driven architecture |
| Local only | Deployed on Railway + Vercel |
| No background processing | Redis queue + background embedding worker |
| Basic CRUD | Full text extraction, chunking, embedding lifecycle |

### README Architecture Diagram

Add this to your GitHub README. Draw it in [Excalidraw](https://excalidraw.com) and export as PNG:

- Top: React client box
- Arrow down to: API Gateway (highlight: JWT + Rate Limit)
- Arrow down to: 6 service boxes in a row
- Arrows from services to: MongoDB, Redis, Pinecone
- Highlight the Embedding Worker separately as a background process
- Label every arrow with the communication method

---

## ✅ Master Checklist

> Checked items have code in the repository; unchecked items are roadmap / not yet implemented.

### Core Infrastructure
- [x] API Gateway with JWT middleware and Redis rate limiting
- [ ] 6 microservices independently deployable (5 services + gateway run separately; no deployment)
- [ ] Redis pub/sub event bus for cross-service communication
- [ ] Socket.io with Redis adapter for real-time
- [x] MongoDB indexes declared in the Mongoose models
- [x] Docker Compose local orchestration (infrastructure only)

### Document Intelligence (RAG)
- [x] PDF / DOCX text extraction (MD / TXT not supported)
- [x] Chunking with overlap (paragraph-aware)
- [x] Voyage AI embedding generation
- [x] Pinecone upsert with workspace namespace
- [x] Background embedding worker (Redis queue)
- [x] Vector lifecycle: create / delete (no in-place update)
- [x] Semantic search endpoint with SSE streaming
- [x] Source citation in search responses

### AI Agent
- [ ] ReAct agent loop with tool calling
- [ ] 8 tools: search, read doc, list docs, create task, list tasks, create doc, get members, post message
- [ ] Agent step streaming to client
- [ ] Agent session logged to MongoDB

### Specialized AI Features
- [x] Meeting notes summarizer (structured output)
- [ ] Literature review generator (multi-pass)
- [ ] Report section drafter
- [ ] New member onboarding summary
- [ ] SSE streaming on all AI endpoints

### Application Features
- [x] JWT auth with refresh token rotation
- [x] Workspace creation and invite-code join (no email invites)
- [x] Document library with embedding status
- [ ] Real-time team chat with channels
- [x] Kanban task board with drag-and-drop
- [ ] Progress dashboard
- [ ] In-app + email notifications

### DevOps
- [ ] Dockerfiles per service
- [x] GitHub Actions CI pipeline
- [ ] Deployed and accessible via public URL
- [ ] Demo credentials and seeded workspace
- [ ] Architecture diagram in README

---

*ResearchMind — where your project knowledge stops being scattered and starts being understood. 🎓🤖*
