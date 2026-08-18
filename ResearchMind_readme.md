# 🎓 ResearchMind
### AI Research & Project Workspace for Engineering Student Teams

> Engineering students generate massive amounts of project knowledge — research papers, reports,
> meeting notes, code docs, and discussions — scattered across drives, chats, and emails.
> **ResearchMind** brings it all into one intelligent workspace that doesn't just store information —
> it *understands* it, and actively assists teams throughout the entire project lifecycle.

[![Node.js](https://img.shields.io/badge/Node.js-20-339933?logo=nodedotjs)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://reactjs.org)
[![MongoDB](https://img.shields.io/badge/MongoDB-7-47A248?logo=mongodb)](https://mongodb.com)
[![Redis](https://img.shields.io/badge/Redis-7-DC382D?logo=redis)](https://redis.io)
[![Pinecone](https://img.shields.io/badge/Pinecone-Vector_DB-000000)](https://pinecone.io)
[![Claude](https://img.shields.io/badge/Claude-AI-orange)](https://anthropic.com)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker)](https://docker.com)

---

## 📌 Table of Contents

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

| Module | Feature | AI Technique |
|--------|---------|-------------|
| 📄 Document Ingestion | Upload PDF, DOCX, MD, TXT | Chunking + Embedding pipeline |
| 🔍 Semantic Search | Natural language Q&A over all documents | RAG — vector similarity search |
| 🤖 AI Agent | Multi-step task automation | Tool calling + ReAct loop |
| 📚 Literature Review Generator | Auto-generate review from papers | RAG + structured generation |
| 📝 Meeting Summarizer | Paste notes → decisions + tasks | Structured output prompting |
| ✅ Task Manager | Kanban board + AI task creation | Agent tool execution |
| 💬 Project Chat | Real-time team messaging | WebSocket + pub/sub |
| 📊 Progress Tracker | Visual project timeline | Aggregation + AI insight |
| 🔔 Smart Notifications | Relevant alerts, not noise | Event-driven + AI filtering |
| 👥 Team Workspace | Isolated per project team | Multi-tenant architecture |

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

### ✅ AI Agent with Tool Calling

The agent uses Claude's **function calling API** with a ReAct (Reasoning + Acting) loop:

- Agent receives a natural language instruction
- Reasons about what steps are needed
- Calls tools (search docs, create task, summarize, post message) in sequence
- Observes results and decides next steps
- Reports what it did with full transparency

This is not a chatbot. It is an **autonomous workflow executor**.

### ✅ Document Embedding Pipeline

A real background data pipeline:
- Triggered on every document upload
- Handles PDF text extraction, DOCX parsing, Markdown parsing
- Intelligent chunking (respects paragraph boundaries, overlapping windows)
- Batch embedding with retry logic
- Incremental upsert to Pinecone (not full re-index on every change)

### ✅ Structured Output Generation

For literature reviews and meeting summaries, the system uses:
- Schema-guided prompting to force structured JSON output
- Multi-pass generation (outline → section → full review)
- Citation tracking — every claim linked back to source document + page

### ✅ Context-Aware Prompting at Scale

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
  → Doc Service stores raw file (Cloudinary/S3)
  → Extracts text (pdf-parse / mammoth)
  → Triggers Embedding Pipeline Worker (async)
  → Worker chunks text → generates embeddings → upserts to Pinecone
  → Doc record in MongoDB updated: embeddingStatus = "indexed"

SEMANTIC SEARCH FLOW
User asks: "Which papers mention BERT?"
  → AI Service embeds the query
  → Queries Pinecone (topK=5, namespace=projectId)
  → Retrieves relevant chunks with source metadata
  → Builds prompt: system + context chunks + user question
  → Streams Claude response back via SSE
  → Response includes citations (doc name + page)

AGENT FLOW
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

### Frontend
| Purpose | Technology | Why |
|---------|-----------|-----|
| Framework | React 18 + Vite | Fast dev server, modern tooling |
| State Management | Zustand | Lightweight, no boilerplate |
| Styling | Tailwind CSS + shadcn/ui | Fast, consistent UI |
| File Upload | react-dropzone | PDF/DOCX drag-and-drop |
| Rich Text Editor | TipTap | Extensible, supports collaboration |
| Real-time | Socket.io-client | Chat + live updates |
| HTTP Client | Axios + interceptors | Auto token refresh |
| Routing | React Router v6 | Standard SPA routing |
| Drag and Drop | @dnd-kit/core | Kanban board |
| AI Streaming | Native EventSource API | SSE for token-by-token output |
| Charts | Recharts | Progress dashboard |
| PDF Viewer | react-pdf | View uploaded papers in-app |

### Backend (per microservice)
| Purpose | Technology | Why |
|---------|-----------|-----|
| Runtime | Node.js 20 | V8 performance, huge ecosystem |
| Framework | Express.js | Minimal, flexible |
| Real-time | Socket.io | WebSocket + fallbacks |
| Auth | jsonwebtoken + bcrypt | Industry standard |
| Validation | Joi | Declarative schema validation |
| File handling | Multer + Cloudinary | Upload + CDN storage |
| PDF extraction | pdf-parse | Extract text from PDFs |
| DOCX extraction | mammoth | Extract text from DOCX |
| Logging | Winston + Morgan | Structured logs |
| Process manager | PM2 (prod) | Restart on crash |

### Data & AI Infrastructure
| Tool | Purpose |
|------|---------|
| MongoDB + Mongoose | Primary data store — documents, tasks, users |
| Redis (ioredis) | Rate limiting, caching, pub/sub, presence |
| Pinecone | Vector database for semantic search |
| Anthropic Claude API | LLM for all AI features |
| Voyage AI embeddings | Generate document + query embeddings |
| Docker + Compose | Local environment orchestration |

### DevOps
| Tool | Purpose |
|------|---------|
| Docker Compose | Local multi-service dev |
| GitHub Actions | CI/CD — lint, test, deploy |
| Railway | Deploy all backend services |
| Vercel | Deploy React frontend |
| MongoDB Atlas | Production DB |
| Upstash Redis | Serverless production Redis |

---

## 8. Microservices Breakdown

### 8.1 API Gateway — Port 3000

The gateway is the **only** entry point. The React client never calls services directly.

**Middleware stack (applied in order):**
```
Request arrives
  → requestId middleware (inject X-Request-ID header)
  → Morgan logger (log method, path, IP)
  → CORS middleware
  → Rate limiter (Redis sliding window)
  → JWT verifier (except /auth/register, /auth/login)
    → attaches { userId, role, workspaceId } to request headers
  → HTTP proxy to correct downstream service
```

**Route mapping:**
```
/api/auth/*       → Auth Service       :3001
/api/docs/*       → Docs Service       :3002
/api/chat/*       → Chat Service       :3003
/api/tasks/*      → Task Service       :3004
/api/ai/*         → AI Service         :3005
/api/notif/*      → Notification Svc   :3006
```

**Rate Limits:**
| Endpoint | Limit | Window |
|---------|-------|--------|
| POST /auth/login | 5 requests | 15 minutes per IP |
| POST /auth/register | 3 requests | 1 hour per IP |
| POST /ai/search | 30 requests | 1 hour per user |
| POST /ai/agent | 10 requests | 1 hour per user |
| POST /ai/generate-review | 5 requests | 1 hour per user |
| All other endpoints | 100 requests | 1 minute per user |

---

### 8.2 Auth Service — Port 3001

Handles identity, authentication, and workspace membership.

**Endpoints:**
```
POST  /auth/register                 Create account (name, email, password)
POST  /auth/login                    Login → accessToken + refreshToken cookie
POST  /auth/refresh                  Rotate refresh token
POST  /auth/logout                   Invalidate refresh token in Redis
GET   /auth/me                       Current user profile
PUT   /auth/me                       Update name, avatar
POST  /auth/forgot-password          Send reset email
POST  /auth/reset-password           Reset with token

POST  /workspaces                    Create workspace (project team)
GET   /workspaces                    List user's workspaces
GET   /workspaces/:id                Workspace detail + members
POST  /workspaces/:id/invite         Send invite email
POST  /workspaces/:id/join/:token    Accept invite
PUT   /workspaces/:id/members/:uid   Change member role
DELETE /workspaces/:id/members/:uid  Remove member
```

**JWT Auth Flow:**
```
Login
  → verify password with bcrypt
  → issue accessToken (JWT, 15min, payload: { userId, email })
  → issue refreshToken (JWT, 7 days)
  → store SHA256(refreshToken) in Redis key: refresh:{userId}, TTL = 7 days
  → send accessToken in response body
  → send refreshToken in httpOnly, Secure, SameSite=Strict cookie

Every request
  → Gateway extracts Bearer token from Authorization header
  → Verifies JWT signature and expiry
  → Injects X-User-Id and X-User-Role into forwarded request

Token refresh
  → Client sends request with refreshToken cookie
  → Server verifies cookie → looks up hash in Redis
  → If match: issue NEW accessToken + NEW refreshToken
  → Delete old hash from Redis → store new hash (rotation)
  → If mismatch (stolen token used): delete all refresh tokens for user → force re-login
```

---

### 8.3 Document Service — Port 3002

Core service. Manages file uploads, document storage, and triggers the embedding pipeline.

**Endpoints:**
```
GET    /docs/workspace/:wid              List all documents in workspace
POST   /docs/workspace/:wid              Upload new document (multipart/form-data)
GET    /docs/:id                         Get document metadata + content
DELETE /docs/:id                         Delete document + remove vectors from Pinecone
GET    /docs/:id/content                 Get extracted text content
GET    /docs/:id/file                    Stream original file (PDF/DOCX)
GET    /docs/workspace/:wid/status       Embedding status for all docs
POST   /docs/:id/reindex                 Manually trigger re-embedding
```

**Document Upload Flow:**
```javascript
// 1. Client uploads file via multipart form
// 2. Multer saves to temp directory
// 3. Upload original to Cloudinary (for viewing)
// 4. Extract text based on file type:
//    - PDF  → pdf-parse
//    - DOCX → mammoth.extractRawText()
//    - MD/TXT → read directly
// 5. Save document record to MongoDB
//    { title, type, cloudinaryUrl, extractedText, embeddingStatus: "pending" }
// 6. Emit "document:uploaded" event to embedding worker (Redis pub/sub)
// 7. Return document record immediately (don't wait for embedding)
// 8. Worker processes embedding in background, updates embeddingStatus
```

**Supported File Types:**
- `.pdf` — Research papers, reports, presentations
- `.docx` — Word documents, reports
- `.md` — Markdown notes, README files
- `.txt` — Plain text meeting notes, logs

---

### 8.4 Chat Service — Port 3003

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

### 8.5 Task Service — Port 3004

Kanban task management. Tasks can be created manually or by the AI agent.

**Endpoints:**
```
GET    /tasks/workspace/:wid/boards          List boards
POST   /tasks/workspace/:wid/boards          Create board
GET    /tasks/boards/:id                     Board detail + all tasks
POST   /tasks/boards/:id/tasks               Create task
GET    /tasks/:id                            Task detail
PUT    /tasks/:id                            Update task
DELETE /tasks/:id                            Delete task
PUT    /tasks/:id/move                       Change status + reorder
GET    /tasks/:id/activity                   Activity log
POST   /tasks/workspace/:wid/bulk            Bulk create tasks (used by AI agent)
GET    /tasks/workspace/:wid/summary         Summary stats for dashboard
GET    /tasks/workspace/:wid/overdue         List overdue tasks
```

**Task Schema Fields:**
- title, description, status (todo / in_progress / review / done)
- priority (low / medium / high / urgent)
- assigneeId, dueDate, estimatedHours
- linkedDocId (link to a source document)
- createdBy (user or "AI Agent")
- tags, subtasks, activity log

---

### 8.6 AI Service — Port 3005

The intelligence layer. All AI features are handled here.

**Endpoints:**
```
POST  /ai/search              Semantic Q&A over documents (RAG)
POST  /ai/agent               AI agent: multi-step task execution
POST  /ai/summarize-meeting   Format meeting notes → structured summary
POST  /ai/generate-review     Generate literature review from papers
POST  /ai/draft-section       Draft a project report section
POST  /ai/explain-document    Ask questions about a specific document
POST  /ai/suggest-tasks       Suggest tasks from a document or discussion
POST  /ai/onboard             Onboarding summary for new team member
POST  /ai/embed               Internal — generate embedding for text
```

**All endpoints stream responses via SSE except `/ai/embed`.**

---

### 8.7 Notification Service — Port 3006

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
│  PDF/DOCX/MD uploaded                                │
│       ↓                                              │
│  Text Extraction                                     │
│    PDF  → pdf-parse (preserves layout)               │
│    DOCX → mammoth (clean text, no styling)           │
│    MD   → remark (parse + stringify to plain)        │
│       ↓                                              │
│  Preprocessing                                       │
│    - Remove headers/footers (page number patterns)   │
│    - Normalize whitespace                            │
│    - Split into logical sections (by heading)        │
│       ↓                                              │
│  Chunking  (size=400 tokens, overlap=60 tokens)      │
│    - Respect paragraph boundaries                    │
│    - Never split a sentence across chunks            │
│    - Overlapping window preserves cross-boundary ctx │
│       ↓                                              │
│  Embedding  (Voyage AI voyage-2 model)               │
│    - Batch chunks in groups of 20 (rate limit safe)  │
│    - Each chunk → 1024-dimension float vector        │
│       ↓                                              │
│  Pinecone Upsert                                     │
│    - namespace = workspaceId (team isolation)        │
│    - id = `{docId}-chunk-{index}`                    │
│    - values = embedding vector                       │
│    - metadata = { docId, docTitle, chunkIndex,       │
│                   text, pageNumber, workspaceId,     │
│                   fileType, uploadedAt }             │
│       ↓                                              │
│  MongoDB update: embeddingStatus = "indexed"         │
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
│    topK = 6                                          │
│    namespace = workspaceId                           │
│    filter = { fileType: "pdf" }  (optional)          │
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
│  Claude API (streaming)                              │
│       ↓                                              │
│  Stream answer token by token via SSE                │
│    + include sources: [{ docTitle, chunkIndex }]     │
└──────────────────────────────────────────────────────┘
```

### 9.3 Chunking Algorithm

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

// Delete all vectors for a document
await pinecone.index(INDEX_NAME).namespace(workspaceId).deleteMany({
  filter: { docId: { "$eq": docId } }
});

// Delete entire workspace (on workspace deletion)
await pinecone.index(INDEX_NAME).namespace(workspaceId).deleteAll();
```

### 9.5 Vector Lifecycle

| Event | Pinecone Action |
|-------|----------------|
| Document uploaded + processed | Upsert all chunks |
| Document re-uploaded / edited | Delete old chunks → upsert new |
| Document deleted | Delete all chunks with docId filter |
| Workspace deleted | Delete entire namespace |
| Manual reindex triggered | Delete → re-chunk → re-embed → upsert |

---

## 10. AI Agent System — Deep Dive

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

### 11.1 Semantic Q&A (RAG Search)

**Endpoint:** `POST /ai/search`

**Request:**
```json
{
  "question": "Which papers propose using attention mechanisms for our problem?",
  "filters": { "fileType": "pdf" }
}
```

**Response (streamed via SSE):**
```json
{
  "answer": "Based on your uploaded papers, three sources discuss attention mechanisms...",
  "sources": [
    { "docId": "...", "docTitle": "Attention Is All You Need (uploaded)", "preview": "..." },
    { "docId": "...", "docTitle": "Project Research Notes - Week 3", "preview": "..." }
  ]
}
```

---

### 11.2 Meeting Notes Summarizer

**Endpoint:** `POST /ai/summarize-meeting`

**Input:** Raw meeting notes (pasted text or document ID)

**Output (structured JSON → saved as new document):**
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

The frontend displays this as a formatted summary and offers one-click task creation from action items.

---

### 11.3 Literature Review Generator

**Endpoint:** `POST /ai/generate-review`

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

### 11.4 Project Report Section Drafter

**Endpoint:** `POST /ai/draft-section`

**Request:**
```json
{
  "section": "methodology",
  "instructions": "Focus on the data preprocessing pipeline and model architecture we chose"
}
```

Agent searches the knowledge base for relevant notes, decisions, and technical details, then drafts the section grounded in real project content.

---

### 11.5 New Member Onboarding

**Endpoint:** `POST /ai/onboard`

When a new team member joins:
- AI searches all documents for: project overview, current status, key decisions
- Generates an onboarding brief: what the project is, what has been done, what's in progress, key papers to read, open questions
- Delivered as a formatted document the new member sees on first login

---

### 11.6 Streaming Implementation

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
| `FORBIDDEN` | 403 | Token valid but no access to this resource |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_ERROR` | 422 | Invalid request body or params |
| `RATE_LIMITED` | 429 | Too many requests |
| `EMBEDDING_PENDING` | 202 | Document uploaded but not yet indexed |
| `AI_UNAVAILABLE` | 503 | AI provider error or timeout |
| `FILE_TOO_LARGE` | 413 | Upload exceeds 20MB limit |

---

## 14. Real-Time & System Design Concepts

### 14.1 API Gateway Pattern
Single entry point. Services are not exposed directly. All auth, rate limiting, and logging happens once at the gateway — services trust the injected headers.

### 14.2 Redis Sliding Window Rate Limiter

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
Stateless access token (15min) + stateful refresh token (7d, Redis-backed). On every refresh, the old token is deleted from Redis and a new one is issued. Token reuse detection → all sessions revoked.

### 14.4 Redis Pub/Sub Event Bus

Services communicate through events, not direct HTTP calls. This decouples them:

```
Chat Service    → publishes  → "workspace:events" channel
Task Service    → publishes  → "workspace:events" channel
Doc Service     → publishes  → "embed:queue" list (embedding worker)
Notif Service   → subscribes → "workspace:events" channel
Embed Worker    → consumes   → "embed:queue" list
```

### 14.5 WebSocket Rooms (Socket.io)

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

The embedding pipeline runs as a separate process to avoid blocking HTTP responses:

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

### 14.7 Caching Strategy

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

### 🟦 Phase 1 — Foundation (Week 1–2) — [STATUS: 100% COMPLETE & VERIFIED]
**Goal:** All services boot. Auth works end to end.

- [x] Set up monorepo folder structure
- [x] Initialize services (Express + TypeScript + Winston)
- [x] Docker Compose: MongoDB + Redis
- [x] Auth Service: register, login, JWT, refresh, logout
- [x] Workspace CRUD (create, invite, join)
- [x] API Gateway: routing + JWT middleware + rate limiting
- [x] React app (Vite + Tailwind CSS + Lucide Icons)
- [x] Login, Register, Workspace onboarding pages
- [x] Axios instance with auto token refresh interceptor
- [x] Protected routes

✅ **Checkpoint:** Register → create workspace → see dashboard. (VERIFIED)

---

### 🟦 Phase 2 — Document Ingestion (Week 3) — [STATUS: 100% COMPLETE & VERIFIED]
**Goal:** Upload documents, extract text, view them in-app.

- [x] Doc Service: upload endpoint with Multer (`POST /api/documents/upload`)
- [x] PDF text extraction (`pdf-parse`)
- [x] DOCX text extraction (`mammoth`)
- [x] Store file on Cloudinary (`image` asset type for PDFs, `raw` for DOCX)
- [x] Document library page (grid view with file type icons, search, filters)
- [x] In-app PDF viewer (`react-pdf` in-app modal with page controls & zoom)
- [x] Embedding status badge (`pending` / `indexed`)
- [x] Redis queue for embedding jobs (producer side `researchmind:embedding:jobs`)

✅ **Checkpoint:** Upload a PDF, see it in document library, text extracted and stored. (VERIFIED)

---

### 🟦 Phase 3 — RAG Pipeline (Week 4) — [STATUS: BACKEND 100% COMPLETE]
**Goal:** AI can answer questions from uploaded documents.

- [x] Set up Pinecone project + index (`researchmind`)
- [x] Embedding worker (consumes Redis queue `researchmind:embedding:jobs`)
- [x] Chunking algorithm with paragraph overlap
- [x] Voyage AI embedding API integration (`voyage-4`)
- [x] Upsert chunks to Pinecone with metadata & workspace namespace isolation
- [x] Vector delete on document delete (`deleteDocumentEmbeddings`)
- [x] `/ai/search` endpoint (Retrieval debugging endpoint)
- [x] `/ai/query` endpoint (Grok LLM prompt + SSE token streaming + source citations)
- [x] AI session logged to MongoDB (`AISession` model & persistence)
- [ ] Semantic search page with streaming answer + source citations (Frontend)

✅ **Checkpoint:** Upload 3 papers, ask "What models are compared?", get a grounded answer with citations.

---

### 🟦 Phase 4 — Meeting Summarizer + Task Creation (Week 5)
**Goal:** Paste meeting notes → structured summary → tasks auto-created.

- [ ] Task Service: board + task CRUD
- [ ] Bulk task creation endpoint
- [ ] `/ai/summarize-meeting` endpoint (structured output)
- [ ] Meeting Summarizer page: paste input → formatted output
- [ ] "Create tasks from action items" button
- [ ] Kanban board UI with @dnd-kit
- [ ] Task detail modal (assignee, due date, priority, subtasks)

✅ **Checkpoint:** Paste meeting notes, get structured summary, click to create tasks on board.

---

### 🟦 Phase 5 — AI Agent (Week 6)
**Goal:** Agent executes multi-step instructions.

- [ ] `/ai/agent` endpoint with ReAct loop
- [ ] All 8 agent tools implemented and wired to real services
- [ ] Agent step streaming (SSE)
- [ ] Agent UI: instruction input + step feed + final answer
- [ ] Test with: "Find all tasks due this week and summarize them"

✅ **Checkpoint:** Agent reads tasks, searches docs, creates new doc — all from one instruction.

---

### 🟦 Phase 6 — Literature Review Generator (Week 7)
**Goal:** Auto-generate a literature review from uploaded papers.

- [ ] `/ai/generate-review` endpoint
- [ ] Multi-pass generation (themes → sections → full review)
- [ ] Citation tracking (claim → source doc)
- [ ] Literature Review page with paper selection + streaming preview
- [ ] Save output as new document
- [ ] Export to PDF (html2pdf or puppeteer)

✅ **Checkpoint:** Select 5 papers, generate a formatted literature review with citations, export as PDF.

---

### 🟦 Phase 7 — Real-Time Chat (Week 8)
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

### 🟦 Phase 8 — Notifications + Dashboard (Week 9)
**Goal:** Smart notifications and progress visibility.

- [ ] Notification Service with Redis pub/sub subscriber
- [ ] In-app notification bell + unread count
- [ ] Real-time notification delivery via WebSocket
- [ ] Email notifications (Resend / Nodemailer)
- [ ] Progress dashboard: task chart, docs indexed count, AI usage stats
- [ ] New member onboarding summary (`/ai/onboard`)

✅ **Checkpoint:** Get notified on task assignment, see progress dashboard.

---

### 🟦 Phase 9 — Polish + Deploy (Week 10)
**Goal:** Production-ready, live, presentable.

- [ ] Loading states, error states, empty states throughout
- [ ] Mobile responsive layout
- [ ] Dark mode toggle
- [ ] GitHub Actions CI (lint + test)
- [ ] Deploy all services to Railway
- [ ] Deploy React to Vercel
- [ ] MongoDB Atlas + Upstash Redis + Pinecone Starter
- [ ] Write final README with architecture diagram
- [ ] Record 3-minute demo video
- [ ] Create demo workspace with sample data

✅ **Checkpoint:** Live URL, working demo credentials, impressive README.

---

## 17. Folder Structure

```
researchmind/
│
├── apps/
│   │
│   ├── client/                             ← React 18 + Vite
│   │   ├── public/
│   │   └── src/
│   │       ├── components/
│   │       │   ├── documents/
│   │       │   │   ├── DocumentCard.jsx
│   │       │   │   ├── DocumentLibrary.jsx
│   │       │   │   ├── UploadDropzone.jsx
│   │       │   │   └── PDFViewer.jsx
│   │       │   ├── ai/
│   │       │   │   ├── SemanticSearch.jsx
│   │       │   │   ├── AgentPage.jsx
│   │       │   │   ├── AgentStepFeed.jsx
│   │       │   │   ├── LiteratureReview.jsx
│   │       │   │   ├── MeetingSummarizer.jsx
│   │       │   │   └── StreamingText.jsx
│   │       │   ├── tasks/
│   │       │   │   ├── KanbanBoard.jsx
│   │       │   │   ├── TaskCard.jsx
│   │       │   │   └── TaskDetailModal.jsx
│   │       │   ├── chat/
│   │       │   │   ├── ChatChannel.jsx
│   │       │   │   ├── MessageItem.jsx
│   │       │   │   └── TypingIndicator.jsx
│   │       │   ├── dashboard/
│   │       │   │   └── ProgressDashboard.jsx
│   │       │   └── ui/                     ← shadcn/ui wrappers
│   │       ├── pages/
│   │       ├── stores/                     ← Zustand
│   │       ├── hooks/
│   │       │   ├── useAIStream.js
│   │       │   └── useSocket.js
│   │       ├── lib/
│   │       │   ├── axios.js                ← interceptors
│   │       │   └── socket.js               ← socket.io client
│   │       └── App.jsx
│   │
│   ├── api-gateway/                        ← Port 3000
│   │   └── src/
│   │       ├── middleware/
│   │       │   ├── auth.js
│   │       │   ├── rateLimiter.js
│   │       │   └── requestId.js
│   │       ├── routes/                     ← proxy definitions
│   │       └── index.js
│   │
│   ├── auth-service/                       ← Port 3001
│   │   └── src/
│   │       ├── controllers/
│   │       ├── models/
│   │       │   ├── User.js
│   │       │   └── Workspace.js
│   │       ├── routes/
│   │       ├── services/
│   │       │   ├── tokenService.js
│   │       │   └── emailService.js
│   │       └── index.js
│   │
│   ├── doc-service/                        ← Port 3002
│   │   └── src/
│   │       ├── controllers/
│   │       ├── models/
│   │       │   └── Document.js
│   │       ├── routes/
│   │       ├── extractors/
│   │       │   ├── pdfExtractor.js
│   │       │   ├── docxExtractor.js
│   │       │   └── mdExtractor.js
│   │       ├── workers/
│   │       │   └── embeddingWorker.js      ← background process
│   │       └── index.js
│   │
│   ├── chat-service/                       ← Port 3003
│   │   └── src/
│   │       ├── controllers/
│   │       ├── models/
│   │       ├── routes/
│   │       ├── sockets/
│   │       ├── pubsub/publisher.js
│   │       └── index.js
│   │
│   ├── task-service/                       ← Port 3004
│   │   └── src/
│   │       ├── controllers/
│   │       ├── models/
│   │       │   ├── Board.js
│   │       │   ├── Task.js
│   │       │   └── TaskActivity.js
│   │       ├── routes/
│   │       ├── pubsub/publisher.js
│   │       └── index.js
│   │
│   ├── ai-service/                         ← Port 3005
│   │   └── src/
│   │       ├── controllers/
│   │       │   ├── ragController.js        ← semantic search
│   │       │   ├── agentController.js      ← AI agent
│   │       │   ├── meetingController.js    ← meeting summarizer
│   │       │   ├── reviewController.js     ← literature review
│   │       │   └── draftController.js      ← report drafter
│   │       ├── routes/
│   │       ├── lib/
│   │       │   ├── pinecone.js             ← Pinecone client + helpers
│   │       │   ├── embeddings.js           ← Voyage AI
│   │       │   ├── claude.js               ← Anthropic client
│   │       │   └── chunker.js              ← text chunking
│   │       ├── agent/
│   │       │   ├── toolDefinitions.js
│   │       │   ├── toolExecutor.js
│   │       │   └── agentLoop.js
│   │       ├── prompts/
│   │       │   ├── systemPrompts.js
│   │       │   ├── ragPrompt.js
│   │       │   ├── agentPrompt.js
│   │       │   ├── meetingPrompt.js
│   │       │   └── reviewPrompt.js
│   │       └── index.js
│   │
│   └── notification-service/               ← Port 3006
│       └── src/
│           ├── models/Notification.js
│           ├── routes/
│           ├── pubsub/subscriber.js
│           ├── email/
│           │   ├── mailer.js
│           │   └── templates/
│           └── index.js
│
├── packages/
│   └── shared/
│       ├── constants.js                    ← event names, error codes
│       └── validators.js                   ← shared Joi schemas
│
├── docker-compose.yml
├── docker-compose.prod.yml
├── .env.example
├── .gitignore
├── .github/
│   └── workflows/ci.yml
└── README.md
```

---

## 18. Environment Variables

Copy `.env.example` into each service directory and fill in the values:

```env
# ── Common ────────────────────────────────────────────
NODE_ENV=development
PORT=3001

# ── MongoDB ───────────────────────────────────────────
MONGODB_URI=mongodb://localhost:27017/researchmind_auth
# (each service gets its own DB name)

# ── Redis ─────────────────────────────────────────────
REDIS_URL=redis://localhost:6379

# ── Auth Service ──────────────────────────────────────
JWT_SECRET=replace_with_64_char_random_string
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_SECRET=replace_with_another_64_char_random_string
REFRESH_TOKEN_EXPIRES_IN=7d
BCRYPT_ROUNDS=12

# ── Email (Auth + Notification Services) ──────────────
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=yourproject@gmail.com
SMTP_PASS=your_gmail_app_password
FROM_EMAIL=noreply@researchmind.dev
# OR use Resend: RESEND_API_KEY=re_...

# ── File Storage (Doc Service) ────────────────────────
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
MAX_FILE_SIZE_MB=20

# ── AI (AI Service) ───────────────────────────────────
ANTHROPIC_API_KEY=sk-ant-...
VOYAGE_API_KEY=pa-...                # for embeddings
PINECONE_API_KEY=pcsk-...
PINECONE_INDEX_NAME=researchmind
PINECONE_ENVIRONMENT=us-east-1-aws   # your index region

# ── API Gateway ───────────────────────────────────────
AUTH_SERVICE_URL=http://localhost:3001
DOC_SERVICE_URL=http://localhost:3002
CHAT_SERVICE_URL=http://localhost:3003
TASK_SERVICE_URL=http://localhost:3004
AI_SERVICE_URL=http://localhost:3005
NOTIFICATION_SERVICE_URL=http://localhost:3006
CLIENT_URL=http://localhost:5173
```

---

## 19. Local Development Setup

### Prerequisites
- Node.js 20 or higher
- Docker Desktop (for MongoDB + Redis)
- Pinecone account (free Starter plan)
- Anthropic API key
- Voyage AI API key (or OpenAI for embeddings)
- Cloudinary account (free tier)

### Step 1 — Clone the repository

```bash
git clone https://github.com/yourusername/researchmind.git
cd researchmind
```

### Step 2 — Install dependencies

```bash
# Install in all services at once
for dir in apps/*/; do
  echo "📦 Installing $dir"
  (cd "$dir" && npm install)
done
```

### Step 3 — Start infrastructure

```bash
docker-compose up -d mongodb redis
```

Verify they're running:
```bash
docker-compose ps
# mongodb   running   0.0.0.0:27017->27017/tcp
# redis     running   0.0.0.0:6379->6379/tcp
```

### Step 4 — Configure environment

```bash
# Copy example env to each service
for service in api-gateway auth-service doc-service chat-service task-service ai-service notification-service; do
  cp .env.example apps/$service/.env
  echo "✅ Created apps/$service/.env"
done
cp .env.example apps/client/.env
```

Edit each `.env` file with your actual API keys and credentials.

### Step 5 — Set up Pinecone index

```javascript
// Run once: scripts/setup-pinecone.js
const { Pinecone } = require('@pinecone-database/pinecone');
const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });

await pc.createIndex({
  name: 'researchmind',
  dimension: 1024,           // Voyage AI voyage-2 dimension
  metric: 'cosine',
  spec: { serverless: { cloud: 'aws', region: 'us-east-1' } }
});

console.log('Pinecone index created!');
```

```bash
node scripts/setup-pinecone.js
```

### Step 6 — Start all services

```bash
npm install -g concurrently

concurrently \
  "cd apps/api-gateway && npm run dev" \
  "cd apps/auth-service && npm run dev" \
  "cd apps/doc-service && npm run dev" \
  "cd apps/chat-service && npm run dev" \
  "cd apps/task-service && npm run dev" \
  "cd apps/ai-service && npm run dev" \
  "cd apps/notification-service && npm run dev" \
  "cd apps/client && npm run dev"
```

### Step 7 — Open the app

| Service | URL |
|---------|-----|
| **React App** | http://localhost:5173 |
| API Gateway | http://localhost:3000 |
| Auth Service | http://localhost:3001 |
| Doc Service | http://localhost:3002 |
| AI Service | http://localhost:3005 |

### Step 8 — Seed demo data (optional)

```bash
node scripts/seed-demo.js
# Creates: 1 workspace, 3 users, 5 sample documents, 4 tasks
# Demo login: demo@researchmind.dev / Demo1234!
```

---

## 20. Docker Setup

### docker-compose.yml

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

### Dockerfile (identical for all Node services)

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
# Start only infrastructure
docker-compose up -d mongodb redis

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

### Core Infrastructure
- [ ] API Gateway with JWT middleware and Redis rate limiting
- [ ] 6 microservices independently deployable
- [ ] Redis pub/sub event bus for cross-service communication
- [ ] Socket.io with Redis adapter for real-time
- [ ] MongoDB with proper indexes
- [ ] Docker Compose local orchestration

### Document Intelligence (RAG)
- [ ] PDF / DOCX / MD / TXT text extraction
- [ ] Chunking with overlap (paragraph-aware)
- [ ] Voyage AI embedding generation
- [ ] Pinecone upsert with workspace namespace
- [ ] Background embedding worker (Redis queue)
- [ ] Vector lifecycle: create / update / delete
- [ ] Semantic search endpoint with SSE streaming
- [ ] Source citation in search responses

### AI Agent
- [ ] ReAct agent loop with tool calling
- [ ] 8 tools: search, read doc, list docs, create task, list tasks, create doc, get members, post message
- [ ] Agent step streaming to client
- [ ] Agent session logged to MongoDB

### Specialized AI Features
- [ ] Meeting notes summarizer (structured output)
- [ ] Literature review generator (multi-pass)
- [ ] Report section drafter
- [ ] New member onboarding summary
- [ ] SSE streaming on all AI endpoints

### Application Features
- [ ] JWT auth with refresh token rotation
- [ ] Workspace creation and invite system
- [ ] Document library with embedding status
- [ ] Real-time team chat with channels
- [ ] Kanban task board with drag-and-drop
- [ ] Progress dashboard
- [ ] In-app + email notifications

### DevOps
- [ ] Dockerfiles per service
- [ ] GitHub Actions CI pipeline
- [ ] Deployed and accessible via public URL
- [ ] Demo credentials and seeded workspace
- [ ] Architecture diagram in README

---

*ResearchMind — where your project knowledge stops being scattered and starts being understood. 🎓🤖*
