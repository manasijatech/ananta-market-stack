import { AlertsWorkspaceChrome } from "@/components/alerts/alerts-workspace-chrome";

export default function AlertsLayout({ children }: { children: React.ReactNode }) {
    return (
        <>
            <AlertsWorkspaceChrome>{children}</AlertsWorkspaceChrome>
        </>
    );
}
