import Link from "next/link";
import { IconPlus, IconWallet } from "@tabler/icons-react";
import type { BrokerAccount, BrokerCode } from "@/service/types/broker";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardFrame,
	CardFrameAction,
	CardFrameDescription,
	CardFrameHeader,
	CardFrameTitle,
	CardPanel,
} from "@/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { formatIstDateTime } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import { typography } from "@/lib/typography";

export const brokerNames: Record<BrokerCode, string> = {
	angel: "Angel One",
	dhan: "Dhan",
	groww: "Groww",
	indmoney: "INDmoney",
	kotak: "Kotak Neo",
	upstox: "Upstox",
	zerodha: "Zerodha",
};

export const brokerLogos: Record<BrokerCode, string> = {
	angel: "/broker-logos/angel.jpg",
	dhan: "/broker-logos/dhan.jpg",
	groww: "/broker-logos/groww.jpg",
	indmoney: "/broker-logos/indmoney.jpg",
	kotak: "/broker-logos/kotak.jpg",
	upstox: "/broker-logos/upstox.jpg",
	zerodha: "/broker-logos/zerodha.jpg",
};

export function BrokerLogo({
	broker,
	className = "",
	imageClassName = "",
}: {
	broker: BrokerCode;
	className?: string;
	imageClassName?: string;
}) {
	return (
		<span
			className={cn(
				"flex h-12 w-12 shrink-0 items-center justify-center",
				className,
			)}
			aria-hidden="true"
		>
			<img
				alt=""
				className={cn("block size-10 rounded-md object-cover", imageClassName)}
				draggable={false}
				src={brokerLogos[broker]}
			/>
		</span>
	);
}

export function formatDate(value?: string | null): string {
	return formatIstDateTime(value);
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

export function isBrokerAccountReady(account: BrokerAccount): boolean {
	return (
		account.is_active &&
		Boolean(account.last_verified_at) &&
		(account.session_status === "active" ||
			account.session_status === "automation_ready")
	);
}

function sessionBadgeVariant(
	status?: string | null,
): NonNullable<BadgeProps["variant"]> {
	if (status === "active" || status === "automation_ready") return "success";
	if (!status || status === "pending" || status === "action_required")
		return "warning";
	return "secondary";
}

export function StatusBadge({
	children,
	className = "",
	variant = "outline",
}: {
	children: React.ReactNode;
	className?: string;
	variant?: BadgeProps["variant"];
}) {
	return (
		<Badge className={cn("px-2.5 py-1 font-medium", className)} variant={variant}>
			{children}
		</Badge>
	);
}

export function BrokerAccountsEmpty({
	canAddBroker,
}: {
	canAddBroker: boolean;
}) {
	return (
		<CardFrame>
			<CardFrameHeader>
				<CardFrameTitle className={typography.h4}>
					Connected accounts
				</CardFrameTitle>
				<CardFrameDescription className="leading-7">
					Sessions, quotes, and portfolio data for each broker you connect.
				</CardFrameDescription>
				{canAddBroker ? (
					<CardFrameAction>
						<Button
							asChild
							className="min-h-11 w-full font-semibold min-[520px]:w-auto"
						>
							<Link href="/broker-connections/new">
								<IconPlus aria-hidden="true" className="size-4" stroke={1.75} />
								Add broker
							</Link>
						</Button>
					</CardFrameAction>
				) : null}
			</CardFrameHeader>
			<Card>
				<Empty className="py-16 md:py-20">
					<EmptyHeader>
						<EmptyMedia variant="icon">
							<IconWallet stroke={1.8} />
						</EmptyMedia>
						<EmptyTitle>
							{canAddBroker
								? "No broker accounts yet"
								: "No broker accounts are shared with you yet"}
						</EmptyTitle>
						<EmptyDescription>
							{canAddBroker
								? "Add your first broker account to start setting up sessions, quotes, and portfolio views."
								: "Ask a workspace admin to share a broker account with at least View account access. Shared accounts will appear here automatically."}
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			</Card>
		</CardFrame>
	);
}

export function BrokerCard({ account }: { account: BrokerAccount }) {
	const verified = Boolean(account.last_verified_at);

	return (
		<CardFrame
			className="group w-full transition-colors duration-100 ease-out hover:border-primary/60"
			render={<Link href={`/broker-connections/${account.id}`} />}
		>
			<CardFrameHeader>
				<CardFrameTitle className="truncate text-lg font-bold">
					{account.label}
				</CardFrameTitle>
				<CardFrameDescription className="font-mono text-xs font-medium uppercase tracking-[0.14em]">
					{brokerNames[account.broker_code]}
				</CardFrameDescription>
				<CardFrameAction>
					<Badge variant={verified ? "success" : "warning"}>
						{verified ? "Verified" : "Unverified"}
					</Badge>
				</CardFrameAction>
			</CardFrameHeader>
			<Card>
				<CardPanel className="flex flex-col gap-4">
					<div className="flex items-start gap-3">
						<BrokerLogo broker={account.broker_code} />
						<div className="flex min-w-0 flex-1 flex-wrap gap-2">
							<Badge variant={sessionBadgeVariant(account.session_status)}>
								{account.session_status ?? "pending"}
							</Badge>
							{account.automation_enabled ? (
								<Badge variant="info">
									{account.automation_mode ?? "automation"}
								</Badge>
							) : null}
						</div>
					</div>
					<p className="text-sm text-muted-foreground">
						Created {formatDate(account.created_at)}
					</p>
					{account.last_error ? (
						<p className="line-clamp-2 border-l-2 border-[var(--danger)] bg-[var(--danger-subtle)] p-3 text-sm text-[var(--danger)]">
							{account.last_error}
						</p>
					) : null}
				</CardPanel>
			</Card>
		</CardFrame>
	);
}
export function PageHeader({
	eyebrow,
	title,
	description,
	action,
}: {
	eyebrow: string;
	title: string;
	description: string;
	action?: React.ReactNode;
}) {
	return (
		<header className="mb-6 flex min-w-0 flex-col justify-between gap-4 border-b border-border pb-5 min-[860px]:flex-row min-[860px]:items-end min-[860px]:gap-5">
			<div className="min-w-0">
				<p className={cn(typography.pageEyebrow, "mb-3")}>{eyebrow}</p>
				<h1 className={cn(typography.pageTitle, "break-words")}>{title}</h1>
				<p className={typography.pageLead}>{description}</p>
			</div>
			{action ? (
				<div className="flex w-full shrink-0 flex-col items-start min-[520px]:w-auto min-[860px]:items-end">{action}</div>
			) : null}
		</header>
	);
}

export function PrimaryLink({
	href,
	children,
}: {
	href: string;
	children: React.ReactNode;
}) {
	return (
		<Button
			asChild
			className="min-h-11 w-full font-semibold min-[520px]:w-auto"
		>
			<Link href={href}>{children}</Link>
		</Button>
	);
}
