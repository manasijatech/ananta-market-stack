"use server";

import { revalidatePath } from "next/cache";
import { fetchFastApi, fetchFastApiPublic } from "@/lib/fastapi";
import type { BrokerAccountGrant, RbacPrincipal, RoleDefinition, SignupStatus, WorkspaceMember } from "@/service/types/rbac";

type FastApiValidationItem = {
    loc?: (string | number)[];
    msg?: string;
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseJson(response: Response): Promise<unknown> {
    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    try {
        return JSON.parse(text) as unknown;
    } catch {
        return { detail: text };
    }
}

function validationFieldErrors(detail: unknown): Record<string, string> {
    if (!Array.isArray(detail)) {
        return {};
    }

    return detail.reduce<Record<string, string>>((acc, item: unknown) => {
        if (!isJsonObject(item)) {
            return acc;
        }

        const loc = Array.isArray(item.loc) ? item.loc : [];
        const field = loc.length ? String(loc[loc.length - 1]) : "form";
        const message = typeof item.msg === "string" ? item.msg : "Invalid value";
        acc[field] = message;
        return acc;
    }, {});
}

function extractMessage(payload: unknown, fallback: string): string {
    if (!isJsonObject(payload)) {
        return fallback;
    }

    const detail = payload.detail;
    if (typeof detail === "string") {
        return detail;
    }
    if (Array.isArray(detail)) {
        const first = detail.find((item: unknown): item is FastApiValidationItem => {
            return isJsonObject(item) && typeof item.msg === "string";
        });
        if (first?.msg) {
            return first.msg;
        }
    }
    if (typeof payload.message === "string") {
        return payload.message;
    }
    return fallback;
}

async function readResponse<T>(response: Response): Promise<T> {
    const payload = await parseJson(response);

    if (!response.ok) {
        const fieldErrors =
            response.status === 422 && isJsonObject(payload) ? validationFieldErrors(payload.detail) : {};
        const message =
            response.status >= 500
                ? "The workspace access service is unavailable. Please try again."
                : extractMessage(payload, "Request failed.");
        throw new Error(JSON.stringify({ status: response.status, message, fieldErrors }));
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
    const response = await fetchFastApiPublic("/rbac/signup-status");
    return readResponse<SignupStatus>(response);
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

export async function removeWorkspaceMember(userId: string): Promise<void> {
    const response = await fetchFastApi(`/rbac/members/${userId}/remove`, {
        method: "POST"
    });
    if (!response.ok) {
        await readResponse(response);
    }
    revalidatePath("/settings/access");
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
