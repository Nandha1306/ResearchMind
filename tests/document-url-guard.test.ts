import assert from "node:assert";
import { test, describe } from "node:test";
// Imports the real frontend helper used by DocumentCard (P1-A20 regression).
import { getSafeExternalUrl } from "../frontend/src/utils/fileUtils.ts";

describe("P1-A20: getSafeExternalUrl (DocumentCard open guard)", () => {
  test("accepts a Cloudinary https URL unchanged", () => {
    const url =
      "https://res.cloudinary.com/demo/raw/upload/v1/researchmind/documents/123-report.docx";
    assert.strictEqual(getSafeExternalUrl(url), url);
  });

  test("accepts plain http URLs", () => {
    assert.strictEqual(
      getSafeExternalUrl("http://localhost:9000/file.docx"),
      "http://localhost:9000/file.docx"
    );
  });

  test("rejects javascript: URLs in any case or with whitespace", () => {
    assert.strictEqual(getSafeExternalUrl("javascript:alert(document.domain)"), null);
    assert.strictEqual(getSafeExternalUrl("JavaScript:alert(1)"), null);
    assert.strictEqual(getSafeExternalUrl("  javascript:alert(1)"), null);
  });

  test("rejects data:, file: and vbscript: URLs", () => {
    assert.strictEqual(getSafeExternalUrl("data:text/html,<script>alert(1)</script>"), null);
    assert.strictEqual(getSafeExternalUrl("file:///etc/passwd"), null);
    assert.strictEqual(getSafeExternalUrl("vbscript:msgbox(1)"), null);
  });

  test("rejects missing, empty and relative values", () => {
    assert.strictEqual(getSafeExternalUrl(undefined), null);
    assert.strictEqual(getSafeExternalUrl(null), null);
    assert.strictEqual(getSafeExternalUrl(""), null);
    assert.strictEqual(getSafeExternalUrl("#"), null);
    assert.strictEqual(getSafeExternalUrl("/documents/123"), null);
  });
});
