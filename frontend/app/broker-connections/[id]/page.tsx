import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getBrokerAccount, getSessionStatus } from "@/service/actions/broker";
import { BrokerDetailActions } from "@/components/brokers/broker-detail-actions";
import { InstrumentSyncBanner } from "@/components/brokers/instrument-sync-banner";
import { NotificationsBanner } from "@/components/brokers/notifications-banner";
import { PortfolioTabs } from "@/components/brokers/portfolio-tabs";
import { SessionPanel } from "@/components/brokers/session-panel";
import {
    brokerNames,
    formatDate,
    isBrokerAccountReady,
    PageHeader,
    Shell,
    StatusBadge,
    statusTone
} from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatUserFacingError } from "@/lib/api-errors";
import type { BrokerAccountDetail, SessionStatus } from "@/service/types/broker";

type BrokerDetailPageProps = {
    params: Promise<{ id: string }>;
};

export default async function BrokerDetailPage({ params }: BrokerDetailPageProps) {
    const { id } = await params;
    let account: BrokerAccountDetail | null = null;
    let sessionStatus: SessionStatus | null = null;
    let loadError = "";

    try {
        account = await getBrokerAccount(id);
        sessionStatus = await getSessionStatus(account.id, account.broker_code);
    } catch (caught) {
        loadError = formatUserFacingError(caught, "Could not load this broker account.");
    }

    if (!account || !sessionStatus) {
        return (
            <Shell>
                <PageHeader
                    eyebrow="Broker account"
                    title="Broker account"
                    description="Review account status, update broker sessions, fetch quotes, and inspect broker-native portfolio data."
                    action={
                        <Button asChild variant="outline">
                            <Link href="/broker-connections">
                                <ArrowLeft className="size-4" aria-hidden="true" />
                                Back to brokers
                            </Link>
                        </Button>
                    }
                />
                <Alert variant="warning">
                    <AlertDescription>
                        {loadError || "This broker account could not be loaded."}
                    </AlertDescription>
                </Alert>
            </Shell>
        );
    }

    const ready =
        isBrokerAccountReady(account) ||
        (account.is_active && Boolean(account.last_verified_at) && sessionStatus.session_active);
    const showInstrumentSync = sessionStatus.session_active || Boolean(account.last_verified_at);

    return (
        <Shell>
            <PageHeader
                eyebrow={brokerNames[account.broker_code]}
                title={account.label}
                description="Review account status, update broker sessions, fetch quotes, and inspect broker-native portfolio data."
                action={
                    <Button asChild variant="outline">
                        <Link href="/broker-connections">
                            <ArrowLeft className="size-4" aria-hidden="true" />
                            Back to brokers
                        </Link>
                    </Button>
                }
            />

            <div className="mb-6 space-y-4">
                <NotificationsBanner />
                {showInstrumentSync ? <InstrumentSyncBanner accountId={account.id} /> : null}
            </div>

            <div className="grid gap-8">
                <section
                    className="grid gap-8 border-y border-border py-7 lg:grid-cols-[1fr_300px]"
                    data-onboarding={ready ? "active-broker-ready" : undefined}
                >
                    <div>
                        <div className="flex flex-wrap gap-2">
                            <StatusBadge
                                className={
                                    account.last_verified_at
                                        ? "border-[var(--success)] bg-[var(--success-subtle)] text-[var(--success)]"
                                        : "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent-dim)] dark:text-[var(--accent)]"
                                }
                            >
                                {account.last_verified_at ? "Verified" : "Unverified"}
                            </StatusBadge>
                            <StatusBadge className={statusTone(account.session_status)}>
                                {account.session_status ?? "pending"}
                            </StatusBadge>
                        </div>
                        <dl className="mt-5 grid gap-x-10 gap-y-4 text-sm min-[720px]:grid-cols-2">
                            <div>
                                <dt className="font-bold text-muted-foreground">Account ID</dt>
                                <dd className="break-all">{account.id}</dd>
                            </div>
                            <div>
                                <dt className="font-bold text-muted-foreground">Broker</dt>
                                <dd>{brokerNames[account.broker_code]}</dd>
                            </div>
                            <div>
                                <dt className="font-bold text-muted-foreground">Created</dt>
                                <dd>{formatDate(account.created_at)}</dd>
                            </div>
                            <div>
                                <dt className="font-bold text-muted-foreground">Last verified</dt>
                                <dd>{formatDate(account.last_verified_at)}</dd>
                            </div>
                            <div>
                                <dt className="font-bold text-muted-foreground">Session expires</dt>
                                <dd>{formatDate(account.session_expires_at)}</dd>
                            </div>
                            <div>
                                <dt className="font-bold text-muted-foreground">Automation</dt>
                                <dd>
                                    {account.automation_enabled ? (account.automation_mode ?? "Enabled") : "Disabled"}
                                </dd>
                            </div>
                        </dl>
                        {account.last_error ? (
                            <Alert className="mt-5" variant="warning">
                                <AlertDescription>{account.last_error}</AlertDescription>
                            </Alert>
                        ) : null}
                    </div>
                    <div className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
                        <BrokerDetailActions
                            accountId={account.id}
                            permissions={account.access_permissions ?? []}
                            verified={Boolean(account.last_verified_at)}
                        />
                    </div>
                </section>

                <SessionPanel account={account} sessionStatus={sessionStatus} />
                <PortfolioTabs accountId={account.id} sessionActive={sessionStatus.session_active} />
            </div>
        </Shell>
    );
}
