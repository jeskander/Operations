import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

const link = ({ node: _node, ...props }: React.ComponentProps<"a"> & { node?: unknown }) => (
  <a {...props} target="_blank" rel="noreferrer" />
);

/** A Markdown answer: paragraphs, lists, tables, links. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={{ a: link }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** One line: **bold**, *italic* and links only. */
export function Inline({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      allowedElements={["p", "strong", "em", "a", "code", "del"]}
      unwrapDisallowed
      components={{ p: ({ children }) => <>{children}</>, a: link }}
    >
      {children}
    </ReactMarkdown>
  );
}
