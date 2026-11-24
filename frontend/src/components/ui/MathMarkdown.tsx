import React from "react";
import ReactMarkdown from "react-markdown";
import "katex/dist/katex.min.css";
import { markdownOptions } from "./markdown-options";

interface MathMarkdownProps {
  content: string;
  className?: string;
}

/**
 * Narrow no-break space (U+202F), zero-width space / non-joiner / joiner
 * (U+200B-U+200D) and no-break space (U+00A0), as an alternation (not a
 * character class: U+200D in a class is a misleading-character-class lint
 * error).
 */
const INVISIBLE_SPACES = new RegExp(
  [0x202f, 0x200b, 0x200c, 0x200d, 0x00a0].map((code) => String.fromCharCode(code)).join("|"),
  "g"
);

/** Preprocesses LaTeX math delimiters to convert \[...\] and \(...\) to standard $$...$$ and $...$ for remark-math. */
const preprocessLaTeX = (content: string): string => {
  if (!content) return "";
  return content
    // Replace block math \[ ... \] with \n$$\n...\n$$\n
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n$$\n${math.trim()}\n$$\n`)
    // Replace inline math \( ... \) with $...$
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`)
    // Replace narrow non-breaking spaces & zero-width spaces with regular space
    .replace(INVISIBLE_SPACES, " ");
};

/**
 * Markdown + KaTeX for LLM output (AI answers, meeting summaries), with the
 * hardened options from markdown-options.ts (ARC-002): no raw HTML, no
 * images, http(s) links only, KaTeX without trust.
 */
export const MathMarkdown: React.FC<MathMarkdownProps> = ({ content, className = "" }) => {
  const formattedContent = preprocessLaTeX(content);

  return (
    <div className={`prose prose-neutral dark:prose-invert max-w-none text-sm leading-relaxed space-y-3 ${className}`}>
      <ReactMarkdown {...markdownOptions}>
        {formattedContent}
      </ReactMarkdown>
    </div>
  );
};
