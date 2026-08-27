import { notFound } from "next/navigation";
import { AdaptiveWorkspaceShell } from "@/components/adaptive-workspace/adaptive-workspace-shell";
import { isAdaptiveWorkspaceEnabled } from "@/lib/adaptive-workspace/feature";
import { getSystemConfig } from "@/service/actions/broker";
import { getBrokerChatConfig, getBrokerChatRuns, getBrokerChatSessions } from "@/service/actions/broker-chat";
import { getOpenRouterModels } from "@/service/actions/llm-models";

export default async function AdaptiveWorkspacePage() {
    const systemConfig = await getSystemConfig().catch(() => null);
    if (!isAdaptiveWorkspaceEnabled(systemConfig)) {
        notFound();
    }

    const [config, sessions, openRouterModels] = await Promise.all([
        getBrokerChatConfig(),
        getBrokerChatSessions(80, { surface: "adaptive_workspace" }),
        getOpenRouterModels()
    ]);
    const runs = sessions[0] ? await getBrokerChatRuns({ sessionId: sessions[0].id, limit: 80 }) : [];

    return (
        <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-1 flex-col min-[980px]:h-full">
            <AdaptiveWorkspaceShell
                initialConfig={config}
                initialRuns={runs}
                initialSessions={sessions}
                llmProviders={systemConfig.llm_providers}
                mcpServer={systemConfig.mcp_server}
                mcpServers={systemConfig.mcp_servers}
                openRouterModels={openRouterModels}
            />
        </div>
    );
}
