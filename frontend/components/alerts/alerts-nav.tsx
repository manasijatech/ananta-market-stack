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
 <nav className="-mx-4 mb-4 flex min-w-0 gap-1.5 overflow-x-auto px-4 pb-1 min-[760px]:mx-0 min-[760px]:flex-wrap min-[760px]:overflow-visible min-[760px]:px-0 min-[760px]:pb-0" aria-label="Alerts workspace">
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
 className={active ? "shrink-0 whitespace-nowrap border border-primary bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground min-[760px]:text-sm" : "shrink-0 whitespace-nowrap border border-border px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground min-[760px]:text-sm"}
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
