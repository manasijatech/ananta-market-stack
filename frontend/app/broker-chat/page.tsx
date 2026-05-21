import { BrokerChatWorkspace } from "@/components/broker-chat/broker-chat-workspace";
import { PageHeader, Shell } from "@/components/brokers/ui";
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
        <Shell>
            <PageHeader
                eyebrow="Intelligence"
                title="Broker Chat"
                description="Ask the broker data assistant for account, portfolio, quote, instrument, option-chain, margin, and stream status answers using your saved broker and LLM configuration."
            />
            <BrokerChatWorkspace
                initialConfig={config}
                initialRuns={runs}
                initialSessions={sessions}
                llmProviders={systemConfig.llm_providers}
                mcpServer={systemConfig.mcp_server}
            />
        </Shell>
    );
}
