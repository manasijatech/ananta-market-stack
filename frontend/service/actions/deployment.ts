"use server";

import { fetchFastApi } from "@/lib/fastapi";
import type { DeploymentUpdateStatus } from "@/service/types/deployment";

export async function getDeploymentUpdateStatus(): Promise<DeploymentUpdateStatus> {
    const response = await fetchFastApi("/deployment/update-status");
    if (!response.ok) {
        throw new Error("Failed to load deployment update status");
    }
    return (await response.json()) as DeploymentUpdateStatus;
}
