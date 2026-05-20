import Link from "next/link";
import type { BrokerAccount, BrokerCode } from "@/service/types/broker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WorkspaceShell } from "@/components/workspace-shell";
import { cn } from "@/lib/utils";

export const brokerNames: Record<BrokerCode, string> = {
 angel: "Angel One",
 dhan: "Dhan",
 groww: "Groww",
 indmoney: "INDmoney",
 kotak: "Kotak Neo",
 upstox: "Upstox",
 zerodha: "Zerodha"
};

export const brokerLogos: Record<BrokerCode, string> = {
 angel: "/broker-logos/angel.jpg",
 dhan: "/broker-logos/dhan.jpg",
 groww: "/broker-logos/groww.jpg",
 indmoney: "/broker-logos/indmoney.jpg",
 kotak: "/broker-logos/kotak.jpg",
 upstox: "/broker-logos/upstox.jpg",
 zerodha: "/broker-logos/zerodha.jpg"
};

export function BrokerLogo({
 broker,
 className = "",
 imageClassName = ""
}: {
 broker: BrokerCode;
 className?: string;
 imageClassName?: string;
}) {
 return (
 <span
 className={cn(
 "flex h-12 w-12 shrink-0 items-center justify-center",
 className
 )}
 aria-hidden="true"
 >
 <img
 alt=""
 className={cn("block size-10 object-cover", imageClassName)}
 draggable={false}
 src={brokerLogos[broker]}
 />
 </span>
 );
}

export function formatDate(value?: string | null): string {
 if (!value) {
 return "Not available";
 }
 return new Intl.DateTimeFormat("en-IN", {
 dateStyle: "medium",
 timeStyle: "short"
 }).format(new Date(value));
}

export function statusTone(value?: string | null): string {
 if (!value || value === "pending" || value === "action_required") {
 return "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]";
 }
 if (value === "active" || value === "automation_ready") {
 return "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]";
 }
 return "border-border bg-card text-muted-foreground";
}

export function StatusBadge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
 return <Badge className={cn("px-2.5 py-1 font-bold", className)} variant="outline">{children}</Badge>;
}

export function BrokerCard({ account }: { account: BrokerAccount }) {
 const verified = Boolean(account.last_verified_at);
 return (
 <Card className="group p-0 transition-colors duration-100 ease-out hover:border-primary/60">
 <Link className="block p-5" href={`/broker-connections/${account.id}`}>
 <div className="mb-5 flex items-start justify-between gap-4">
 <div className="flex min-w-0 items-start gap-3">
 <BrokerLogo broker={account.broker_code} />
 <div className="min-w-0">
 <p className="font-mono text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">{brokerNames[account.broker_code]}</p>
 <h2 className="mt-1 truncate text-2xl font-bold text-foreground">{account.label}</h2>
 </div>
 </div>
 <StatusBadge
 className={verified ? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]" : "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]"}
 >
 {verified ? "Verified" : "Unverified"}
 </StatusBadge>
 </div>
 <div className="flex flex-wrap gap-2">
 <StatusBadge className={statusTone(account.session_status)}>
 {account.session_status ?? "pending"}
 </StatusBadge>
 {account.automation_enabled ? (
 <StatusBadge className="border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]">
 {account.automation_mode ?? "automation"}
 </StatusBadge>
 ) : null}
 </div>
 <p className="mt-5 text-sm text-muted-foreground">Created {formatDate(account.created_at)}</p>
 {account.last_error ? (
 <p className="mt-3 line-clamp-2 border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] p-3 text-sm text-[var(--danger)]">
 {account.last_error}
 </p>
 ) : null}
 </Link>
 </Card>
 );
}

export function PageHeader({
 eyebrow,
 title,
 description,
 action
}: {
 eyebrow: string;
 title: string;
 description: string;
 action?: React.ReactNode;
}) {
 return (
 <header className="mb-6 flex min-w-0 flex-col justify-between gap-5 border-b border-border pb-5 min-[760px]:mb-8 min-[860px]:flex-row min-[860px]:items-end min-[860px]:pb-6">
 <div className="min-w-0">
 <p className="type-page-eyebrow mb-3">{eyebrow}</p>
 <h1 className="break-words text-[clamp(30px,10vw,58px)] font-semibold leading-none tracking-normal">{title}</h1>
 <p className="type-body mt-4 max-w-2xl text-muted-foreground">{description}</p>
 </div>
 {action ? <div className="flex w-full flex-col min-[520px]:w-auto">{action}</div> : null}
 </header>
 );
}

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
 return (
 <Button asChild className="min-h-11 w-full font-extrabold min-[520px]:w-auto">
 <Link href={href}>{children}</Link>
 </Button>
 );
}

export function Shell({ children }: { children: React.ReactNode }) {
 return <WorkspaceShell>{children}</WorkspaceShell>;
}
