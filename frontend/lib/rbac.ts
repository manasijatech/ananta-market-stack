import type { BrokerAccount } from "@/service/types/broker";
import type { RbacPrincipal } from "@/service/types/rbac";

export function hasRbacPermission(principal: RbacPrincipal | null | undefined, permission: string): boolean {
    if (!principal || principal.status !== "active") {
        return false;
    }
    return principal.is_admin || principal.permissions.includes(permission);
}

export function canManageWorkspaceAccess(principal: RbacPrincipal | null | undefined): boolean {
    return hasRbacPermission(principal, "workspace.manage_members");
}

export function canManageBrokerCredentials(principal: RbacPrincipal | null | undefined): boolean {
    return hasRbacPermission(principal, "broker.manage_credentials");
}

export function canManageBrokerSessions(principal: RbacPrincipal | null | undefined): boolean {
    return hasRbacPermission(principal, "broker.manage_sessions");
}

export function canViewBrokerAccount(account: BrokerAccount | null | undefined): boolean {
    return Boolean(account?.access_permissions?.includes("broker.view"));
}

export function canUseBrokerData(account: BrokerAccount | null | undefined): boolean {
    return Boolean(account?.access_permissions?.includes("broker.use_data"));
}

export function canManageAccountSessions(account: BrokerAccount | null | undefined): boolean {
    return Boolean(account?.access_permissions?.includes("broker.manage_sessions"));
}

export function canDeleteBrokerAccount(account: BrokerAccount | null | undefined): boolean {
    return Boolean(account?.access_permissions?.includes("broker.delete"));
}
