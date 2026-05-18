import Link from "next/link";
import { PageHeader, Shell } from "@/components/brokers/ui";

const quickAccessItems = [
  {
    href: "/broker-connections",
    label: "Broker Connections",
    description: "Connect, verify, and refresh broker sessions for portfolio and live data access."
  },
  {
    href: "/alerts-workspace",
    label: "Alerts Workspace",
    description: "Manage workflows, live subscriptions, alert history, and stream health."
  },
  {
    href: "/alert-channels",
    label: "Alert Channels",
    description: "Save Discord and Telegram delivery credentials and test outbound channels."
  },
  {
    href: "/system-config",
    label: "System Config",
    description: "Manage broker-data behavior, encrypted provider credentials, and saved LLM models."
  }
];

export default function DashboardPage() {
  return (
    <Shell>
      <PageHeader
        eyebrow="Workspace"
        title="Dashboard"
        description="Monitor broker readiness, user alerting, and live market workflow infrastructure from one workspace."
      />

      <section className="grid gap-4 min-[960px]:grid-cols-3">
        {quickAccessItems.map((item) => (
          <Link
            className=" border border-border p-5 transition hover:border-primary/40"
            href={item.href}
            key={item.href}
          >
            <div className="text-lg font-bold">{item.label}</div>
            <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
          </Link>
        ))}
      </section>
    </Shell>
  );
}
