"use client";

import { useEffect } from "react";

export default function WorkspaceError({
    error,
    reset
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        console.error(error);
    }, [error]);

    return (
        <main className="mx-auto grid min-h-[24rem] max-w-2xl place-content-center gap-4 px-6 text-center">
            <h1 className="font-heading text-2xl font-semibold">This section could not finish loading</h1>
            <p className="text-sm text-muted-foreground">
                A dependent service may be temporarily unavailable. The workspace and its other services are still
                running.
            </p>
            <button
                className="mx-auto rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold"
                onClick={reset}
                type="button"
            >
                Try this section again
            </button>
        </main>
    );
}
