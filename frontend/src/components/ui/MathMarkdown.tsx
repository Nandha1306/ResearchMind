import React from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";

interface MathMarkdownProps {
  content: string;
  className?: string;
}

/** Preprocesses LaTeX math delimiters to convert \[...\] and \(...\) to standard $$...$$ and $...$ for remark-math. */
const preprocessLaTeX = (content: string): string => {
  if (!content) return "";
  return content
    // Replace block math \[ ... \] with \n$$\n...\n$$\n
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => `\n$$\n${math.trim()}\n$$\n`)
    // Replace inline math \( ... \) with $...$
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => `$${math.trim()}$`)
    // Replace narrow non-breaking spaces & zero-width spaces with regular space
    .replace(/[\u202F\u200B\u200C\u200D\u00A0]/g, " ");
};

export const MathMarkdown: React.FC<MathMarkdownProps> = ({ content, className = "" }) => {
  const formattedContent = preprocessLaTeX(content);

  return (
    <div className={`prose prose-neutral dark:prose-invert max-w-none text-sm leading-relaxed space-y-3 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkMath, remarkGfm]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
      >
        {formattedContent}
      </ReactMarkdown>
    </div>
  );
};
