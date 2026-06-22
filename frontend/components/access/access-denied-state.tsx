import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { BackButton } from "@/components/access/back-button";
import { PageHeader, Shell } from "@/components/brokers/ui";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function AccessDeniedState({
    title = "Access not available",
    description = "This area is restricted for your current workspace role.",
    reason = "Ask a workspace admin to grant the required access, then try again.",
    backHref = "/dashboard",
    backLabel = "Go to dashboard"
}: {
    title?: string;
    description?: string;
    reason?: string;
    backHref?: string;
    backLabel?: string;
}) {
    return (
        <Shell>
            <PageHeader
                eyebrow="Access control"
                title={title}
                description={description}
                action={<BackButton fallbackHref={backHref} />}
            />
            <Card className="max-w-3xl">
                <CardHeader>
                    <div className="mb-4 flex size-12 items-center justify-center border border-border bg-card">
                        <LockKeyhole className="size-5 text-muted-foreground" />
                    </div>
                    <CardTitle className="text-2xl">You do not have access to this page</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-5">
                    <p className="text-muted-foreground">{reason}</p>
                    <div className="flex flex-wrap gap-3">
                        <BackButton fallbackHref={backHref} />
                        <Button asChild variant="secondary">
                            <Link href={backHref}>{backLabel}</Link>
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </Shell>
    );
}
