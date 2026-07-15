"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { AlertsNav } from "@/components/alerts/alerts-nav";
import { PageHeader, PrimaryLink } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";

type HeaderConfig = {
    title: string;
    description: string;
    action?: React.ReactNode;
};

type HeaderOverride = Partial<Omit<HeaderConfig, "action">>;

type HeaderOverrideState = {
    pathname: string;
    header: HeaderOverride;
};

const HeaderOverrideContext = createContext<((header: HeaderOverride) => void) | null>(null);

function headerForRoute(pathname: string, status: string | null): HeaderConfig {
    if (pathname === "/alerts-workspace") {
        return {
            title: "Alerts Workspace",
            description:
                "Create, run, and review live market workflows, user alerts, and outbound channels from one workspace.",
            action: (
                <div className="flex flex-wrap items-center gap-2">
                    <Button render={<Link href="/alerts-workspace/templates" />} variant="ghost">
                        Browse templates
                    </Button>
                    <Button render={<Link href="/alerts-workspace/workflows/new" />}>
                        Create workflow
                    </Button>
                </div>
            )
        };
    }

    if (pathname === "/alerts-workspace/templates") {
        return {
            title: "Templates",
            description: "Immutable system templates that you can instantiate into editable user workflows."
        };
    }

    if (pathname === "/alerts-workspace/workflows/new") {
        return {
            title: "Create Workflow",
            description:
                "Build a live alert workflow with either the rule form or the graph editor over the same workflow model."
        };
    }

    if (pathname === "/alerts-workspace/workflows") {
        const inactive = status === "inactive";
        return {
            title: inactive ? "Inactive Workflows" : "Active Workflows",
            description:
                "Review configured workflows, including shared multi-symbol rule sets, then jump into editing or switch between active and inactive tracking.",
            action: <PrimaryLink href="/alerts-workspace/workflows/new">+ New workflow</PrimaryLink>
        };
    }

    if (pathname.startsWith("/alerts-workspace/workflows/")) {
        return {
            title: "Workflow Editor",
            description:
                "Edit workflow target sets, conditions, notification channels, and inspect the latest live evaluation history."
        };
    }

    return {
        title: "Alerts Workspace",
        description:
            "Create, run, and review live market workflows, user alerts, and outbound channels from one workspace."
    };
}

export function AlertsWorkspaceChrome({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [override, setOverride] = useState<HeaderOverrideState | null>(null);
    const setHeaderOverride = useCallback(
        (nextHeader: HeaderOverride) => {
            setOverride({ pathname, header: nextHeader });
        },
        [pathname]
    );
    const routeHeader = headerForRoute(pathname, searchParams.get("status"));
    const header = {
        ...routeHeader,
        ...(override?.pathname === pathname ? override.header : null)
    };
    return (
        <HeaderOverrideContext.Provider value={setHeaderOverride}>
            <PageHeader
                action={header.action}
                description={header.description}
                title={header.title}
            />
            <AlertsNav />
            {children}
        </HeaderOverrideContext.Provider>
    );
}

export function AlertsHeaderOverride({ description, title }: HeaderOverride) {
    const setHeader = useContext(HeaderOverrideContext);

    useEffect(() => {
        const nextHeader: HeaderOverride = {};
        if (description !== undefined) nextHeader.description = description;
        if (title !== undefined) nextHeader.title = title;
        setHeader?.(nextHeader);
    }, [description, setHeader, title]);

    return null;
}
