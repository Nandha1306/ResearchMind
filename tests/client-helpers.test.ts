import assert from "node:assert";
import { test, describe } from "node:test";
import {
  readInitialQuery,
  defaultRouteFor,
  postLoginDestination,
} from "../frontend/src/utils/navigation.ts";
import {
  toIsoDueDate,
  buildImportKey,
  buildActionItemTasks,
} from "../frontend/src/utils/meeting-tasks.ts";
import {
  documentPollInterval,
  canRetryDocument,
  isProcessingStalled,
  summarizeIndexing,
  describeIndexing,
  failureReasonForDisplay,
  GENERIC_FAILURE_REASON,
  ACTIVE_POLL_INTERVAL_MS,
  STALLED_POLL_INTERVAL_MS,
} from "../frontend/src/utils/document-status.ts";
import { describeMember } from "../frontend/src/utils/members.ts";

/*
 * UNIT tests of the framework-free frontend helpers behind the Wave 3 UI
 * fixes. Rendering is covered by typecheck/build only (no DOM test runner in
 * this repo).
 */

const NOW = Date.parse("2026-11-11T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

describe("P1-A19 navigation helpers", () => {
  test("initialQuery from router state is trimmed and validated", () => {
    assert.strictEqual(readInitialQuery({ initialQuery: "  what is RAG?  " }), "what is RAG?");
    assert.strictEqual(readInitialQuery({ initialQuery: "   " }), null);
    assert.strictEqual(readInitialQuery({ initialQuery: "x".repeat(1001) }), null);
    assert.strictEqual(readInitialQuery({ initialQuery: 42 }), null);
    assert.strictEqual(readInitialQuery(null), null);
  });

  test("unknown routes go to the dashboard when signed in, otherwise to sign-in", () => {
    assert.strictEqual(defaultRouteFor(true), "/dashboard");
    assert.strictEqual(defaultRouteFor(false), "/login");
  });

  test("after sign-in, return to the deep link that required it -- same-app paths only", () => {
    assert.strictEqual(postLoginDestination({ from: { pathname: "/dashboard/tasks", search: "?x=1" } }), "/dashboard/tasks?x=1");
    assert.strictEqual(postLoginDestination(null), "/dashboard");
    assert.strictEqual(postLoginDestination({ from: { pathname: "//evil.example.com" } }), "/dashboard");
    assert.strictEqual(postLoginDestination({ from: { pathname: "https://evil.example.com" } }), "/dashboard");
    assert.strictEqual(postLoginDestination({ from: { pathname: "/login" } }), "/dashboard");
    assert.strictEqual(postLoginDestination({ from: { pathname: "/\\evil.example.com" } }), "/dashboard");
    assert.strictEqual(postLoginDestination({ from: { pathname: "/dashboard\\..\\x" } }), "/dashboard");
  });
});

describe("P1-A17/A23 meeting action items -> tasks", () => {
  test("only real YYYY-MM-DD dates become due dates; free text is never guessed", () => {
    assert.strictEqual(toIsoDueDate("2026-03-14"), "2026-03-14T00:00:00.000Z");
    assert.strictEqual(toIsoDueDate("next Friday"), null);
    assert.strictEqual(toIsoDueDate("03/04/2026"), null);
    assert.strictEqual(toIsoDueDate("2026-02-30"), null, "impossible dates rejected");
    assert.strictEqual(toIsoDueDate(""), null);
    assert.strictEqual(toIsoDueDate(null), null);
  });

  test("the import key is stable for the same selection (order-insensitive) and differs otherwise", () => {
    assert.strictEqual(buildImportKey("sum-1", [2, 0, 1]), buildImportKey("sum-1", [0, 1, 2]));
    assert.notStrictEqual(buildImportKey("sum-1", [0, 1]), buildImportKey("sum-1", [0, 2]));
    assert.notStrictEqual(buildImportKey("sum-1", [0]), buildImportKey("sum-2", [0]));
    assert.match(buildImportKey("3f2c-uuid-board", [0, 1]), /^[\w:.,-]{8,200}$/, "accepted by the server schema");
  });

  test("payload: no guessed assignee ids, unreadable due text kept in the description", () => {
    const items = [
      { task: "  Draft intro  ", assignee: "Priya", due: "next Friday" },
      { task: "Run eval", assignee: "", due: "2026-05-01" },
      { task: "   ", assignee: "x", due: "" },
    ];
    const tasks = buildActionItemTasks(items, [2, 1, 0], "board-1");
    assert.strictEqual(tasks.length, 2, "empty action items are skipped");
    assert.deepStrictEqual(tasks.map((t) => t.title), ["Draft intro", "Run eval"]);
    assert.ok(tasks.every((t) => t.assigneeId === null));
    assert.strictEqual(tasks[0].dueDate, null);
    assert.strictEqual(tasks[0].description, "Assignee context: Priya\nDue (from meeting notes): next Friday");
    assert.strictEqual(tasks[1].dueDate, "2026-05-01T00:00:00.000Z");
    assert.strictEqual(tasks[1].description, undefined);
  });
});

describe("P1-A22 document status polling and actions", () => {
  test("polls fast while processing, slowly while only stalled, and stops when all final", () => {
    assert.strictEqual(documentPollInterval([{ embeddingStatus: "indexing", updatedAt: minutesAgo(1) }], NOW), ACTIVE_POLL_INTERVAL_MS);
    assert.strictEqual(documentPollInterval([{ embeddingStatus: "pending", updatedAt: minutesAgo(60) }], NOW), STALLED_POLL_INTERVAL_MS);
    assert.strictEqual(
      documentPollInterval(
        [
          { embeddingStatus: "indexed", updatedAt: minutesAgo(1) },
          { embeddingStatus: "failed", updatedAt: minutesAgo(1) },
        ],
        NOW
      ),
      false
    );
    assert.strictEqual(documentPollInterval([], NOW), false);
    assert.strictEqual(documentPollInterval(undefined, NOW), false);
  });

  test("retry is offered for failed and stalled documents only", () => {
    assert.strictEqual(canRetryDocument({ embeddingStatus: "failed", updatedAt: minutesAgo(1) }, NOW), true);
    assert.strictEqual(canRetryDocument({ embeddingStatus: "pending", updatedAt: minutesAgo(1) }, NOW), false);
    assert.strictEqual(canRetryDocument({ embeddingStatus: "indexing", updatedAt: minutesAgo(1) }, NOW), false);
    assert.strictEqual(canRetryDocument({ embeddingStatus: "indexing", updatedAt: minutesAgo(20) }, NOW), true);
    assert.strictEqual(canRetryDocument({ embeddingStatus: "indexed", updatedAt: minutesAgo(99) }, NOW), false);
  });

  test("a stuck pending document is detected although the recovery sweep keeps touching it", () => {
    // Created an hour ago, touched by the sweep 5 minutes ago.
    const stuck = { embeddingStatus: "pending" as const, createdAt: minutesAgo(60), updatedAt: minutesAgo(5) };
    assert.strictEqual(isProcessingStalled(stuck, NOW), true);
    assert.strictEqual(canRetryDocument(stuck, NOW), true);
    assert.strictEqual(documentPollInterval([stuck], NOW), STALLED_POLL_INTERVAL_MS, "polling slows down");
    // Just re-queued (manual re-index of an old document): not stalled yet.
    const requeued = { embeddingStatus: "pending" as const, createdAt: minutesAgo(600), updatedAt: minutesAgo(1) };
    assert.strictEqual(isProcessingStalled(requeued, NOW), false);
    assert.strictEqual(documentPollInterval([requeued], NOW), ACTIVE_POLL_INTERVAL_MS);
    // Freshly uploaded and waiting: not stalled.
    assert.strictEqual(isProcessingStalled({ embeddingStatus: "pending", createdAt: minutesAgo(3), updatedAt: minutesAgo(3) }, NOW), false);
  });

  test("only ResearchMind's own failure reasons are shown; raw provider errors are not", () => {
    assert.strictEqual(failureReasonForDisplay("Document contains no usable text"), "Document contains no usable text");
    assert.strictEqual(failureReasonForDisplay("Indexing failed after 3 attempts"), "Indexing failed after 3 attempts");
    assert.strictEqual(failureReasonForDisplay("connect ECONNREFUSED 10.0.3.7:6379"), GENERIC_FAILURE_REASON);
    assert.strictEqual(failureReasonForDisplay("Voyage 503 Service Unavailable"), GENERIC_FAILURE_REASON);
    assert.strictEqual(failureReasonForDisplay(null), GENERIC_FAILURE_REASON);
  });

  test("missing/garbled timestamps count as stale (never stuck spinning forever)", () => {
    assert.strictEqual(isProcessingStalled({ embeddingStatus: "pending", updatedAt: "" }, NOW), true);
  });

  test("overview metric: only claims 'all searchable' when every document is indexed", () => {
    const docs = [
      { embeddingStatus: "indexed" as const },
      { embeddingStatus: "failed" as const },
      { embeddingStatus: "indexing" as const },
    ];
    const summary = summarizeIndexing(docs);
    assert.deepStrictEqual(summary, { total: 3, indexed: 1, processing: 1, failed: 1 });
    assert.strictEqual(describeIndexing(summary), "1 processing, 1 failed");
    assert.strictEqual(describeIndexing(summarizeIndexing([{ embeddingStatus: "indexed" }])), "All sources indexed & searchable");
    assert.strictEqual(describeIndexing(summarizeIndexing([])), "No documents uploaded yet");
  });
});

describe("P1-A16 assignee display", () => {
  const members = [
    { userId: "665f1c2b9d3e4a0012345678", name: "Priya", email: "p@example.test" },
    { userId: "665f1c2b9d3e4a00aaaaaaaa", name: "", email: "noname@example.test" },
  ];

  test("members are shown by name (or email), never by raw id", () => {
    assert.deepStrictEqual(describeMember(members, "665f1c2b9d3e4a0012345678"), { label: "Priya", isMember: true });
    assert.deepStrictEqual(describeMember(members, "665f1c2b9d3e4a00aaaaaaaa"), { label: "noname@example.test", isMember: true });
  });

  test("a removed member's id is shown as 'Former member'", () => {
    assert.deepStrictEqual(describeMember(members, "665f1c2b9d3e4a00ffffffff"), { label: "Former member", isMember: false });
  });

  test("legacy tasks that stored a display name keep showing it", () => {
    assert.deepStrictEqual(describeMember(members, "Priya S."), { label: "Priya S.", isMember: false });
  });

  test("while the member list is still loading, nobody is labelled a former member", () => {
    assert.deepStrictEqual(describeMember(undefined, "665f1c2b9d3e4a0012345678"), { label: "…", isMember: true });
    // ...and if the list could not be loaded, say so instead of "…" forever.
    assert.deepStrictEqual(describeMember(null, "665f1c2b9d3e4a0012345678"), {
      label: "Assigned (names unavailable)",
      isMember: true,
    });
  });

  test("unassigned is nothing to show", () => {
    assert.strictEqual(describeMember(members, null), null);
    assert.strictEqual(describeMember(members, ""), null);
  });
});
