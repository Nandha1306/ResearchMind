import { AppError } from "../../../../packages/shared/errors/AppError";

/**
 * The only LLM-failure message that is ever sent to a client.
 *
 * Provider messages, stack traces, request URLs and key material must never
 * reach the response body — they are logged server-side instead.
 */
export const LLM_UNAVAILABLE_MESSAGE =
  "AI service is temporarily unavailable. Please try again.";

/** Why the LLM call could not produce a usable answer (server-side only). */
export type LlmFailureReason =
  | "request_failed"
  | "timeout"
  | "empty_content"
  | "malformed_content"
  | "stream_interrupted";

/**
 * Raised whenever the LLM provider fails, times out, or returns output that
 * cannot be used as an answer.
 *
 * Extends AppError so the shared errorMiddleware renders it as
 * `{ success: false, message }` with HTTP 502 for non-streaming endpoints.
 * The public `message` is deliberately generic; `reason` and `cause` are for
 * server logs only and must not be serialised into a response.
 */
export class LlmUnavailableError extends AppError {
  public readonly reason: LlmFailureReason;
  public readonly cause?: unknown;

  /**
   * Tokens already streamed to the client before the failure occurred.
   * Callers use this to tell the client its partial text is incomplete.
   */
  public readonly partialAnswer: string;

  constructor(
    reason: LlmFailureReason,
    options: { cause?: unknown; partialAnswer?: string } = {}
  ) {
    super(LLM_UNAVAILABLE_MESSAGE, 502);

    this.name = "LlmUnavailableError";
    this.reason = reason;
    this.cause = options.cause;
    this.partialAnswer = options.partialAnswer ?? "";
  }
}

/** Type guard for LLM failures raised anywhere in the AI pipeline. */
export const isLlmUnavailableError = (
  error: unknown
): error is LlmUnavailableError => error instanceof LlmUnavailableError;

/**
 * Log an LLM failure with enough detail to debug, without echoing the provider
 * payload (which can contain the Authorization header on some SDK errors).
 */
export const logLlmFailure = (
  operation: string,
  reason: LlmFailureReason,
  error?: unknown
): void => {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");

  console.error(
    `[ai-service] LLM ${operation} failed (reason=${reason})${detail ? ` :: ${detail}` : ""}`
  );
};
