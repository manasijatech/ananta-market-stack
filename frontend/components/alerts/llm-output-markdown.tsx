"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

export function AlertLlmMarkdown({ children, className }: { children: string; className?: string }) {
    return (
        <div className={cn("max-w-full whitespace-normal break-words text-sm leading-6", className)}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    p: ({ children: paragraphChildren }) => (
                        <p className="mb-3 max-w-full whitespace-normal break-words last:mb-0">{paragraphChildren}</p>
                    ),
                    ul: ({ children: listChildren }) => (
                        <ul className="mb-3 ml-5 max-w-full list-disc space-y-1 whitespace-normal break-words last:mb-0">
                            {listChildren}
                        </ul>
                    ),
                    ol: ({ children: listChildren }) => (
                        <ol className="mb-3 ml-5 max-w-full list-decimal space-y-1 whitespace-normal break-words last:mb-0">
                            {listChildren}
                        </ol>
                    ),
                    li: ({ children: itemChildren }) => <li className="max-w-full break-words pl-1">{itemChildren}</li>,
                    strong: ({ children: strongChildren }) => (
                        <strong className="font-semibold text-foreground">{strongChildren}</strong>
                    ),
                    em: ({ children: emphasisChildren }) => <em className="italic">{emphasisChildren}</em>,
                    code: ({ children: codeChildren }) => (
                        <code className="break-words bg-secondary px-1 py-0.5 font-mono text-[0.92em] text-foreground">
                            {codeChildren}
                        </code>
                    ),
                    pre: ({ children: preChildren }) => (
                        <pre className="mb-3 max-w-full overflow-auto border border-border bg-secondary/40 p-3 font-mono text-xs leading-5 text-foreground last:mb-0">
                            {preChildren}
                        </pre>
                    ),
                    table: ({ children: tableChildren }) => (
                        <div className="mb-3 max-w-full overflow-x-auto last:mb-0">
                            <table className="w-full min-w-max border-collapse text-left text-xs">{tableChildren}</table>
                        </div>
                    ),
                    th: ({ children: headingChildren }) => (
                        <th className="border border-border bg-secondary px-2 py-1 font-semibold text-foreground">
                            {headingChildren}
                        </th>
                    ),
                    td: ({ children: cellChildren }) => (
                        <td className="border border-border px-2 py-1 align-top">{cellChildren}</td>
                    ),
                    a: ({ children: linkChildren, href }) => (
                        <a
                            className="break-words font-medium text-primary underline-offset-4 hover:underline"
                            href={href}
                            rel="noreferrer"
                            target="_blank"
                        >
                            {linkChildren}
                        </a>
                    )
                }}
            >
                {children}
            </ReactMarkdown>
        </div>
    );
}
