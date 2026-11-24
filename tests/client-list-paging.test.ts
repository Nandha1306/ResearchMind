import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";
import { fetchAllPages, MAX_LIST_PAGES } from "../frontend/src/api/paging.ts";

/*
 * ISS-043 (R2), client side: list endpoints return one capped page plus
 * `meta.nextCursor`. The frontend helpers follow the cursor (up to a bounded
 * number of pages) so the UI shows everything as before, and report when the
 * ceiling was hit so a "showing first N" notice can be shown.
 *
 * The helper is tested with a stubbed axios-style `get` that serves pages of
 * a fixed list exactly like the server: newest first, opaque cursor.
 */

type Item = { id: number };

/** A stub of axios.get over `total` items served `pageSize` at a time. */
const stubAxios = (total: number, pageSize: number) => {
  const items: Item[] = Array.from({ length: total }, (_, i) => ({ id: total - i }));
  const calls: Array<{ url: string; params: Record<string, unknown> }> = [];
  const get = async (url: string, config?: { params?: Record<string, unknown> }) => {
    const params = config?.params ?? {};
    calls.push({ url, params });
    const start = typeof params.cursor === "string" ? Number(params.cursor) : 0;
    const page = items.slice(start, start + pageSize);
    const next = start + pageSize;
    const hasMore = next < items.length;
    return { data: { success: true, data: page, meta: { limit: pageSize, nextCursor: hasMore ? String(next) : null, hasMore } } };
  };
  return { get, calls };
};

describe("ISS-043: fetchAllPages follows meta.nextCursor", () => {
  test("a single page (today's typical case) is one request and not truncated", async () => {
    const { get, calls } = stubAxios(3, 500);
    const result = await fetchAllPages<Item>(get, "/documents/workspace/w");
    assert.deepStrictEqual(result.items.map((i) => i.id), [3, 2, 1]);
    assert.strictEqual(result.truncated, false);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].params.cursor, undefined);
  });

  test("several pages are concatenated in order, without duplicates, and keep extra params", async () => {
    const { get, calls } = stubAxios(120, 50);
    const result = await fetchAllPages<Item>(get, "/tasks/workspaces/w/tasks", { boardId: "b1" });
    assert.strictEqual(result.items.length, 120);
    assert.strictEqual(new Set(result.items.map((i) => i.id)).size, 120);
    assert.deepStrictEqual(result.items.slice(0, 2).map((i) => i.id), [120, 119]);
    assert.strictEqual(result.truncated, false);
    assert.deepStrictEqual(calls.map((c) => c.params.cursor), [undefined, "50", "100"]);
    assert.ok(calls.every((c) => c.params.boardId === "b1"));
  });

  test("the page ceiling stops the walk and reports truncation", async () => {
    assert.strictEqual(MAX_LIST_PAGES, 10);
    const { get, calls } = stubAxios(1000, 10);
    const result = await fetchAllPages<Item>(get, "/documents/workspace/w");
    assert.strictEqual(calls.length, MAX_LIST_PAGES);
    assert.strictEqual(result.items.length, 100);
    assert.strictEqual(result.truncated, true);
  });

  test("a response without meta (older server) is one complete page", async () => {
    const get = async () => ({ data: { success: true, data: [{ id: 1 }, { id: 2 }] } });
    const result = await fetchAllPages<Item>(get, "/x");
    assert.deepStrictEqual(result, { items: [{ id: 1 }, { id: 2 }], truncated: false });
  });

  test("static guard: list API helpers use fetchAllPages; the pages show the notice", () => {
    const src = path.join(__dirname, "..", "frontend", "src");
    const read = (...p: string[]) => fs.readFileSync(path.join(src, ...p), "utf8");
    assert.match(read("api", "document.api.ts"), /fetchAllPages/);
    const taskApi = read("api", "task.api.ts");
    assert.strictEqual(taskApi.match(/fetchAllPages</g)?.length, 3, "boards, tasks and activities");
    assert.match(read("pages", "DocumentsPage.tsx"), /ListTruncatedNotice/);
    assert.match(read("pages", "KanbanPage.tsx"), /ListTruncatedNotice/);
  });
});
