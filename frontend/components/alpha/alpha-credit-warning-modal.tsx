"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect, useState } from "react";
import {
    ALPHA_CREDIT_WARNING_EVENT,
    DEFAULT_ALPHA_CREDIT_WARNING_MESSAGE,
    getAlphaCreditWarningMessage,
    notifyAlphaCreditWarning
} from "@/lib/alpha-credit-warning";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from "@/components/ui/dialog";

type AlphaCreditWarningEvent = CustomEvent<{ message?: string }>;

export function AlphaCreditWarningModal() {
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState(DEFAULT_ALPHA_CREDIT_WARNING_MESSAGE);

    useEffect(() => {
        function handleWarning(event: Event) {
            const detail = (event as AlphaCreditWarningEvent).detail;
            setMessage(detail?.message || DEFAULT_ALPHA_CREDIT_WARNING_MESSAGE);
            setOpen(true);
        }
        function handleUnhandledRejection(event: PromiseRejectionEvent) {
            const warningMessage = getAlphaCreditWarningMessage(event.reason);
            if (warningMessage) {
                setMessage(warningMessage);
                setOpen(true);
            }
        }
        function handleWindowError(event: ErrorEvent) {
            const warningMessage = getAlphaCreditWarningMessage(event.error ?? event.message);
            if (warningMessage) {
                setMessage(warningMessage);
                setOpen(true);
            }
        }

        window.addEventListener(ALPHA_CREDIT_WARNING_EVENT, handleWarning);
        window.addEventListener("unhandledrejection", handleUnhandledRejection);
        window.addEventListener("error", handleWindowError);
        return () => {
            window.removeEventListener(ALPHA_CREDIT_WARNING_EVENT, handleWarning);
            window.removeEventListener("unhandledrejection", handleUnhandledRejection);
            window.removeEventListener("error", handleWindowError);
        };
    }, []);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="w-[min(92vw,480px)] gap-0 overflow-hidden p-0">
                <DialogHeader className="border-b border-border px-5 py-4 pr-14">
                    <div className="flex items-start gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center border border-[var(--accent)] bg-[var(--accent-subtle)] text-primary">
                            <AlertTriangle className="size-4" />
                        </span>
                        <div className="grid gap-1">
                            <DialogTitle>Drishti credits required</DialogTitle>
                            <DialogDescription>
                                Ananta Market Stack could not complete this Drishti API request because the account has
                                insufficient credits.
                            </DialogDescription>
                        </div>
                    </div>
                </DialogHeader>
                <div className="grid gap-3 px-5 py-4 text-sm leading-6 text-muted-foreground">
                    <p>{message}</p>
                    <p>
                        Add credits to your Drishti account or update the Drishti API key in Settings, then try
                        the request again.
                    </p>
                </div>
                <DialogFooter className="border-t border-border px-5 py-4">
                    <DialogClose asChild>
                        <Button type="button">Got it</Button>
                    </DialogClose>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export function AlphaCreditWarningTrigger({ message }: { message?: string | null }) {
    useEffect(() => {
        if (message) notifyAlphaCreditWarning(message);
    }, [message]);

    return null;
}
