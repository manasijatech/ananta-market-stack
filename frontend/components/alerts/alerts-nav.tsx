"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/alerts", label: "Overview" },
  { href: "/alerts/workflows", label: "Active Workflows" },
  { href: "/alerts/workflows?status=inactive", label: "Inactive Workflows" },
  { href: "/alerts/workflows/new", label: "Create Workflow" },
  { href: "/alerts/templates", label: "Templates" },
  { href: "/alerts/subscriptions", label: "Subscriptions" },
  { href: "/alerts/stream-manager", label: "Stream Manager" }
];

export function AlertsNav() {
  const pathname = usePathname();

  return (
    <nav className="mb-8 flex flex-wrap gap-2" aria-label="Alerts workspace">
      {items.map((item) => {
        const active = pathname === item.href || (item.href.includes("?") ? pathname === item.href.split("?")[0] : pathname.startsWith(`${item.href}/`));
        return (
          <Link
            className={active ? "rounded-full border border-primary bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground" : "rounded-full border border-border px-3 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"}
            href={item.href}
            key={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
