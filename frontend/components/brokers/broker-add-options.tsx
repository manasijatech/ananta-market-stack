"use client";

import { useMemo, useState } from "react";
import { IconArrowRight, IconPlus } from "@tabler/icons-react";
import { AddBrokerForm } from "@/components/brokers/add-broker-form";
import { BrokerLogo, brokerNames } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardFrame,
    CardFrameAction,
    CardFrameDescription,
    CardFrameHeader,
    CardFrameTitle,
    CardPanel
} from "@/components/ui/card";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogPanel,
    DialogTitle
} from "@/components/ui/dialog";
import { typography } from "@/lib/typography";
import type { BrokerCode } from "@/service/types/broker";

export function BrokerAddOptions({
    connectedCount,
    supportedBrokers
}: {
    connectedCount: number;
    supportedBrokers: BrokerCode[];
}) {
    const dialogBrokers = useMemo<BrokerCode[]>(
        () => (supportedBrokers.length ? supportedBrokers : ["zerodha"]),
        [supportedBrokers]
    );
    const [open, setOpen] = useState(false);
    const [selectedBroker, setSelectedBroker] = useState<BrokerCode>(dialogBrokers[0] ?? "zerodha");

    function openBrokerForm(code: BrokerCode) {
        setSelectedBroker(code);
        setOpen(true);
    }

    return (
        <>
            <CardFrame>
                <CardFrameHeader>
                    <CardFrameTitle className={typography.h4}>
                        {connectedCount ? "Add another broker" : "Add a broker"}
                    </CardFrameTitle>
                    <CardFrameDescription className="leading-7">
                        Create separate connections for each broker account you want Ananta to use.
                    </CardFrameDescription>
                    <CardFrameAction>
                        <Button
                            className="min-h-10 w-full font-semibold min-[520px]:w-auto"
                            data-onboarding="add-broker-action"
                            onClick={() => openBrokerForm(dialogBrokers[0] ?? "zerodha")}
                            type="button"
                            variant="outline"
                        >
                            <IconPlus aria-hidden="true" className="size-4" stroke={1.75} />
                            Open form
                        </Button>
                    </CardFrameAction>
                </CardFrameHeader>
                <Card>
                    <CardPanel className="grid gap-2 p-3 min-[640px]:grid-cols-2 min-[1020px]:grid-cols-4">
                        {supportedBrokers.length ? (
                            supportedBrokers.map((code) => (
                                <Card
                                    className="group shadow-none transition-colors hover:border-primary/70 hover:bg-primary/5 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/25"
                                    key={code}
                                    render={
                                        <button
                                            aria-label={`Add ${brokerNames[code]} broker account`}
                                            onClick={() => openBrokerForm(code)}
                                            type="button"
                                        />
                                    }
                                >
                                    <CardPanel className="flex min-h-16 items-center gap-3 p-3">
                                        <BrokerLogo
                                            broker={code}
                                            className="size-10"
                                            imageClassName="size-8 rounded-md"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-semibold">{brokerNames[code]}</div>
                                            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                                                {code}
                                            </div>
                                        </div>
                                        <IconArrowRight
                                            aria-hidden="true"
                                            className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary"
                                            stroke={1.8}
                                        />
                                    </CardPanel>
                                </Card>
                            ))
                        ) : (
                            <div className="col-span-full rounded-lg border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                                Broker options are unavailable right now. Open the form to choose a broker manually.
                            </div>
                        )}
                    </CardPanel>
                </Card>
            </CardFrame>

            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-h-[90vh] w-[min(620px,calc(100vw-2rem))] max-w-none p-0">
                    <DialogHeader className="border-b border-border px-6 py-5 pr-14">
                        <DialogTitle>Connect {brokerNames[selectedBroker]}</DialogTitle>
                        <DialogDescription>Use the credentials from your broker developer dashboard.</DialogDescription>
                    </DialogHeader>
                    <DialogPanel className="p-4 sm:p-6">
                        <AddBrokerForm
                            compact
                            initialBroker={selectedBroker}
                            key={selectedBroker}
                            showBrokerSelector={false}
                            supportedBrokers={[selectedBroker]}
                        />
                    </DialogPanel>
                </DialogContent>
            </Dialog>
        </>
    );
}
