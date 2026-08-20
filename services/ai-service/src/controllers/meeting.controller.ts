import { Response } from "express";
import { asyncHandler } from "../../../../packages/shared/errors/asyncHandler";
import { AuthRequest } from "../../../auth-service/src/middlewares/auth.middleware";
import { generateMeetingSummary } from "../services/meeting-summarizer.service";

export const summarizeMeeting = asyncHandler(
  async (req: AuthRequest, res: Response) => {
    const { text } = req.body;

    const summary = await generateMeetingSummary(text);

    res.status(200).json({
      success: true,
      data: summary,
    });
  }
);