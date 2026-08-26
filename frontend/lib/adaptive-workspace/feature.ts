import type { SystemConfig } from "@/service/types/broker";

export function isAdaptiveWorkspaceEnabled(
    config: Pick<SystemConfig, "features"> | null | undefined
): boolean {
    return Boolean(config?.features?.adaptive_workspace);
}
