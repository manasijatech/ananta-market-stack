import { Suspense } from "react";
import { AlertsWorkspaceChrome } from "@/components/alerts/alerts-workspace-chrome";

export default function AlertsLayout({ children }: { children: React.ReactNode }) {
    return (
        <Suspense fallback={null}>
            <AlertsWorkspaceChrome>{children}</AlertsWorkspaceChrome>
        </Suspense>
    );
}
