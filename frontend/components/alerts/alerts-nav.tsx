"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { typography } from "@/lib/typography";
import { cn } from "@/lib/utils";

const items = [
    { href: "/alerts-workspace", label: "Overview" },
    { href: "/alerts-workspace/workflows", label: "Active Workflows" },
    { href: "/alerts-workspace/workflows?status=inactive", label: "Inactive Workflows" }
];

export function AlertsNav() {
    const pathname = usePathname();
    const searchParams = useSearchParams();

    return (
        <nav
            className="alerts-workspace-nav -mx-4 mb-4 flex min-w-0 gap-4 overflow-x-auto border-b border-border px-4 pb-0 min-[760px]:mx-0 min-[760px]:overflow-visible min-[760px]:px-0"
            aria-label="Alerts workspace"
        >
            {items.map((item) => {
                const [itemPath, itemQuery] = item.href.split("?");
                const active = (() => {
                    if (itemQuery) {
                        const status = new URLSearchParams(itemQuery).get("status");
                        return (
                            pathname === itemPath && (searchParams.get("status") ?? "active") === (status ?? "active")
                        );
                    }
                    if (itemPath === "/alerts-workspace") return pathname === "/alerts-workspace";
                    if (itemPath === "/alerts-workspace/workflows")
                        return pathname === "/alerts-workspace/workflows" && !searchParams.get("status");
                    return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
                })();
                return (
                    <Link
                        className={cn(
                            typography.small,
                            "shrink-0 whitespace-nowrap border-b-2 px-1 pb-2.5 transition-colors",
                            active
                                ? "border-primary text-foreground"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
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
