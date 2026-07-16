"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { useSession } from "@/components/session-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { usePostAuthRoute } from "@/hooks/use-post-auth-route";

/**
 * Client island for the pending-approval page.
 *
 * Auto-polls RBAC status (with a gentle backoff) so an approved user is routed
 * into the workspace within seconds — no manual refreshing required. The
 * "Check again" button stays as an instant manual override.
 */
export function PendingApprovalView() {
    const router = useRouter();
    const { signOut } = useSession();
    const { data, error, isFetching, refetch } = usePostAuthRoute(true, (query) =>
        // 5s → 7.5s → 10s … capped at 30s, so we stop hammering the API if the
        // wait turns out to be long, while still feeling responsive up front.
        Math.min(30_000, 5_000 + query.state.dataUpdateCount * 2_500)
    );

    // Auto-route the moment approval lands, without a click.
    useEffect(() => {
        if (data && data !== "/pending-approval") {
            router.replace(data);
        }
    }, [data, router]);

    async function onSignOut() {
        await signOut();
        router.replace("/auth/sign-in");
    }

    const errorMessage =
        error instanceof Error
            ? error.message
            : error
              ? "Could not verify workspace access. Confirm the backend API is running."
              : "";

    return (
        <main className="app-page-background flex min-h-screen items-center justify-center p-6">
            <section className="app-card-surface w-full max-w-xl bg-card p-8">
                <BrandLogo />
                <p className="mt-8 type-step-eyebrow">Approval required</p>
                <h1 className="mt-3 text-3xl font-heading font-bold tracking-tight">Your account is waiting for admin approval.</h1>
                <p className="mt-4 leading-7 text-muted-foreground">
                    An admin needs to approve your account and assign broker access before you can use this workspace.
                    Once a broker is connected, you won&apos;t need to re-enter those credentials.
                </p>

                <div className="mt-6 flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-sm text-muted-foreground">
                    <span className="relative flex size-2.5 shrink-0" aria-hidden>
                        <span className="absolute inline-flex size-full motion-safe:animate-ping rounded-full bg-primary/60" />
                        <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
                    </span>
                    <span role="status">
                        {isFetching ? "Checking your access…" : "Watching for approval — we'll let you in automatically."}
                    </span>
                </div>

                {errorMessage ? (
                    <Alert className="mt-4" variant="destructive">
                        <AlertDescription>{errorMessage}</AlertDescription>
                    </Alert>
                ) : null}
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Button
                        disabled={isFetching}
                        onClick={() => {
                            void refetch().then((result) => {
                                if (result.data && result.data !== "/pending-approval") {
                                    router.replace(result.data);
                                }
                            });
                        }}
                        type="button"
                    >
                        {isFetching ? "Checking..." : "Check again"}
                    </Button>
                    <Button onClick={onSignOut} type="button" variant="secondary">
                        Sign out
                    </Button>
                </div>

                <p className="mt-6 text-sm text-muted-foreground">
                    Need access sooner? Reach out to your workspace administrator.
                </p>
            </section>
        </main>
    );
}
