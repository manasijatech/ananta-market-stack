export interface RbacWorkspace {
    id: string;
    name: string;
}

export interface RbacPrincipal {
    user_id: string;
    workspace: RbacWorkspace;
    role: string;
    status: "active" | "pending" | "disabled" | string;
    permissions: string[];
    is_admin: boolean;
}

export interface WorkspaceMember {
    user_id: string;
    display_name?: string | null;
    auth_name?: string | null;
    email?: string | null;
    role: string;
    status: string;
    is_owner?: boolean;
    created_at: string;
    updated_at: string;
}

export interface RoleDefinition {
    name: string;
    label: string;
    is_builtin: boolean;
    permissions: string[];
}

export interface BrokerAccountGrant {
    id: string;
    account_id: string;
    subject_type: "user" | "role";
    subject_id: string;
    subject_label: string;
    subject_subtitle?: string | null;
    permissions: string[];
    created_at: string;
    updated_at: string;
}

export interface SignupStatus {
    has_admin: boolean;
}
