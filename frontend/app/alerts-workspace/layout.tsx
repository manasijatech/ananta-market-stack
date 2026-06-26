import { AlertsWorkspaceChrome } from "@/components/alerts/alerts-workspace-chrome";
import { Shell } from "@/components/brokers/shell";

export default function AlertsLayout({ children }: { children: React.ReactNode }) {
    return (
        <Shell>
            <AlertsWorkspaceChrome>{children}</AlertsWorkspaceChrome>
        </Shell>
    );
}
