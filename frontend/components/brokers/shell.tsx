import "server-only";

import { requireActiveWorkspace } from "@/lib/auth-guards";
import { WorkspaceShell } from "@/components/workspace-shell";

/** Authenticated app layout with server-side session and RBAC enforcement. */
export async function Shell({ children }: { children: React.ReactNode }) {
    const principal = await requireActiveWorkspace();

    return <WorkspaceShell principal={principal}>{children}</WorkspaceShell>;
}
