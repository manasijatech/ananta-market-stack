"use client";

import { useEffect } from "react";

const RELOAD_KEY = "ananta:route-error-recovery-at";
const RELOAD_COOLDOWN_MS = 60_000;

export default function AppError({
    error,
    reset
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error(error);
        const lastReload = Number.parseInt(window.sessionStorage.getItem(RELOAD_KEY) ?? "0", 10);
        if (Date.now() - lastReload >= RELOAD_COOLDOWN_MS) {
            window.sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
            window.location.reload();
        }
    }, [error]);

    return (
        <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-4 px-6 text-center">
            <h1 className="font-heading text-2xl font-semibold">The page could not finish loading</h1>
            <p className="text-sm text-muted-foreground">
                The app attempted an automatic recovery. Try the page again if the service was still restarting.
            </p>
            <button
                className="rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold"
                onClick={reset}
                type="button"
            >
                Try again
            </button>
        </main>
    );
}
