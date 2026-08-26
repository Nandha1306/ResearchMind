import { grokClient, XAI_MODEL } from "../config/grok";
import {
  LlmUnavailableError,
  logLlmFailure,
} from "../errors/llm.error";

/** Hard ceiling for a single LLM request (ms). */
const LLM_REQUEST_TIMEOUT_MS = Number(
  process.env.LLM_REQUEST_TIMEOUT_MS || 60_000
);

/**
 * Maximum gap between two streamed tokens (ms).
 *
 * The provider SDK timeout only covers establishing the response, so a stream
 * that stalls half-way would otherwise hang the SSE connection forever.
 */
const LLM_STREAM_IDLE_TIMEOUT_MS = Number(
  process.env.LLM_STREAM_IDLE_TIMEOUT_MS || 30_000
);

/** Detect an aborted/timed-out provider request across SDK error shapes. */
const isTimeout = (error: unknown): boolean => {
  const err = error as { name?: string; message?: string; status?: number } | null;

  return (
    err?.name === "AbortError" ||
    err?.name === "APIConnectionTimeoutError" ||
    err?.status === 408 ||
    err?.status === 504 ||
    (typeof err?.message === "string" &&
      /timeout|timed out|aborted/i.test(err.message))
  );
};

/**
 * Generate a complete non-streaming response from the configured LLM.
 *
 * Throws LlmUnavailableError on any provider failure, timeout, or unusable
 * output. It never substitutes generated-looking text for a failed request.
 */
export const generateGrokResponse = async (
  systemPrompt: string,
  userPrompt: string
): Promise<string> => {
  let response;

  try {
    response = await grokClient.chat.completions.create(
      {
        model: XAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1500,
      },
      { timeout: LLM_REQUEST_TIMEOUT_MS }
    );
  } catch (error) {
    const reason = isTimeout(error) ? "timeout" : "request_failed";
    logLlmFailure("completion", reason, error);
    throw new LlmUnavailableError(reason, { cause: error });
  }

  const content = response?.choices?.[0]?.message?.content;

  // A structurally valid response with no usable text is still a failure —
  // returning "" here would surface as a blank but "successful" answer.
  if (typeof content !== "string") {
    logLlmFailure("completion", "malformed_content");
    throw new LlmUnavailableError("malformed_content");
  }

  if (!content.trim()) {
    logLlmFailure("completion", "empty_content");
    throw new LlmUnavailableError("empty_content");
  }

  return content;
};

/**
 * Stream an answer from the configured LLM, invoking `onToken` per delta.
 *
 * Throws LlmUnavailableError if the stream cannot be opened, stalls, breaks
 * mid-flight, or yields no content. When it breaks after tokens were already
 * delivered, `partialAnswer` carries what the client has so the caller can
 * tell it the text is incomplete.
 */
export const streamGrokResponse = async (
  systemPrompt: string,
  userPrompt: string,
  onToken: (token: string) => void
): Promise<string> => {
  const abortController = new AbortController();
  let idleTimer: NodeJS.Timeout | undefined;
  let idleTimedOut = false;

  const armIdleWatchdog = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      abortController.abort();
    }, LLM_STREAM_IDLE_TIMEOUT_MS);
  };

  let stream;

  try {
    armIdleWatchdog();

    stream = await grokClient.chat.completions.create(
      {
        model: XAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1500,
        stream: true,
      },
      { timeout: LLM_REQUEST_TIMEOUT_MS, signal: abortController.signal }
    );
  } catch (error) {
    if (idleTimer) clearTimeout(idleTimer);
    const reason = idleTimedOut || isTimeout(error) ? "timeout" : "request_failed";
    logLlmFailure("stream open", reason, error);
    throw new LlmUnavailableError(reason, { cause: error });
  }

  let fullAnswer = "";

  try {
    for await (const chunk of stream) {
      const textDelta = chunk.choices?.[0]?.delta?.content;

      if (textDelta) {
        armIdleWatchdog();
        fullAnswer += textDelta;
        onToken(textDelta);
      }
    }
  } catch (error) {
    const reason = idleTimedOut || isTimeout(error) ? "timeout" : "stream_interrupted";
    logLlmFailure("stream", reason, error);
    throw new LlmUnavailableError(reason, {
      cause: error,
      partialAnswer: fullAnswer,
    });
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
  }

  if (!fullAnswer.trim()) {
    logLlmFailure("stream", "empty_content");
    throw new LlmUnavailableError("empty_content");
  }

  return fullAnswer;
};
