import { SSEStreamParser } from "./sse";
import type { AISource, AIStreamEvent } from "./sse";

/**
 * How an AI answer stream ended (P1-A21). Only `done` is a complete answer.
 *  - done:       the server sent its terminal success event
 *  - error:      the server sent its terminal error event
 *  - incomplete: the connection closed with no terminal event (server crash,
 *                proxy cut, network drop) -- whatever arrived is partial
 */
export type AiStreamOutcome =
  | { kind: "done"; sessionId: string; unverifiedCitations: number[] }
  | { kind: "error"; message: string; partial: boolean }
  | { kind: "incomplete"; receivedText: boolean };

export interface AiStreamHandlers {
  onToken(text: string): void;
  onSources(sources: AISource[]): void;
}

export const INCOMPLETE_STREAM_MESSAGE =
  "The connection was lost before the answer finished, so it is incomplete. Please try again.";

export const STOPPED_STREAM_MESSAGE = "You stopped the answer before it finished.";

/**
 * Read an SSE answer stream to its end.
 *
 * Handles chunk boundaries anywhere (inside an event, a JSON payload or a
 * multi-byte character), several events per chunk and empty chunks. Events
 * after a terminal event are ignored, so nothing is appended to a finished
 * answer. `isCurrent` lets the caller stop listening once a newer request has
 * replaced this one: the reader is cancelled and `null` is returned, and no
 * handler is called after that point.
 */
export const readAiStream = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handlers: AiStreamHandlers,
  isCurrent: () => boolean = () => true
): Promise<AiStreamOutcome | null> => {
  const parser = new SSEStreamParser();
  const decoder = new TextDecoder();
  let terminal: AiStreamOutcome | null = null;
  let receivedText = false;

  const apply = (events: AIStreamEvent[]) => {
    for (const event of events) {
      if (terminal) return;
      switch (event.type) {
        case "token":
          if (event.text) {
            receivedText = true;
            handlers.onToken(event.text);
          }
          break;
        case "sources":
          handlers.onSources(event.sources || []);
          break;
        case "done":
          terminal = {
            kind: "done",
            sessionId: event.sessionId,
            unverifiedCitations: event.unverifiedCitations,
          };
          break;
        case "error":
          terminal = { kind: "error", message: event.message, partial: event.partial };
          break;
        default:
          break;
      }
    }
  };

  while (!terminal) {
    const { done, value } = await reader.read();
    if (!isCurrent()) {
      reader.cancel().catch(() => undefined);
      return null;
    }
    if (done) break;
    if (value && value.length > 0) {
      apply(parser.push(decoder.decode(value, { stream: true })));
    }
  }

  if (terminal) {
    // Nothing after the terminal event matters; release the connection.
    reader.cancel().catch(() => undefined);
    return terminal;
  }

  // Stream closed: flush a trailing partial character and a final event that
  // was not followed by a blank line.
  apply(parser.push(decoder.decode()));
  apply(parser.flush());

  return terminal ?? { kind: "incomplete", receivedText };
};
