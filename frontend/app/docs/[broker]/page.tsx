import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { notFound } from "next/navigation";
import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BrokerLogo, brokerNames } from "@/components/brokers/ui";
import { Shell } from "@/components/brokers/shell";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getBrokerGuideMarkdown } from "@/service/broker-guide-markdown";
import { brokerGuides, getBrokerGuide } from "@/service/broker-guides";

type BrokerDocsPageProps = {
    params: Promise<{ broker: string }>;
};

export function generateStaticParams() {
    return Object.keys(brokerGuides).map((broker) => ({ broker }));
}

export default async function BrokerDocsPage({ params }: BrokerDocsPageProps) {
    const { broker } = await params;
    const guide = getBrokerGuide(broker);

    if (!guide) {
        notFound();
    }

    const markdown = await getBrokerGuideMarkdown(guide.broker);

    return (
        <Shell>
            <article className="mx-auto max-w-4xl">
                <Link
                    className="mb-8 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
                    href="/broker-connections/new"
                >
                    <ArrowLeft className="size-4" aria-hidden="true" />
                    Back to add broker
                </Link>
                <header className="mb-10 border-b pb-8">
                    <div className="flex gap-4">
                        <BrokerLogo broker={guide.broker} className="mt-1 h-12 w-20" />
                        <div>
                            <p className="mb-2 text-sm font-bold text-primary">{brokerNames[guide.broker]}</p>
                            <h1 className="text-3xl font-heading font-bold tracking-tight min-[720px]:text-4xl">{guide.title}</h1>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{guide.summary}</p>
                        </div>
                    </div>
                </header>

                <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={{
                        h1: () => null,
                        h2: ({ children }) => (
                            <h2 className="mb-3 mt-10 text-xl font-heading font-bold tracking-tight">{children}</h2>
                        ),
                        h3: ({ children }) => <h3 className="mb-2 mt-7 text-base font-bold">{children}</h3>,
                        p: ({ children }) => <p className="mb-4 text-sm leading-7 text-muted-foreground">{children}</p>,
                        ul: ({ children }) => (
                            <ul className="mb-6 ml-5 list-disc space-y-2 text-sm text-muted-foreground">{children}</ul>
                        ),
                        ol: ({ children }) => (
                            <ol className="mb-6 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
                                {children}
                            </ol>
                        ),
                        li: ({ children }) => <li className="pl-1 leading-7">{children}</li>,
                        img: ({ alt, src }) => (
                            <img
                                alt={alt ?? ""}
                                className="mb-8 mt-4 w-full border bg-secondary"
                                src={typeof src === "string" ? src : ""}
                            />
                        ),
                        table: ({ children }) => (
                            <div className="mb-8 border-y">
                                <Table className="min-w-[720px] text-left text-sm">{children}</Table>
                            </div>
                        ),
                        thead: ({ children }) => (
                            <TableHeader className="text-xs uppercase text-muted-foreground">{children}</TableHeader>
                        ),
                        tbody: ({ children }) => <TableBody>{children}</TableBody>,
                        tr: ({ children }) => <TableRow>{children}</TableRow>,
                        th: ({ children }) => (
                            <TableHead className="border-b px-0 py-3 pr-6 font-bold text-foreground">
                                {children}
                            </TableHead>
                        ),
                        td: ({ children }) => (
                            <TableCell className="border-b px-0 py-3 pr-6 text-muted-foreground">{children}</TableCell>
                        ),
                        a: ({ children, href }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
                        code: ({ children }) => (
                            <code className="bg-muted px-1.5 py-0.5 text-xs text-foreground">{children}</code>
                        ),
                        strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>
                    }}
                >
                    {markdown}
                </ReactMarkdown>
            </article>
        </Shell>
    );
}

function MarkdownLink({ href, children }: { href?: string; children: ComponentProps<"a">["children"] }) {
    if (!href) {
        return <>{children}</>;
    }

    const external = href.startsWith("http");

    if (external) {
        return (
            <a
                className="font-medium text-primary underline-offset-4 hover:underline"
                href={href}
                target="_blank"
                rel="noreferrer"
            >
                {children}
            </a>
        );
    }

    return (
        <Link className="font-medium text-primary underline-offset-4 hover:underline" href={href}>
            {children}
        </Link>
    );
}
