"use server";

import { fetchFastApi } from "@/lib/fastapi";
import type { DeploymentUpdateStatus } from "@/service/types/deployment";

export async function getDeploymentUpdateStatus(): Promise<DeploymentUpdateStatus | null> {
    const response = await fetchFastApi("/deployment/update-status");
    if (!response.ok) {
        return null;
    }
    return (await response.json()) as DeploymentUpdateStatus;
}
