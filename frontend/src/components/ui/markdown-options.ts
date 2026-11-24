import { createElement, type ReactNode } from "react";
import type { Options } from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";

/*
 * ARC-002: hardened react-markdown options for text written by the LLM.
 *
 * AI answers can be influenced by document content (prompt injection,
 * SEC-011), so the renderer must not be able to load or run anything:
 *  - raw HTML in the Markdown is dropped (`skipHtml`), never rendered;
 *    `rehype-raw` must never be added;
 *  - images are not rendered (an image URL is a beacon / exfiltration
 *    channel); their alt text is kept;
 *  - links are kept only for http(s) URLs and open in a new tab with
 *    rel="noopener noreferrer nofollow"; any other URL (javascript:, data:,
 *    relative, ...) becomes plain text;
 *  - KaTeX runs without `trust` (no \href, \url, \includegraphics, ...) and
 *    with size and macro-expansion limits.
 *
 * Kept free of CSS imports so it can be unit-tested outside the browser.
 */

/** Only absolute http(s) URLs may become links. */
export const isSafeLinkUrl = (url: unknown): url is string =>
  typeof url === "string" && /^https?:\/\//i.test(url.trim());

const safeUrlTransform = (url: string): string => (isSafeLinkUrl(url) ? url : "");

const SafeLink = ({ href, children }: { href?: string; children?: ReactNode }) =>
  isSafeLinkUrl(href)
    ? createElement("a", { href, target: "_blank", rel: "noopener noreferrer nofollow" }, children)
    : createElement("span", null, children);

export const KATEX_OPTIONS = {
  throwOnError: false,
  strict: false,
  trust: false,
  maxSize: 10,
  maxExpand: 1000,
} as const;

export const markdownOptions: Omit<Options, "children"> = {
  remarkPlugins: [remarkMath, remarkGfm],
  rehypePlugins: [[rehypeKatex, KATEX_OPTIONS]],
  skipHtml: true,
  disallowedElements: ["img"],
  unwrapDisallowed: true,
  urlTransform: safeUrlTransform,
  components: { a: SafeLink },
};
