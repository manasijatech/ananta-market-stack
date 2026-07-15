import { BrokerChatWorkspace } from "@/components/broker-chat/broker-chat-workspace";
import { getSystemConfig } from "@/service/actions/broker";
import { getBrokerChatConfig, getBrokerChatRuns, getBrokerChatSessions } from "@/service/actions/broker-chat";
import { getOpenRouterModels } from "@/service/actions/llm-models";

export default async function BrokerChatPage() {
    const [config, sessions, runs, systemConfig, openRouterModels] = await Promise.all([
        getBrokerChatConfig(),
        getBrokerChatSessions(80),
        getBrokerChatRuns({ limit: 160 }),
        getSystemConfig(),
        getOpenRouterModels()
    ]);

    return (
        <>
            <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-1 flex-col min-[980px]:h-auto">
                <BrokerChatWorkspace
                    initialConfig={config}
                    initialRuns={runs}
                    initialSessions={sessions}
                    llmProviders={systemConfig.llm_providers}
                    mcpServer={systemConfig.mcp_server}
                    mcpServers={systemConfig.mcp_servers}
                    openRouterModels={openRouterModels}
                />
            </div>
        </>
    );
}
