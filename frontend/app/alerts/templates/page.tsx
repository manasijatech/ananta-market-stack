import Link from "next/link";
import { AlertsNav } from "@/components/alerts/alerts-nav";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { getAlertTemplates } from "@/service/actions/alerts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AlertTemplatesPage() {
  const templates = await getAlertTemplates();

  return (
    <Shell>
      <PageHeader
        eyebrow="Alerts workspace"
        title="Templates"
        description="Immutable system templates that you can instantiate into editable user workflows."
      />
      <AlertsNav />
      <section className="grid gap-4 min-[960px]:grid-cols-2">
        {templates.map((template) => (
          <Card key={template.id}>
            <CardHeader>
              <CardTitle>{template.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">{template.description}</p>
              <div className="mt-3 text-xs font-bold uppercase text-muted-foreground">{template.category}</div>
              <div className="mt-5">
                <Button asChild type="button">
                  <Link href={`/alerts/workflows/new?template=${template.id}`}>Use template</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
    </Shell>
  );
}
