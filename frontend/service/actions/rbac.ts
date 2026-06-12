"use server";

import { revalidatePath } from "next/cache";
import { fetchFastApi } from "@/lib/fastapi";
import type { BrokerAccountGrant, RbacPrincipal, RoleDefinition, SignupStatus, WorkspaceMember } from "@/service/types/rbac";

async function readResponse<T>(response: Response): Promise<T> {
    const text = await response.text();
    const payload = text ? (JSON.parse(text) as unknown) : null;
    if (!response.ok) {
        const detail =
            payload && typeof payload === "object" && "detail" in payload
                ? String((payload as { detail?: unknown }).detail)
                : "Request failed.";
        throw new Error(detail);
    }
    return payload as T;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetchFastApi(path, {
        ...init,
        headers: {
            ...(init.body ? { "content-type": "application/json" } : {}),
            ...Object.fromEntries(new Headers(init.headers).entries())
        }
    });
    return readResponse<T>(response);
}

export async function getRbacMe(): Promise<RbacPrincipal> {
    return request<RbacPrincipal>("/rbac/me");
}

export async function getSignupStatus(): Promise<SignupStatus> {
    return request<SignupStatus>("/rbac/signup-status");
}

export async function getWorkspaceMembers(): Promise<WorkspaceMember[]> {
    return request<WorkspaceMember[]>("/rbac/members");
}

export async function getWorkspaceRoles(): Promise<RoleDefinition[]> {
    return request<RoleDefinition[]>("/rbac/roles");
}

export async function approveWorkspaceMember(userId: string, role: string): Promise<WorkspaceMember> {
    const result = await request<WorkspaceMember>(`/rbac/members/${userId}/approve`, {
        method: "POST",
        body: JSON.stringify({ role })
    });
    revalidatePath("/settings/access");
    return result;
}

export async function updateWorkspaceMemberRole(userId: string, role: string): Promise<WorkspaceMember> {
    const result = await request<WorkspaceMember>(`/rbac/members/${userId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role })
    });
    revalidatePath("/settings/access");
    return result;
}

export async function disableWorkspaceMember(userId: string): Promise<WorkspaceMember> {
    const result = await request<WorkspaceMember>(`/rbac/members/${userId}/disable`, {
        method: "POST"
    });
    revalidatePath("/settings/access");
    return result;
}

export async function getBrokerAccountGrants(accountId: string): Promise<BrokerAccountGrant[]> {
    return request<BrokerAccountGrant[]>(`/rbac/broker-accounts/${accountId}/grants`);
}

export async function upsertBrokerAccountGrant(input: {
    accountId: string;
    subjectType: "user" | "role";
    subjectId: string;
    permissions: string[];
}): Promise<BrokerAccountGrant> {
    const result = await request<BrokerAccountGrant>(`/rbac/broker-accounts/${input.accountId}/grants`, {
        method: "PUT",
        body: JSON.stringify({
            subject_type: input.subjectType,
            subject_id: input.subjectId,
            permissions: input.permissions
        })
    });
    revalidatePath("/settings/access");
    return result;
}
