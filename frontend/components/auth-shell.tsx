import Link from "next/link";
import { ThemeToggle } from "@/components/theme-toggle";

type AuthShellProps = {
 title: string;
 eyebrow: string;
 subtitle: string;
 footerText: string;
 footerHref: string;
 footerAction: string;
 children: React.ReactNode;
};

export function AuthShell({
 title,
 eyebrow,
 subtitle,
 footerText,
 footerHref,
 footerAction,
 children
}: AuthShellProps) {
 return (
 <main className="grid min-h-screen grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(420px,520px)]">
 <section className="relative isolate grid min-h-[360px] content-between overflow-hidden border-b border-border bg-background p-7 text-foreground lg:min-h-screen lg:border-b-0 lg:border-r lg:p-12" aria-label="Market Stack">
 <img
 alt=""
 aria-hidden="true"
 className="absolute inset-0 -z-20 h-full w-full object-cover object-center opacity-45 brightness-[0.9] contrast-[1.08] saturate-[0.5] sepia-[0.32] dark:opacity-55 dark:brightness-[0.52] dark:saturate-[0.55]"
 src="/auth/trading-desk.jpg"
 />
 <div className="absolute inset-0 -z-10 bg-background/55 dark:bg-background/58" />
 <div className="absolute inset-x-0 top-0 z-10 h-[3px] bg-primary" />
 <div className="flex items-center gap-3 text-[15px] font-extrabold">
 <div className="flex aspect-square w-10 shrink-0 items-center justify-center border border-primary font-mono text-[13px] font-black text-primary" aria-hidden="true">
 MS
 </div>
 <span className="uppercase tracking-[0.08em]">Market Stack</span>
 </div>
 <div className="max-w-[720px]">
 <p className="mb-3.5 font-mono text-[11px] font-extrabold uppercase tracking-[0.18em] text-primary">
 {eyebrow}
 </p>
 <h1 className="max-w-[860px] text-[38px] font-semibold leading-[0.98] min-[560px]:text-[clamp(42px,5vw,76px)]">
 Broker access, account security, and trading workflows in one calm workspace.
 </h1>
 </div>
 </section>

 <section className="flex items-center justify-center bg-card p-0 min-[560px]:p-6 lg:p-8" aria-label={title}>
 <div className="absolute right-5 top-5 z-10">
 <ThemeToggle />
 </div>
 <div className="w-full max-w-[430px] border-y border-border px-6 py-7">
 <div className="pb-6">
 <p className="mb-2 font-mono text-[11px] font-extrabold uppercase tracking-[0.18em] text-primary">{eyebrow}</p>
 <h2 className="text-[34px] font-semibold leading-[1.08]">{title}</h2>
 <p className="mt-2 text-base leading-6 text-muted-foreground">{subtitle}</p>
 </div>
 <div>
 {children}
 <p className="mt-6 text-center text-sm text-muted-foreground">
 {footerText}{" "}
 <Link className="font-bold text-primary hover:underline" href={footerHref}>
 {footerAction}
 </Link>
 </p>
 </div>
 </div>
 </section>
 </main>
 );
}
