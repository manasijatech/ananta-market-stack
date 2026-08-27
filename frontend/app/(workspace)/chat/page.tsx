import { notFound } from "next/navigation";
import { AdaptiveWorkspaceShell } from "@/components/adaptive-workspace/adaptive-workspace-shell";
import { parseActionError } from "@/components/brokers/action-error";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { isAdaptiveWorkspaceEnabled } from "@/lib/adaptive-workspace/feature";
import { getSystemConfig } from "@/service/actions/broker";
import { getBrokerChatConfig, getBrokerChatRuns, getBrokerChatSessions } from "@/service/actions/broker-chat";
import { getOpenRouterModels } from "@/service/actions/llm-models";
import type { OpenRouterModel } from "@/service/actions/llm-models";
import type { McpServerConfig } from "@/service/types/broker";
import type { BrokerChatRun, BrokerChatSession } from "@/service/types/broker-chat";

const emptyMcpServer: McpServerConfig = {
    is_enabled: false,
    use_by_default: true,
    url: "",
    transport: "streamable_http",
    auth_mode: "oauth",
    has_api_key: false,
    api_key_header_name: "Authorization",
    api_key_prefix: "Bearer",
    oauth_authenticated: false,
    inventory: {},
    extra_headers: {},
    timeout_seconds: 15
};

export default async function ChatPage() {
    const systemConfig = await getSystemConfig().catch(() => null);
    if (!systemConfig || !isAdaptiveWorkspaceEnabled(systemConfig)) {
        notFound();
    }

    const [configResult, sessionsResult, openRouterModelsResult] = await Promise.allSettled([
        getBrokerChatConfig(),
        getBrokerChatSessions(80, { surface: "adaptive_workspace" }),
        getOpenRouterModels()
    ]);

    if (configResult.status === "rejected" || sessionsResult.status === "rejected") {
        const reason =
            configResult.status === "rejected"
                ? configResult.reason
                : sessionsResult.status === "rejected"
                  ? sessionsResult.reason
                  : null;
        return (
            <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-1 flex-col min-[980px]:h-full">
                <Alert className="m-4" variant="warning">
                    <AlertDescription>
                        Chat is temporarily unavailable. {parseActionError(reason).message}
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const config = configResult.value;
    const sessions = sessionsResult.value;
    const openRouterModels: OpenRouterModel[] =
        openRouterModelsResult.status === "fulfilled" ? openRouterModelsResult.value : [];

    let runs: BrokerChatRun[] = [];
    if (sessions[0]) {
        try {
            runs = await getBrokerChatRuns({ sessionId: sessions[0].id, limit: 80 });
        } catch {
            runs = [];
        }
    }

    return (
        <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-1 flex-col min-[980px]:h-full">
            <AdaptiveWorkspaceShell
                initialConfig={config}
                initialRuns={runs}
                initialSessions={sessions as BrokerChatSession[]}
                llmProviders={systemConfig.llm_providers}
                mcpServer={systemConfig.mcp_server ?? emptyMcpServer}
                mcpServers={systemConfig.mcp_servers}
                openRouterModels={openRouterModels}
            />
        </div>
    );
}
