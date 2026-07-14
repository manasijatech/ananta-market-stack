import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AccessDeniedState } from "@/components/access/access-denied-state";
import { BrokerDataTest } from "@/components/brokers/broker-data-test";
import { PageHeader, brokerNames } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { formatUserFacingError, isMissingOrInaccessibleError, isPermissionDeniedError } from "@/lib/api-errors";
import { canUseBrokerData } from "@/lib/rbac";
import { getPublicApiBaseUrl } from "@/lib/runtime-config";
import { getBrokerAccount, getDataCapabilities, getSessionStatus, getStreamStatus } from "@/service/actions/broker";

type BrokerDataTestPageProps = {
    params: Promise<{ id: string }>;
};

export default async function BrokerDataTestPage({ params }: BrokerDataTestPageProps) {
    const { id } = await params;
    let loadError = "";

    try {
        const account = await getBrokerAccount(id);
        if (!canUseBrokerData(account)) {
            return (
                <AccessDeniedState
                    title="Broker data tools"
                    description="The data test page is only available when your role can use broker portfolio and market data."
                    reason="Ask an admin to grant `Use portfolio and market data` access on this broker account."
                    backHref={`/broker-connections/${account.id}`}
                    backLabel="Back to broker account"
                />
            );
        }

        const [sessionStatus, capabilities, streamStatus] = await Promise.all([
            getSessionStatus(account.id, account.broker_code),
            getDataCapabilities(account.id),
            getStreamStatus(account.id)
        ]);
        const apiBaseUrl = getPublicApiBaseUrl();

        return (
            <>
                <PageHeader
                    eyebrow={brokerNames[account.broker_code]}
                    title={`${account.label} data APIs`}
                    description="Exercise the uniform read-only broker data layer, inspect raw payloads, and test the websocket inspection flow."
                    action={
                        <Button asChild variant="outline">
                            <Link href={`/broker-connections/${account.id}`}>
                                <ArrowLeft className="size-4" aria-hidden="true" />
                                Back to broker
                            </Link>
                        </Button>
                    }
                />
                <BrokerDataTest
                    account={account}
                    apiBaseUrl={apiBaseUrl}
                    initialCapabilities={capabilities}
                    initialStreamStatus={streamStatus}
                    sessionActive={sessionStatus.session_active}
                />
            </>
        );
    } catch (caught) {
        if (isPermissionDeniedError(caught) || isMissingOrInaccessibleError(caught)) {
            return (
                <AccessDeniedState
                    title="Broker data tools"
                    description="The data test page is only available for broker accounts that are shared with enough data permissions."
                    reason="This broker account is unavailable to your current role, or it is no longer shared with the required access."
                    backHref="/broker-connections"
                    backLabel="Back to broker connections"
                />
            );
        }
        loadError = formatUserFacingError(caught, "Could not load this broker data page.");
    }

    return (
        <>
            <PageHeader
                eyebrow="Broker account"
                title="Broker data tools"
                description="Exercise the uniform read-only broker data layer, inspect raw payloads, and test the websocket inspection flow."
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
                <AlertDescription>{loadError || "This broker data page could not be loaded."}</AlertDescription>
            </Alert>
        </>
    );
}
