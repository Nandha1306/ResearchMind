import { grokClient, XAI_MODEL } from "../config/grok";
import {
  MeetingSummary,
} from "../types/meeting.types";
import {
  meetingSummarySchema,
} from "../../../../packages/validation/schemas/ai.schema";

const MEETING_SUMMARY_SYSTEM_PROMPT = `
You are ResearchMind's meeting summarization engine.

Analyze the provided meeting notes and return a structured JSON object.

The response MUST contain exactly these fields:

{
  "meeting_date": "string",
  "attendees": ["string"],
  "summary": "string",
  "decisions": ["string"],
  "action_items": [
    {
      "task": "string",
      "assignee": "string",
      "due": "string"
    }
  ],
  "open_questions": ["string"],
  "next_meeting": "string"
}

Rules:

1. Extract information ONLY from the provided meeting notes.
2. Do NOT invent attendees, decisions, dates, action items, or other facts.
3. If the meeting date is not mentioned, return an empty string.
4. If attendees are not mentioned, return an empty array.
5. If there are no decisions, return an empty array.
6. If there are no action items, return an empty array.
7. If an action item has no assignee, return an empty string for "assignee".
8. If an action item has no due date, return an empty string for "due".
9. If there are no open questions, return an empty array.
10. If the next meeting is not mentioned, return an empty string.
11. Preserve names as they appear in the notes.
12. Do NOT convert names into user IDs.
13. Do NOT create task IDs, workspace IDs, board IDs, or database IDs.
14. Do NOT add fields that are not specified above.
15. Return valid JSON only.
16. Do not wrap the JSON in Markdown code fences.
17. Do not include explanations before or after the JSON.
`;

/**
 * Extract textual content from an OpenAI-compatible response.
 *
 * This intentionally handles the normal Chat Completions response shape
 * without assuming any custom response format from the Grok client.
 */
const extractResponseContent = (response: any): string => {
  const content = response?.choices?.[0]?.message?.content;

  if (typeof content !== "string" || !content.trim()) {
    throw new Error(
      "Grok returned an empty meeting summary response"
    );
  }

  return content.trim();
};

/**
 * Remove accidental Markdown JSON fences if the model returns them
 * despite being instructed not to.
 */
const cleanJsonResponse = (content: string): string => {
  return content
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
};

/**
 * Generate a structured meeting summary using Grok.
 *
 * Flow:
 *
 * Meeting notes
 *      ↓
 * Grok
 *      ↓
 * JSON response
 *      ↓
 * JSON.parse()
 *      ↓
 * Zod validation
 *      ↓
 * MeetingSummary
 */
export const generateMeetingSummary = async (
  text: string
): Promise<MeetingSummary> => {
  const normalizedText = text.trim();

  if (!normalizedText) {
    throw new Error(
      "Meeting notes cannot be empty"
    );
  }

  try {
    const response =
      await grokClient.chat.completions.create({
        model: XAI_MODEL,

        messages: [
          {
            role: "system",
            content:
              MEETING_SUMMARY_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: `
MEETING NOTES

${normalizedText}
`,
          },
        ],

        temperature: 0.2,
      });

    const rawContent =
      extractResponseContent(response);

    const cleanedContent =
      cleanJsonResponse(rawContent);

    let parsed: unknown;

    try {
      parsed = JSON.parse(cleanedContent);
    } catch {
      throw new Error(
        "Grok returned invalid JSON for meeting summary"
      );
    }

    const validationResult =
      meetingSummarySchema.safeParse(parsed);

    if (!validationResult.success) {
      console.error(
        "Invalid meeting summary returned by Grok:",
        validationResult.error.flatten()
      );

      throw new Error(
        "Grok returned an invalid meeting summary structure"
      );
    }

    return validationResult.data;
  } catch (error) {
    if (
      error instanceof Error &&
      (
        error.message.includes(
          "Meeting notes cannot be empty"
        ) ||
        error.message.includes(
          "Grok returned"
        )
      )
    ) {
      throw error;
    }

    console.error(
      "Meeting summarization failed:",
      error
    );

    throw new Error(
      "Failed to generate meeting summary"
    );
  }
};