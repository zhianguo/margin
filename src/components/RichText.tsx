import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { normalizeRichTextMath } from "../lib/math";

interface RichTextProps {
  children: string;
  className?: string;
}

const components: Components = {
  span({ node: _node, className, children, ...props }) {
    if (className?.split(" ").includes("katex-error")) {
      return <code className="math-fallback">{children}</code>;
    }
    return (
      <span className={className} {...props}>
        {children}
      </span>
    );
  }
};

const inlineComponents: Components = {
  ...components,
  p({ children }) {
    return <>{children}</>;
  }
};

export function RichText({ children, className }: RichTextProps) {
  return (
    <div className={className}>
      <ReactMarkdown
        components={components}
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalizeRichTextMath(children)}
      </ReactMarkdown>
    </div>
  );
}

export function InlineRichText({ children, className }: RichTextProps) {
  return (
    <span className={className}>
      <ReactMarkdown
        components={inlineComponents}
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
      >
        {normalizeRichTextMath(children)}
      </ReactMarkdown>
    </span>
  );
}
