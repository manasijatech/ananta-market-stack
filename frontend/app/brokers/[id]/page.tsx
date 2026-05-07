import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getBrokerAccount, getSessionStatus } from "@/service/actions/broker";
import { BrokerDetailActions } from "@/components/brokers/broker-detail-actions";
import { NotificationsBanner } from "@/components/brokers/notifications-banner";
import { PortfolioTabs } from "@/components/brokers/portfolio-tabs";
import { SessionPanel } from "@/components/brokers/session-panel";
import { brokerNames, formatDate, PageHeader, Shell, StatusBadge, statusTone } from "@/components/brokers/ui";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type BrokerDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function BrokerDetailPage({ params }: BrokerDetailPageProps) {
  const { id } = await params;
  const account = await getBrokerAccount(id);
  const sessionStatus = await getSessionStatus(account.id, account.broker_code);

  return (
    <Shell>
      <PageHeader
        eyebrow={brokerNames[account.broker_code]}
        title={account.label}
        description="Review account status, update broker sessions, fetch quotes, and inspect broker-native portfolio data."
        action={
          <Button asChild variant="outline">
            <Link href="/brokers">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to brokers
            </Link>
          </Button>
        }
      />

      <div className="mb-6">
        <NotificationsBanner />
      </div>

      <div className="grid gap-8">
        <section className="grid gap-8 border-y border-border py-7 lg:grid-cols-[1fr_300px]">
          <div>
            <div className="flex flex-wrap gap-2">
              <StatusBadge className={account.last_verified_at ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"}>
                {account.last_verified_at ? "Verified" : "Unverified"}
              </StatusBadge>
              <StatusBadge className={statusTone(account.session_status)}>
                {account.session_status ?? "pending"}
              </StatusBadge>
            </div>
            <dl className="mt-5 grid gap-x-10 gap-y-4 text-sm min-[720px]:grid-cols-2">
              <div><dt className="font-bold text-muted-foreground">Account ID</dt><dd className="break-all">{account.id}</dd></div>
              <div><dt className="font-bold text-muted-foreground">Broker</dt><dd>{brokerNames[account.broker_code]}</dd></div>
              <div><dt className="font-bold text-muted-foreground">Created</dt><dd>{formatDate(account.created_at)}</dd></div>
              <div><dt className="font-bold text-muted-foreground">Last verified</dt><dd>{formatDate(account.last_verified_at)}</dd></div>
              <div><dt className="font-bold text-muted-foreground">Session expires</dt><dd>{formatDate(account.session_expires_at)}</dd></div>
              <div><dt className="font-bold text-muted-foreground">Automation</dt><dd>{account.automation_enabled ? account.automation_mode ?? "Enabled" : "Disabled"}</dd></div>
            </dl>
            {account.last_error ? (
              <Alert className="mt-5" variant="warning">
                <AlertDescription>{account.last_error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <div className="border-t border-border pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <BrokerDetailActions accountId={account.id} />
          </div>
        </section>

        <SessionPanel account={account} sessionStatus={sessionStatus} />
        <PortfolioTabs accountId={account.id} sessionActive={sessionStatus.session_active} />
      </div>
    </Shell>
  );
}
