import { Request, Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { checkWorkspaceMembership } from "../utils/workspace-checker";
import { semanticSearch } from "../services/query.service";
import { runRagStreamQuery, RagEventType } from "../services/rag.service";
import { getWorkspaceAiSessions } from "../services/ai-session.service";

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

    const chunks = await semanticSearch({
      workspaceId,
      query,
      topK,
    });

    return res.status(200).json({
      success: true,
      data: chunks,
    });
  }
);

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

    const emitEvent = (event: RagEventType, data: any) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await runRagStreamQuery({
        workspaceId,
        userId,
        query,
        topK,
        emitEvent,
      });
    } catch (err: any) {
      // Last-resort guard. runRagStreamQuery emits its own typed error events;
      // anything reaching here is unexpected, so log it server-side and send a
      // fixed message — never `err.message`, which can carry provider payloads,
      // connection strings or stack detail.
      console.error("RAG stream handler error:", err);
      emitEvent("error", {
        message: "AI service is temporarily unavailable. Please try again.",
        partial: false,
      });
    } finally {
      res.end();
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

    const sessions = await getWorkspaceAiSessions(workspaceId);
    return res.status(200).json({
      success: true,
      data: sessions,
    });
  }
);
