"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { useSession } from "@/components/session-provider";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { resolvePostAuthRoute } from "@/service/actions/auth-routing";

export default function PendingApprovalPage() {
    const router = useRouter();
    const { signOut } = useSession();
    const [error, setError] = useState("");
    const [isChecking, startTransition] = useTransition();

    function checkAccess() {
        setError("");
        startTransition(async () => {
            try {
                const route = await resolvePostAuthRoute();
                router.replace(route);
            } catch (caught) {
                setError(
                    caught instanceof Error
                        ? caught.message
                        : "Could not verify workspace access. Confirm the backend API is running."
                );
            }
        });
    }

    useEffect(() => {
        checkAccess();
    }, []);

    async function onSignOut() {
        await signOut();
        router.replace("/auth/sign-in");
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
            <section className="w-full max-w-xl border border-border bg-card p-8 shadow-sm">
                <BrandLogo />
                <p className="mt-8 type-step-eyebrow">Approval required</p>
                <h1 className="mt-3 text-3xl font-semibold">Your account is waiting for admin approval.</h1>
                <p className="mt-4 leading-7 text-muted-foreground">
                    An admin needs to approve your account and assign broker access before you can use this workspace.
                    Existing broker accounts stay connected; you do not need to add credentials again.
                </p>
                {error ? (
                    <Alert className="mt-6" variant="destructive">
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Button disabled={isChecking} onClick={checkAccess} type="button">
                        {isChecking ? "Checking..." : "Check again"}
                    </Button>
                    <Button onClick={onSignOut} type="button" variant="secondary">
                        Sign out
                    </Button>
                </div>
            </section>
        </main>
    );
}
