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
 if (pathname === "/alerts") {
  return {
   eyebrow: "Alerts workspace",
   title: "Trading workflows",
   description: "Create, run, and review live market workflows, user alerts, and outbound channels from one workspace.",
   action: <PrimaryLink href="/alerts/workflows/new">+ New workflow</PrimaryLink>
  };
 }

 if (pathname === "/alerts/templates") {
  return {
   eyebrow: "Alerts workspace",
   title: "Templates",
   description: "Immutable system templates that you can instantiate into editable user workflows."
  };
 }

 if (pathname === "/alerts/subscriptions") {
  return {
   eyebrow: "Alerts workspace",
   title: "Subscribed symbols",
   description: "Manage reusable symbol subscriptions that feed workflows and live data consumers."
  };
 }

 if (pathname === "/alerts/stream-manager") {
  return {
   eyebrow: "Alerts workspace",
   title: "Stream manager",
   description: "Inspect live worker health, desired symbol subscriptions, and broker stream session state."
  };
 }

 if (pathname === "/alerts/workflows/new") {
  return {
   eyebrow: "Alerts workspace",
   title: "Create workflow",
   description: "Build a live alert workflow with either the rule form or the graph editor over the same workflow model."
  };
 }

 if (pathname === "/alerts/workflows") {
  const inactive = status === "inactive";
  return {
   eyebrow: "Alerts workspace",
   title: inactive ? "Inactive workflows" : "Active workflows",
   description: "Review configured workflows, including shared multi-symbol rule sets, then jump into editing or switch between active and inactive tracking.",
   action: <PrimaryLink href="/alerts/workflows/new">+ New workflow</PrimaryLink>
  };
 }

 if (pathname.startsWith("/alerts/workflows/")) {
  return {
   eyebrow: "Alerts workspace",
   title: "Workflow editor",
   description: "Edit workflow target sets, conditions, notification channels, and inspect the latest live evaluation history."
  };
 }

 return {
  eyebrow: "Alerts workspace",
  title: "Alerts workspace",
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
 const compactAlertsHeader = pathname.startsWith("/alerts");

 return (
  <HeaderOverrideContext.Provider value={setHeaderOverride}>
   {compactAlertsHeader ? (
    <header className="mb-5 flex max-w-5xl flex-col justify-between gap-4 border-b border-border pb-4 min-[860px]:flex-row min-[860px]:items-end">
     <div>
      <p className="type-page-eyebrow mb-2">{header.eyebrow}</p>
      <h1 className="text-[clamp(30px,4vw,42px)] font-semibold leading-none tracking-normal">{header.title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">{header.description}</p>
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
