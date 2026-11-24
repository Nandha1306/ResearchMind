import { Request, Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { checkWorkspaceMembership } from "../utils/workspace-checker";
import { timeouts } from "../config/timeouts";
import { semanticSearch } from "../services/query.service";
import { runRagStreamQuery, RagEventType, RETRIEVAL_UNAVAILABLE_MESSAGE } from "../services/rag.service";
import { AppError } from "../../../../packages/shared/errors/AppError";
import {
  AI_SESSION_PAGE_DEFAULT,
  AI_SESSION_PAGE_MAX,
  getWorkspaceAiSessions,
  redactDeletedSources,
} from "../services/ai-session.service";
import { parseListPage } from "../../../../packages/shared/http/list-page";
import { fetchLiveDocumentIds } from "../services/document-status.service";
import { describeErrorForLog } from "../../../../packages/shared/errors/safe-error";

/** Controller handler for POST /api/ai/search semantic search requests (Retrieval Debug Endpoint). */
export const searchHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { workspaceId, query, topK } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const isMember = await checkWorkspaceMembership(
      workspaceId,
      userId,
      req.headers.authorization
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this workspace.",
      });
    }

    /*
     * RT-011: a provider failure (Voyage, Pinecone, the live-documents check)
     * is a 502 with the same message as the answer stream, not a generic 500.
     * The detail goes to the log, redacted (RT-007).
     */
    let chunks;
    try {
      chunks = await semanticSearch({
        workspaceId,
        query,
        topK,
      });
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error("[ai-service] Search retrieval failed:", describeErrorForLog(err));
      throw new AppError(RETRIEVAL_UNAVAILABLE_MESSAGE, 502);
    }

    return res.status(200).json({
      success: true,
      data: chunks,
    });
  }
);

/**
 * The RAG stream runner. A property (not a direct call) so tests can replace
 * it with a slow fake; production always uses runRagStreamQuery.
 */
export const ragStream = { run: runRagStreamQuery };

/** Controller handler for POST /api/ai/query SSE streaming RAG Q&A requests. */
export const queryStreamHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const { workspaceId, query, topK } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const isMember = await checkWorkspaceMembership(
      workspaceId,
      userId,
      req.headers.authorization
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this workspace.",
      });
    }

    // Set Server-Sent Events headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");

    /*
     * Client disconnect (ISS-015): when the response closes before the answer
     * is finished, abort generation. The signal reaches the LLM request, no
     * further event is written, and no session is saved -- a partial answer
     * is never persisted. The `res` close event is used, not `req`: the
     * request's close fires as soon as its body has been read.
     */
    const disconnect = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) disconnect.abort();
    });

    const emitEvent = (event: RagEventType, data: any) => {
      if (disconnect.signal.aborted || res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    /*
     * Heartbeat (ISS-037): an SSE comment frame every SSE_HEARTBEAT_MS while
     * the answer is being prepared or streamed, so proxies and clients do not
     * close an idle connection during slow retrieval or generation. Comment
     * lines (": ...") are ignored by SSE parsers, including the frontend's.
     */
    res.flushHeaders?.();
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(": ping\n\n");
    }, timeouts.sseHeartbeatMs());
    const stopHeartbeat = () => clearInterval(heartbeat);
    res.once("close", stopHeartbeat);

    try {
      await ragStream.run({
        workspaceId,
        userId,
        query,
        topK,
        emitEvent,
        signal: disconnect.signal,
      });
    } catch (err: any) {
      // Last-resort guard. runRagStreamQuery emits its own typed error events;
      // anything reaching here is unexpected, so log it server-side and send a
      // fixed message — never `err.message`, which can carry provider payloads,
      // connection strings or stack detail.
      console.error("RAG stream handler error:", describeErrorForLog(err));
      emitEvent("error", {
        message: "AI service is temporarily unavailable. Please try again.",
        partial: false,
      });
    } finally {
      stopHeartbeat();
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  }
);

/** Controller handler for GET /api/ai/sessions/workspace/:workspaceId requests. */
export const getSessionsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = (req as any).user?.userId || (req as any).user?.id;
    const workspaceId = req.params.workspaceId as string;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const isMember = await checkWorkspaceMembership(
      workspaceId,
      userId,
      req.headers.authorization
    );

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: "Access denied. You are not a member of this workspace.",
      });
    }

    // SEC-023: only the caller's own sessions, cursor-paged (default 20, cap 100).
    const page = parseListPage(req.query as Record<string, unknown>, {
      defaultLimit: AI_SESSION_PAGE_DEFAULT,
      maxLimit: AI_SESSION_PAGE_MAX,
    });
    const { data: sessions, meta } = await getWorkspaceAiSessions(workspaceId, String(userId), page);
    // Sources citing deleted documents are redacted in place (SEC-012).
    const data = await redactDeletedSources(sessions as any[], workspaceId, fetchLiveDocumentIds);
    return res.status(200).json({
      success: true,
      data,
      meta,
    });
  }
);
