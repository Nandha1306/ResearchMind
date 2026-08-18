import { Request, Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { checkWorkspaceMembership } from "../utils/workspace-checker";
import { semanticSearch } from "../services/query.service";

/** Controller handler for POST /api/ai/search semantic search requests. */
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
