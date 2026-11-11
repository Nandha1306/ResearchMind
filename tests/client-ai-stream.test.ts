import assert from "node:assert";
import { test, describe } from "node:test";
import {
  readAiStream,
  type AiStreamOutcome,
} from "../frontend/src/utils/ai-stream.ts";

/*
 * P1-A21 -- reading the AI answer stream. UNIT tests of the real frontend
 * reader with fake ReadableStream readers; the SSE wire format is the one
 * ai-service writes (query.controller emitEvent).
 */

const encoder = new TextEncoder();
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A reader that yields the given chunks (strings or raw bytes), then ends. */
const fakeReader = (chunks: Array<string | Uint8Array>, opts: { failWith?: Error } = {}) => {
  let i = 0;
  let cancelled = false;
  const reader = {
    read: async () => {
      if (i < chunks.length) {
        const c = chunks[i++];
        return { done: false, value: typeof c === "string" ? encoder.encode(c) : c };
      }
      if (opts.failWith) throw opts.failWith;
      return { done: true, value: undefined };
    },
    cancel: async () => {
      cancelled = true;
    },
  };
  return { reader: reader as unknown as ReadableStreamDefaultReader<Uint8Array>, wasCancelled: () => cancelled };
};

const run = async (chunks: Array<string | Uint8Array>, isCurrent?: () => boolean) => {
  const tokens: string[] = [];
  const sources: unknown[] = [];
  const { reader, wasCancelled } = fakeReader(chunks);
  const outcome = await readAiStream(
    reader,
    { onToken: (t) => tokens.push(t), onSources: (s) => sources.push(s) },
    isCurrent
  );
  return { outcome, answer: tokens.join(""), tokens, sources, wasCancelled };
};

const DONE = sse("done", { sessionId: "s-1", unverifiedCitations: [] });

describe("readAiStream (frontend/src/utils/ai-stream.ts)", () => {
  test("normal completion: tokens, sources and the done event", async () => {
    const r = await run([
      sse("start", { query: "q" }),
      sse("sources", { sources: [{ documentId: "d", chunkIndex: 0, score: 0.9, fileType: "pdf" }] }),
      sse("token", { text: "Hello" }),
      sse("token", { text: " world [Source 1]" }),
      DONE,
    ]);
    assert.deepStrictEqual(r.outcome, { kind: "done", sessionId: "s-1", unverifiedCitations: [] });
    assert.strictEqual(r.answer, "Hello world [Source 1]");
    assert.strictEqual(r.sources.length, 1, "citations metadata preserved");
  });

  test("fragmented chunks: events split mid-line and mid-JSON are reassembled", async () => {
    const whole = sse("token", { text: "split" }) + sse("token", { text: " answer" }) + DONE;
    const pieces = whole.match(/.{1,7}/gs)!; // 7-char fragments
    const r = await run(pieces);
    assert.strictEqual(r.answer, "split answer");
    assert.strictEqual(r.outcome?.kind, "done");
  });

  test("a multi-byte character split across chunks is not corrupted", async () => {
    const bytes = encoder.encode(sse("token", { text: "naïve — ✓" }) + DONE);
    const cut = bytes.indexOf(0xe2) + 1; // inside the 3-byte "—"
    const r = await run([bytes.slice(0, cut), bytes.slice(cut)]);
    assert.strictEqual(r.answer, "naïve — ✓");
  });

  test("several events in one chunk, and empty chunks, are handled", async () => {
    const r = await run(["", sse("token", { text: "a" }) + sse("token", { text: "b" }), new Uint8Array(0), DONE]);
    assert.strictEqual(r.answer, "ab");
    assert.deepStrictEqual(r.tokens, ["a", "b"], "no duplicated chunks");
  });

  test("server error event: terminal failure with its message and partial flag", async () => {
    const r = await run([sse("token", { text: "par" }), sse("error", { message: "LLM timed out", partial: true })]);
    assert.deepStrictEqual(r.outcome, { kind: "error", message: "LLM timed out", partial: true });
  });

  test("abnormal termination: stream ends without done/error -> incomplete, never complete", async () => {
    const r = await run([sse("token", { text: "half an ans" })]);
    assert.deepStrictEqual(r.outcome, { kind: "incomplete", receivedText: true });

    const empty = await run([]);
    assert.deepStrictEqual(empty.outcome, { kind: "incomplete", receivedText: false });
  });

  test("a final event without a trailing blank line is still read (flush)", async () => {
    const r = await run([sse("token", { text: "x" }), DONE.trimEnd()]);
    assert.strictEqual(r.outcome?.kind, "done");
  });

  test("malformed events are skipped safely, the stream continues", async () => {
    const r = await run(["event: token\ndata: {not json\n\n", sse("token", { text: "ok" }), DONE]);
    assert.strictEqual(r.answer, "ok");
    assert.strictEqual(r.outcome?.kind, "done");
  });

  test("nothing after a terminal event is applied", async () => {
    const r = await run([sse("token", { text: "final" }), DONE, sse("token", { text: " EXTRA" })]);
    assert.strictEqual(r.answer, "final");
    assert.ok(r.wasCancelled(), "connection released after the terminal event");
  });

  test("superseded (a newer query started): returns null, cancels the reader, no more callbacks", async () => {
    let current = true;
    const tokens: string[] = [];
    const chunks = [sse("token", { text: "old-1" }), sse("token", { text: "old-2" }), DONE];
    const { reader, wasCancelled } = fakeReader(chunks);
    const outcome: AiStreamOutcome | null = await readAiStream(
      reader,
      {
        onToken: (t) => {
          tokens.push(t);
          current = false; // a newer request takes over after the first token
        },
        onSources: () => {},
      },
      () => current
    );
    assert.strictEqual(outcome, null);
    assert.deepStrictEqual(tokens, ["old-1"]);
    assert.ok(wasCancelled());
  });

  test("cancellation: an aborted read rejects (the hook then leaves state to the canceller)", async () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    const { reader } = fakeReader([sse("token", { text: "x" })], { failWith: abort });
    await assert.rejects(
      readAiStream(reader, { onToken: () => {}, onSources: () => {} }),
      (err: Error) => err.name === "AbortError"
    );
  });
});
