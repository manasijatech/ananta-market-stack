import Link from "next/link";
import { ArrowLeft, ShieldCheck, WalletCards } from "lucide-react";
import { AccessDeniedState } from "@/components/access/access-denied-state";
import { getBrokerAccount, getSessionStatus } from "@/service/actions/broker";
import { BrokerDetailActions } from "@/components/brokers/broker-detail-actions";
import { InstrumentSyncBanner } from "@/components/brokers/instrument-sync-banner";
import { NotificationsBanner } from "@/components/brokers/notifications-banner";
import { PortfolioTabs } from "@/components/brokers/portfolio-tabs";
import { SessionPanel } from "@/components/brokers/session-panel";
import { BrokerLogo, brokerNames, formatDate, PageHeader, StatusBadge } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardFrame,
    CardFrameAction,
    CardFrameDescription,
    CardFrameHeader,
    CardFrameTitle,
    CardPanel
} from "@/components/ui/card";
import { formatUserFacingError, isMissingOrInaccessibleError, isPermissionDeniedError } from "@/lib/api-errors";
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
        if (isPermissionDeniedError(caught) || isMissingOrInaccessibleError(caught)) {
            return (
                <AccessDeniedState
                    title="Broker account access"
                    description="Broker account details are only shown when that account is shared with your role."
                    reason="This broker account is unavailable to your current role, or it is no longer shared with you."
                    backHref="/broker-connections"
                    backLabel="Back to broker connections"
                />
            );
        }
        loadError = formatUserFacingError(caught, "Could not load this broker account.");
    }

    if (!account || !sessionStatus) {
        return (
            <>
                <PageHeader
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
                    <AlertDescription>{loadError || "This broker account could not be loaded."}</AlertDescription>
                </Alert>
            </>
        );
    }

    const showInstrumentSync = sessionStatus.session_active || Boolean(account.last_verified_at);
    const sessionReady = account.session_status === "active" || account.session_status === "automation_ready";

    return (
        <>
            <PageHeader
                title={account.label}
                description="Manage the broker session used for live data, quotes, and portfolio views."
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

            <div className="grid gap-6">
                <CardFrame>
                    <CardFrameHeader>
                        <CardFrameTitle className="flex items-center gap-3 text-lg font-semibold">
                            <BrokerLogo broker={account.broker_code} className="size-9" imageClassName="size-8" />
                            Broker connection
                        </CardFrameTitle>
                        <CardFrameDescription>
                            Current readiness for data refreshes and portfolio access.
                        </CardFrameDescription>
                        <CardFrameAction>
                            <div className="flex flex-wrap justify-end gap-2">
                                <StatusBadge variant={account.last_verified_at ? "success" : "warning"}>
                                    {account.last_verified_at ? "Verified" : "Needs verification"}
                                </StatusBadge>
                                <StatusBadge variant={sessionReady ? "success" : "warning"}>
                                    {account.session_status === "automation_ready"
                                        ? "Automation ready"
                                        : sessionReady
                                          ? "Session active"
                                          : "Session needed"}
                                </StatusBadge>
                            </div>
                        </CardFrameAction>
                    </CardFrameHeader>
                    <Card>
                        <CardPanel className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                            <div className="grid gap-4 min-[720px]:grid-cols-3">
                                <div className="rounded-lg bg-muted/50 p-4">
                                    <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                                        <WalletCards className="size-4" aria-hidden="true" />
                                        Broker
                                    </div>
                                    <p className="mt-2 text-sm font-semibold">{brokerNames[account.broker_code]}</p>
                                </div>
                                <div className="rounded-lg bg-muted/50 p-4">
                                    <div className="flex items-center gap-2 text-xs font-medium uppercase text-muted-foreground">
                                        <ShieldCheck className="size-4" aria-hidden="true" />
                                        Last checked
                                    </div>
                                    <p className="mt-2 text-sm font-semibold">
                                        {account.last_verified_at
                                            ? formatDate(account.last_verified_at)
                                            : "Not verified yet"}
                                    </p>
                                </div>
                                <div className="rounded-lg bg-muted/50 p-4">
                                    <div className="text-xs font-medium uppercase text-muted-foreground">Session</div>
                                    <p className="mt-2 text-sm font-semibold">
                                        {account.session_expires_at
                                            ? `Expires ${formatDate(account.session_expires_at)}`
                                            : "Sign in required"}
                                    </p>
                                </div>
                            </div>
                            <div className="border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
                                <BrokerDetailActions
                                    accountId={account.id}
                                    permissions={account.access_permissions ?? []}
                                    verified={Boolean(account.last_verified_at)}
                                />
                            </div>
                            {account.last_error ? (
                                <Alert className="lg:col-span-2" variant="warning">
                                    <AlertDescription>{account.last_error}</AlertDescription>
                                </Alert>
                            ) : null}
                        </CardPanel>
                    </Card>
                </CardFrame>

                <SessionPanel account={account} sessionStatus={sessionStatus} />
                <PortfolioTabs accountId={account.id} sessionActive={sessionStatus.session_active} />
            </div>
        </>
    );
}
