import { z } from "zod";

export const semanticSearchSchema = z.object({
  workspaceId: z.string().min(1, "Workspace ID is required"),
  query: z.string().min(1, "Search query is required"),
  topK: z.number().int().min(1).max(20).optional().default(5),
});

export const ragQuerySchema = z.object({
  workspaceId: z.string().min(1, "Workspace ID is required"),
  query: z.string().min(1, "Question query is required"),
  topK: z.number().int().min(1).max(20).optional().default(5),
  sessionId: z.string().optional(),
});

export const summarizeMeetingSchema = z.object({
  workspaceId: z.string().min(1, "Workspace ID is required"),
  text: z
    .string()
    .trim()
    .min(10, "Meeting notes must contain at least 10 characters")
    .max(50000, "Meeting notes cannot exceed 50000 characters"),
});

export const meetingSummarySchema = z.object({
  meeting_date: z.string(),
  attendees: z.array(z.string()),
  summary: z.string(),
  decisions: z.array(z.string()),
  action_items: z.array(
    z.object({
      task: z.string(),
      assignee: z.string(),
      due: z.string(),
    })
  ),
  open_questions: z.array(z.string()),
  next_meeting: z.string(),
});
