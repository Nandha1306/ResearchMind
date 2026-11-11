import { z } from "zod";

const workspaceIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, "Invalid workspace ID");

/** Questions are trimmed; whitespace-only or oversized queries are rejected. */
export const MAX_QUERY_LENGTH = 2000;

/** Must match the retrieval clamp in ai-service (query.service MAX_TOP_K). */
export const MAX_TOP_K = 10;

const querySchema = (requiredMessage: string) =>
  z
    .string()
    .trim()
    .min(1, requiredMessage)
    .max(MAX_QUERY_LENGTH, `Query cannot exceed ${MAX_QUERY_LENGTH} characters`);

const topKSchema = z.number().int().min(1).max(MAX_TOP_K).optional().default(5);

export const semanticSearchSchema = z.object({
  workspaceId: workspaceIdSchema,
  query: querySchema("Search query is required"),
  topK: topKSchema,
});

export const ragQuerySchema = z.object({
  workspaceId: workspaceIdSchema,
  query: querySchema("Question query is required"),
  topK: topKSchema,
  sessionId: z.string().max(100).optional(),
});

export const summarizeMeetingSchema = z.object({
  workspaceId: workspaceIdSchema,
  text: z
    .string()
    .trim()
    .min(10, "Meeting notes must contain at least 10 characters")
    .max(50000, "Meeting notes cannot exceed 50000 characters"),
});

/*
 * Model output for a meeting summary. LLMs routinely emit `null` for unknown
 * fields, omit empty lists or add extra keys; those are normalised (null ->
 * "" / [], extra keys dropped, empty action items removed) instead of failing
 * the whole summary. Wrong TYPES (e.g. an object where text is expected) are
 * still rejected.
 */
const modelText = z
  .string()
  .nullish()
  .transform((value) => (value ?? "").trim());

const modelTextList = z
  .array(z.string().nullish())
  .nullish()
  .transform((list) =>
    (list ?? []).map((item) => (item ?? "").trim()).filter((item) => item.length > 0)
  );

export const meetingSummarySchema = z.object({
  meeting_date: modelText,
  attendees: modelTextList,
  summary: modelText,
  decisions: modelTextList,
  action_items: z
    .array(
      z.object({
        task: modelText,
        assignee: modelText,
        due: modelText,
      })
    )
    .nullish()
    .transform((items) => (items ?? []).filter((item) => item.task.length > 0)),
  open_questions: modelTextList,
  next_meeting: modelText,
});
