import { SystemConfigPanel } from "@/components/system/system-config-panel";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getSystemConfig } from "@/service/actions/broker";

export default async function SystemConfigPage() {
  const config = await getSystemConfig();

  return (
    <Shell>
      <PageHeader
        eyebrow="Workspace"
        title="System config"
        description="Manage project-wide broker data behavior, encrypted LLM provider credentials, and saved provider models."
      />
      <SystemConfigPanel initialConfig={config} />
    </Shell>
  );
}
