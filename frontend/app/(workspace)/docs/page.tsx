import Link from "next/link";
import { BrokerLogo, brokerNames, PageHeader } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { brokerGuides } from "@/service/broker-guides";

export default function BrokerDocsIndexPage() {
    const guides = Object.values(brokerGuides);

    return (
        <>
            <PageHeader
                title="Docs"
                description="First-party Ananta setup notes for each supported broker and the exact fields our backend accepts."
                action={
                    <Button asChild variant="outline">
                        <Link href="/broker-connections/new">Add broker</Link>
                    </Button>
                }
            />

            <section className="grid gap-4 min-[760px]:grid-cols-2 min-[1100px]:grid-cols-3">
                {guides.map((guide) => (
                    <Card className="transition hover:border-primary/40" key={guide.broker}>
                        <CardHeader className="flex flex-row items-center gap-4">
                            <BrokerLogo broker={guide.broker} />
                            <div>
                                <CardTitle>{brokerNames[guide.broker]}</CardTitle>
                                <CardDescription>{guide.required.length} required setup item(s)</CardDescription>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <p className="mb-5 text-sm text-muted-foreground">{guide.summary}</p>
                            <Button asChild className="w-full" variant="outline">
                                <Link href={`/docs/${guide.broker}`} target="_blank" rel="noreferrer">
                                    Open docs
                                </Link>
                            </Button>
                        </CardContent>
                    </Card>
                ))}
            </section>
        </>
    );
}
