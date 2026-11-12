# 4. Phase 3 RAG Pipeline (Voyage AI, Pinecone Namespaces, Groq/xAI LLM, SSE & MongoDB AISession)

* **Status**: Accepted
* **Date**: 2026-08-18

> **Status note (2026-11-11, documentation audit):** parts of this record no
> longer match the implementation:
> - The default embedding model is `voyage-3` (1024 dimensions), configurable
>   with `VOYAGE_MODEL` / `VOYAGE_EMBEDDING_DIMENSION`; not `voyage-4`.
> - Workspace membership is checked by each service (ai-service included)
>   against workspace-service, not by the API gateway.
> - The "33-phase end-to-end automated test suite" claim is not supported by
>   the repository. The actual automated tests are described in
>   [testing](../testing.md); the RAG path is unit/integration tested with
>   provider calls replaced, and was not verified against live Voyage,
>   Pinecone or Groq/xAI accounts.
> See [documents and AI pipeline](../architecture/documents-and-ai.md).

## Context and Problem Statement

ResearchMind requires a high-performance Retrieval-Augmented Generation (RAG) pipeline to allow student engineering teams to perform semantic vector searches and receive grounded token-streamed answers with document source citations. The pipeline must guarantee zero cross-workspace data leakage in a multi-tenant environment.

## Decision Drivers

* **Multi-Tenant Isolation**: Workspace documents and vector embeddings must be strictly isolated.
* **Retrieval Quality**: High-precision 1024-dimension vector embeddings using Voyage AI (`voyage-4`).
* **Real-time UX**: Low-latency token streaming to the frontend via Server-Sent Events (SSE).
* **Auditability & Persistence**: Full interaction logging (query, answer, sources, user ID, workspace ID) in MongoDB (`researchmind_ai`).
* **Debugging**: Preserving `POST /api/ai/search` as a pure vector retrieval debugging endpoint independent of `POST /api/ai/query`.

## Considered Options

1. Single Pinecone namespace with metadata filter (`workspaceId == ...`).
2. Dedicated Pinecone namespaces per workspace (`namespace: workspaceId`).
3. WebSockets vs Server-Sent Events (SSE) for token streaming.

## Decision Outcome

Chosen option: **Option 2 (Pinecone Namespaces) + Server-Sent Events (SSE)**.

### Architectural Blueprint:

1. **Embedding & Vector Storage**:
   - Background worker processes jobs from Redis queue `researchmind:embedding:jobs`.
   - Voyage AI (`voyage-4`, 1024 dims) generates embeddings for document chunks.
   - Embeddings and metadata are stored in Pinecone under `namespace = workspaceId`.

2. **Query Processing & Streaming (`POST /api/ai/query`)**:
   - API Gateway verifies JWT authentication and validates workspace membership via Workspace Service (`:5002`).
   - Query vectorized with Voyage AI `embedQuery()`.
   - Pinecone searches top-K vector chunks within `namespace(workspaceId)`.
   - RAG Context Builder constructs structured context with `[Source N]` references.
   - High-speed LLM (Groq / xAI) streams token deltas using Server-Sent Events (`Content-Type: text/event-stream`).
   - Event protocol sequence: `start` $\rightarrow$ `sources` $\rightarrow$ `token` $\rightarrow$ `done`.

3. **Session Persistence**:
   - Completed Q&A sessions are persisted to MongoDB collection `aisessions` in `researchmind_ai`.

## Consequences

* **Positive**: Strict tenant isolation enforced at both the API Gateway/Workspace Membership level and Pinecone namespace level.
* **Positive**: SSE provides lightweight, unidirectional streaming over standard HTTP without WebSocket overhead.
* **Positive**: Complete compliance verified by 33-phase end-to-end automated test suite.
