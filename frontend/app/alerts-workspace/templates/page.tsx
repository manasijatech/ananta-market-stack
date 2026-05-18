import Link from "next/link";
import { getAlertTemplates } from "@/service/actions/alerts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AlertTemplatesPage() {
 const templates = await getAlertTemplates();

 return (
 <section className="grid gap-4 min-[960px]:grid-cols-2">
 {templates.map((template) => (
 <Card key={template.id}>
 <CardHeader>
 <CardTitle>{template.name}</CardTitle>
 </CardHeader>
 <CardContent>
 <p className="type-body text-muted-foreground">{template.description}</p>
 <div className="type-step-eyebrow mt-3">{template.category}</div>
 <div className="mt-5">
 <Button asChild type="button">
 <Link href={`/alerts-workspace/workflows/new?template=${template.id}`}>Create workflow from template</Link>
 </Button>
 </div>
 </CardContent>
 </Card>
 ))}
 </section>
 );
}
