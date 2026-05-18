"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertsNav } from "@/components/alerts/alerts-nav";
import { PageHeader, PrimaryLink } from "@/components/brokers/ui";

type HeaderConfig = {
 eyebrow: string;
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
   eyebrow: "Alerts Workspace",
   title: "Alerts Workspace",
   description: "Create, run, and review live market workflows, user alerts, and outbound channels from one workspace.",
   action: <PrimaryLink href="/alerts-workspace/workflows/new">+ New workflow</PrimaryLink>
  };
 }

 if (pathname === "/alerts-workspace/templates") {
  return {
   eyebrow: "Alerts Workspace",
   title: "Templates",
   description: "Immutable system templates that you can instantiate into editable user workflows."
  };
 }

 if (pathname === "/alerts-workspace/subscriptions") {
  return {
   eyebrow: "Alerts Workspace",
   title: "Subscriptions",
   description: "Manage reusable symbol subscriptions that feed workflows and live data consumers."
  };
 }

 if (pathname === "/alerts-workspace/stream-manager") {
  return {
   eyebrow: "Alerts Workspace",
   title: "Stream Manager",
   description: "Inspect live worker health, desired symbol subscriptions, and broker stream session state."
  };
 }

 if (pathname === "/alerts-workspace/workflows/new") {
  return {
   eyebrow: "Alerts Workspace",
   title: "Create Workflow",
   description: "Build a live alert workflow with either the rule form or the graph editor over the same workflow model."
  };
 }

 if (pathname === "/alerts-workspace/workflows") {
  const inactive = status === "inactive";
  return {
   eyebrow: "Alerts Workspace",
   title: inactive ? "Inactive Workflows" : "Active Workflows",
   description: "Review configured workflows, including shared multi-symbol rule sets, then jump into editing or switch between active and inactive tracking.",
   action: <PrimaryLink href="/alerts-workspace/workflows/new">+ New workflow</PrimaryLink>
  };
 }

 if (pathname.startsWith("/alerts-workspace/workflows/")) {
  return {
   eyebrow: "Alerts Workspace",
   title: "Workflow Editor",
   description: "Edit workflow target sets, conditions, notification channels, and inspect the latest live evaluation history."
  };
 }

 return {
  eyebrow: "Alerts Workspace",
  title: "Alerts Workspace",
  description: "Create, run, and review live market workflows, user alerts, and outbound channels from one workspace."
 };
}

export function AlertsWorkspaceChrome({ children }: { children: React.ReactNode }) {
 const pathname = usePathname();
 const searchParams = useSearchParams();
 const [override, setOverride] = useState<HeaderOverrideState | null>(null);
 const setHeaderOverride = useCallback((nextHeader: HeaderOverride) => {
  setOverride({ pathname, header: nextHeader });
 }, [pathname]);
 const routeHeader = headerForRoute(pathname, searchParams.get("status"));
 const header = {
  ...routeHeader,
  ...(override?.pathname === pathname ? override.header : null)
 };
 const compactAlertsHeader = pathname.startsWith("/alerts-workspace");

 return (
  <HeaderOverrideContext.Provider value={setHeaderOverride}>
   {compactAlertsHeader ? (
    <header className="mb-4 flex min-w-0 flex-col justify-between gap-4 border-b border-border pb-4 min-[860px]:flex-row min-[860px]:items-end">
     <div className="min-w-0">
      <p className="type-page-eyebrow mb-2">{header.eyebrow}</p>
      <h1 className="text-[clamp(28px,3vw,38px)] font-semibold leading-none tracking-normal">{header.title}</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{header.description}</p>
     </div>
     {header.action}
    </header>
   ) : (
    <PageHeader
     eyebrow={header.eyebrow}
     title={header.title}
     description={header.description}
     action={header.action}
    />
   )}
   <AlertsNav />
   {children}
  </HeaderOverrideContext.Provider>
 );
}

export function AlertsHeaderOverride({ description, eyebrow, title }: HeaderOverride) {
 const setHeader = useContext(HeaderOverrideContext);

 useEffect(() => {
  const nextHeader: HeaderOverride = {};
  if (description !== undefined) nextHeader.description = description;
  if (eyebrow !== undefined) nextHeader.eyebrow = eyebrow;
  if (title !== undefined) nextHeader.title = title;
  setHeader?.(nextHeader);
 }, [description, eyebrow, setHeader, title]);

 return null;
}
