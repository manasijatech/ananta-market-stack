"use client";

import { useEffect } from "react";

const RELOAD_KEY = "ananta:global-error-recovery-at";
const RELOAD_COOLDOWN_MS = 60_000;

export default function GlobalError({
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
        <html lang="en">
            <body>
                <main
                    style={{
                        alignItems: "center",
                        display: "flex",
                        flexDirection: "column",
                        gap: "1rem",
                        justifyContent: "center",
                        minHeight: "100vh",
                        padding: "1.5rem",
                        textAlign: "center"
                    }}
                >
                    <h1>The application could not finish loading</h1>
                    <p>The app attempted an automatic recovery after the deployment or service restart.</p>
                    <button onClick={reset} type="button">
                        Try again
                    </button>
                </main>
            </body>
        </html>
    );
}
