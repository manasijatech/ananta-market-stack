import { BrokerChatWorkspace } from "@/components/broker-chat/broker-chat-workspace";
import { getSystemConfig } from "@/service/actions/broker";
import { getBrokerChatConfig, getBrokerChatRuns, getBrokerChatSessions } from "@/service/actions/broker-chat";

export default async function BrokerChatPage() {
    const [config, sessions, runs, systemConfig] = await Promise.all([
        getBrokerChatConfig(),
        getBrokerChatSessions(80),
        getBrokerChatRuns({ limit: 160 }),
        getSystemConfig()
    ]);

    return (
        <>
            <div className="flex h-[calc(100dvh-7rem)] min-h-0 flex-col min-[980px]:h-[calc(100dvh-10rem)]">
                <BrokerChatWorkspace
                    initialConfig={config}
                    initialRuns={runs}
                    initialSessions={sessions}
                    llmProviders={systemConfig.llm_providers}
                    mcpServer={systemConfig.mcp_server}
                    mcpServers={systemConfig.mcp_servers}
                />
            </div>
        </>
    );
}
