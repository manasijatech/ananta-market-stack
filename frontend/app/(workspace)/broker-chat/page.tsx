import { parseActionError } from "@/components/brokers/action-error";
import { BrokerChatWorkspace } from "@/components/broker-chat/broker-chat-workspace";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getSystemConfig } from "@/service/actions/broker";
import { getBrokerChatConfig, getBrokerChatRuns, getBrokerChatSessions } from "@/service/actions/broker-chat";
import { getOpenRouterModels } from "@/service/actions/llm-models";
import type { McpServerConfig } from "@/service/types/broker";

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

export default async function BrokerChatPage() {
    const [configResult, sessionsResult, runsResult, systemConfigResult, openRouterModelsResult] =
        await Promise.allSettled([
            getBrokerChatConfig(),
            getBrokerChatSessions(80),
            getBrokerChatRuns({ limit: 160 }),
            getSystemConfig(),
            getOpenRouterModels()
        ]);

    if (configResult.status === "rejected" || sessionsResult.status === "rejected") {
        const reason = configResult.status === "rejected" ? configResult.reason : sessionsResult.reason;
        return (
            <div className="grid w-full min-w-0 gap-5 px-5 py-5">
                <h1 className="font-heading text-3xl font-semibold tracking-tight">Chat</h1>
                <Alert variant="warning">
                    <AlertDescription>
                        Chat is temporarily unavailable. {parseActionError(reason).message}
                    </AlertDescription>
                </Alert>
            </div>
        );
    }

    const systemConfig = systemConfigResult.status === "fulfilled" ? systemConfigResult.value : null;

    return (
        <>
            <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-1 flex-col min-[980px]:h-auto">
                <BrokerChatWorkspace
                    initialConfig={configResult.value}
                    initialRuns={runsResult.status === "fulfilled" ? runsResult.value : []}
                    initialSessions={sessionsResult.value}
                    llmProviders={systemConfig?.llm_providers ?? []}
                    mcpServer={systemConfig?.mcp_server ?? emptyMcpServer}
                    mcpServers={systemConfig?.mcp_servers ?? []}
                    openRouterModels={openRouterModelsResult.status === "fulfilled" ? openRouterModelsResult.value : []}
                />
            </div>
        </>
    );
}
