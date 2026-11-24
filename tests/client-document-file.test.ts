import assert from "node:assert";
import { describe, test } from "node:test";
import { downloadDocumentFile, loadDocumentObjectUrl } from "../frontend/src/utils/document-file.ts";

/*
 * SEC-005 (frontend): files are fetched through the authenticated API and
 * shown/saved via object URLs that are always revoked. Framework-free module;
 * browser APIs injected as fakes.
 */

const fakeUrlApi = () => {
  const created: string[] = [];
  const revoked: string[] = [];
  return {
    created,
    revoked,
    api: {
      createObjectURL: (_blob: Blob) => {
        const url = `blob:test/${created.length}`;
        created.push(url);
        return url;
      },
      revokeObjectURL: (url: string) => {
        revoked.push(url);
      },
    },
  };
};

describe("document file helpers (frontend/src/utils/document-file.ts)", () => {
  test("loads through the given fetcher (the authenticated API) and revokes exactly once", async () => {
    const requested: string[] = [];
    const urls = fakeUrlApi();
    const loaded = await loadDocumentObjectUrl(
      async (id) => {
        requested.push(id);
        return new Blob(["%PDF"]);
      },
      "doc-1",
      urls.api
    );
    assert.deepStrictEqual(requested, ["doc-1"]);
    assert.strictEqual(loaded.url, "blob:test/0");
    loaded.revoke();
    loaded.revoke();
    assert.deepStrictEqual(urls.revoked, ["blob:test/0"]);
  });

  test("a failed fetch creates no object URL", async () => {
    const urls = fakeUrlApi();
    await assert.rejects(
      loadDocumentObjectUrl(async () => {
        throw new Error("403");
      }, "doc-2", urls.api)
    );
    assert.deepStrictEqual(urls.created, []);
  });

  test("download saves under the original name, removes the anchor and revokes the URL", async () => {
    const urls = fakeUrlApi();
    const events: string[] = [];
    const anchor = {
      href: "",
      download: "",
      rel: "",
      click: () => events.push(`click ${anchor.href} as ${anchor.download}`),
      remove: () => events.push("remove"),
    };
    let deferred: (() => void) | null = null;
    await downloadDocumentFile(
      async () => new Blob(["docx bytes"]),
      "doc-3",
      "draft.docx",
      urls.api,
      { createAnchor: () => anchor, append: () => events.push("append"), later: (fn) => (deferred = fn) }
    );
    assert.deepStrictEqual(events, ["append", "click blob:test/0 as draft.docx", "remove"]);
    assert.strictEqual(anchor.href.startsWith("blob:"), true, "never a storage URL");
    assert.deepStrictEqual(urls.revoked, []);
    deferred!();
    assert.deepStrictEqual(urls.revoked, ["blob:test/0"]);
  });
});
