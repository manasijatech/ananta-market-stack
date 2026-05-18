"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

const items = [
 { href: "/alerts-workspace", label: "Overview" },
 { href: "/alerts-workspace/workflows", label: "Active Workflows" },
 { href: "/alerts-workspace/workflows?status=inactive", label: "Inactive Workflows" },
 { href: "/alerts-workspace/workflows/new", label: "Create Workflow" },
 { href: "/alerts-workspace/templates", label: "Templates" },
 { href: "/alerts-workspace/subscriptions", label: "Subscriptions" },
 { href: "/alerts-workspace/stream-manager", label: "Stream Manager" }
];

export function AlertsNav() {
 const pathname = usePathname();
 const searchParams = useSearchParams();

 return (
 <nav className="mb-5 flex flex-wrap gap-1.5" aria-label="Alerts workspace">
 {items.map((item) => {
 const [itemPath, itemQuery] = item.href.split("?");
 const active = (() => {
 if (itemQuery) {
 const status = new URLSearchParams(itemQuery).get("status");
 return pathname === itemPath && (searchParams.get("status") ?? "active") === (status ?? "active");
 }
 if (itemPath === "/alerts-workspace") return pathname === "/alerts-workspace";
 if (itemPath === "/alerts-workspace/workflows") return pathname === "/alerts-workspace/workflows" && !searchParams.get("status");
 return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
 })();
 return (
 <Link
 className={active ? "border border-primary bg-primary px-2.5 py-1.5 text-sm font-semibold text-primary-foreground" : "border border-border px-2.5 py-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground"}
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
