"use client";

import { useMemo, useState } from "react";
import { IconArrowRight } from "@tabler/icons-react";
import { AddBrokerForm } from "@/components/brokers/add-broker-form";
import { BrokerLogo, brokerNames } from "@/components/brokers/ui";
import { Button } from "@/components/ui/button";
import { CardFrame, CardFrameDescription, CardFrameHeader, CardFrameTitle, CardPanel } from "@/components/ui/card";
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
                <CardFrameHeader className="gap-y-1 px-4 py-4 sm:px-5">
                    <CardFrameTitle className={typography.h4}>
                        {connectedCount ? "Add another broker" : "Add a broker"}
                    </CardFrameTitle>
                    <CardFrameDescription className="max-w-2xl leading-relaxed">
                        Create separate connections for each broker account you want Ananta to use.
                    </CardFrameDescription>
                </CardFrameHeader>
                <CardPanel className="grid gap-2 border-t bg-card/60 p-3 min-[560px]:grid-cols-2 min-[900px]:grid-cols-3">
                    {supportedBrokers.length ? (
                        supportedBrokers.map((code) => (
                            <Button
                                aria-label={`Add ${brokerNames[code]} broker account`}
                                className="group h-auto min-h-14 justify-start gap-3 rounded-md px-3 py-2.5 text-left"
                                key={code}
                                onClick={() => openBrokerForm(code)}
                                type="button"
                                variant="outline"
                            >
                                <BrokerLogo broker={code} className="size-9" imageClassName="size-7 rounded-md" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold">{brokerNames[code]}</span>
                                    <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                                        {code}
                                    </span>
                                </span>
                                <IconArrowRight
                                    aria-hidden="true"
                                    className="ml-auto size-4 shrink-0 text-muted-foreground transition-transform duration-150 ease-out group-hover:translate-x-0.5 group-hover:text-foreground"
                                    stroke={1.8}
                                />
                            </Button>
                        ))
                    ) : (
                        <div className="col-span-full rounded-md border border-dashed bg-muted/30 p-4 text-sm text-muted-foreground">
                            Broker options are unavailable right now. Open the form to choose a broker manually.
                        </div>
                    )}
                </CardPanel>
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
