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
  angel: "/brokers/angel.jpg",
  dhan: "/brokers/dhan.jpg",
  groww: "/brokers/groww.jpg",
  indmoney: "/brokers/indmoney.jpg",
  kotak: "/brokers/kotak.jpg",
  upstox: "/brokers/upstox.jpg",
  zerodha: "/brokers/zerodha.jpg"
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
        className={cn("block size-10 rounded-[10px] object-cover shadow-sm", imageClassName)}
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
    return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200";
  }
  if (value === "active" || value === "automation_ready") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
  }
  return "border-border bg-card text-muted-foreground";
}

export function StatusBadge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <Badge className={cn("rounded-full px-2.5 py-1 font-bold", className)} variant="outline">{children}</Badge>;
}

export function BrokerCard({ account }: { account: BrokerAccount }) {
  const verified = Boolean(account.last_verified_at);
  return (
    <Card className="group p-0 transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-auth">
      <Link className="block p-5" href={`/brokers/${account.id}`}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <BrokerLogo broker={account.broker_code} />
            <div className="min-w-0">
              <p className="text-sm font-bold uppercase text-muted-foreground">{brokerNames[account.broker_code]}</p>
              <h2 className="mt-1 truncate text-2xl font-bold text-foreground">{account.label}</h2>
            </div>
          </div>
          <StatusBadge
            className={verified ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"}
          >
            {verified ? "Verified" : "Unverified"}
          </StatusBadge>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge className={statusTone(account.session_status)}>
            {account.session_status ?? "pending"}
          </StatusBadge>
          {account.automation_enabled ? (
            <StatusBadge className="border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
              {account.automation_mode ?? "automation"}
            </StatusBadge>
          ) : null}
        </div>
        <p className="mt-5 text-sm text-muted-foreground">Created {formatDate(account.created_at)}</p>
        {account.last_error ? (
          <p className="mt-3 line-clamp-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">
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
    <header className="mb-8 flex flex-col justify-between gap-5 min-[860px]:flex-row min-[860px]:items-end">
      <div>
        <p className="mb-3 text-[13px] font-extrabold uppercase tracking-[0.08em] text-primary">{eyebrow}</p>
        <h1 className="text-[clamp(34px,5vw,58px)] font-bold leading-none">{title}</h1>
        <p className="mt-4 max-w-2xl text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Button asChild className="min-h-11 font-extrabold">
      <Link href={href}>{children}</Link>
    </Button>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return <WorkspaceShell>{children}</WorkspaceShell>;
}
