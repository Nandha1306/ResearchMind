import { grokClient, XAI_MODEL } from "../config/grok";
import { timeouts } from "../config/timeouts";
import {
  LlmUnavailableError,
  logLlmFailure,
} from "../errors/llm.error";

/**
 * Hard ceiling for a single LLM request (ms), and the maximum gap between two
 * streamed tokens (ms): the provider SDK timeout only covers establishing the
 * response, so a stream that stalls half-way would otherwise hang the SSE
 * connection forever. Both are parsed with bounds and safe defaults
 * (config/timeouts.ts): a non-numeric value used to make every call fail at
 * once (ARC-013).
 */
const LLM_REQUEST_TIMEOUT_MS = timeouts.llmRequestMs();
const LLM_STREAM_IDLE_TIMEOUT_MS = timeouts.llmStreamIdleMs();

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

/** The caller's signal was aborted (the client left); not an LLM failure. */
export class ClientDisconnectedError extends Error {
  constructor() {
    super("The client disconnected; generation was stopped");
    this.name = "ClientDisconnectedError";
  }
}

/**
 * Stream an answer from the configured LLM, invoking `onToken` per delta.
 *
 * Throws LlmUnavailableError if the stream cannot be opened, stalls, breaks
 * mid-flight, or yields no content. When it breaks after tokens were already
 * delivered, `partialAnswer` carries what the client has so the caller can
 * tell it the text is incomplete. Throws ClientDisconnectedError when
 * `signal` is aborted (ISS-015); the provider request is aborted with it.
 */
export const streamGrokResponse = async (
  systemPrompt: string,
  userPrompt: string,
  onToken: (token: string) => void,
  { signal }: { signal?: AbortSignal } = {}
): Promise<string> => {
  const abortController = new AbortController();
  let idleTimer: NodeJS.Timeout | undefined;
  let idleTimedOut = false;

  // ISS-015: the caller's signal (client disconnect) aborts the provider
  // request too. Such an abort is not an LLM failure and is not logged as one.
  if (signal?.aborted) throw new ClientDisconnectedError();
  const onCallerAbort = () => abortController.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const callerAborted = () => signal?.aborted === true;

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
    signal?.removeEventListener("abort", onCallerAbort);
    if (callerAborted()) throw new ClientDisconnectedError();
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
    if (callerAborted()) throw new ClientDisconnectedError();
    const reason = idleTimedOut || isTimeout(error) ? "timeout" : "stream_interrupted";
    logLlmFailure("stream", reason, error);
    throw new LlmUnavailableError(reason, {
      cause: error,
      partialAnswer: fullAnswer,
    });
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    signal?.removeEventListener("abort", onCallerAbort);
  }

  if (callerAborted()) throw new ClientDisconnectedError();

  if (!fullAnswer.trim()) {
    logLlmFailure("stream", "empty_content");
    throw new LlmUnavailableError("empty_content");
  }

  return fullAnswer;
};
