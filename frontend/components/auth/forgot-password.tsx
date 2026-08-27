"use client";

import { useAuth, useFetchOptions, useRequestPasswordReset } from "@better-auth-ui/react";
import { type SyntheticEvent, useEffect, useRef, useState } from "react";
import {
    authFormInputClassName,
    authFormInputInvalidClassName,
    authFormPrimaryButtonClassName
} from "@/components/auth/auth-form-styles";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { resetPasswordPagePath } from "@/lib/auth-reset";
import { cn } from "@/lib/utils";
import { requestPasswordResetAction } from "@/service/actions/auth-session";

export type ForgotPasswordProps = {
    className?: string;
};

export function ForgotPassword({ className }: ForgotPasswordProps) {
    const { authClient, basePaths, localization, plugins, viewPaths, Link } = useAuth();
    const { fetchOptions, resetFetchOptions } = useFetchOptions();
    const submittedEmailRef = useRef("");
    const [fieldErrors, setFieldErrors] = useState<{ email?: string }>({});
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [isContinuing, setIsContinuing] = useState(false);

    const { mutate: requestPasswordReset, isPending } = useRequestPasswordReset(authClient, {
        onError: () => {
            setIsContinuing(false);
            setErrorMessage("Could not start password reset. Try again.");
            resetFetchOptions();
        },
        onSuccess: () => {
            void loadDevResetLink(submittedEmailRef.current);
        }
    });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("sent") === "1") {
            setStatusMessage(
                "If that email is on this workspace, a reset link is ready. Check this page or the frontend terminal for the local-dev link."
            );
        }
        const error = params.get("error");
        if (error) {
            setErrorMessage(error);
        }
    }, []);

    async function loadDevResetLink(email: string) {
        if (!email) {
            setStatusMessage("If an account exists for that email, a reset link was created.");
            setIsContinuing(false);
            return;
        }

        const response = await fetch(`/api/auth/dev-password-reset-link?email=${encodeURIComponent(email)}`, {
            cache: "no-store"
        }).catch(() => null);

        if (!response?.ok) {
            setStatusMessage("If an account exists for that email, a reset link was created. Check the frontend terminal in local dev.");
            setIsContinuing(false);
            return;
        }

        const payload = (await response.json().catch(() => null)) as { url?: string | null } | null;
        const resetPath = payload?.url ? resetPasswordPagePath(payload.url) : null;
        if (resetPath) {
            window.location.assign(resetPath);
            return;
        }

        setStatusMessage("If an account exists for that email, a reset link was created. Check the frontend terminal in local dev.");
        setIsContinuing(false);
    }

    function handleSubmit(event: SyntheticEvent<HTMLFormElement>) {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        const email = formData.get("email") as string;
        submittedEmailRef.current = email;
        setErrorMessage(null);
        setStatusMessage(null);
        setIsContinuing(true);
        requestPasswordReset({
            email,
            redirectTo: `${window.location.origin}${basePaths.auth}/${viewPaths.auth.resetPassword}`,
            fetchOptions
        });
    }

    const Captcha = plugins.find((plugin) => plugin.captchaComponent)?.captchaComponent;
    const busy = isPending || isContinuing;

    return (
        <div className={cn("flex w-full flex-col gap-5", className)}>
            <div className="space-y-1.5">
                <h1 className="text-2xl font-semibold tracking-tight">{localization.auth.forgotPassword}</h1>
                <p className="text-sm leading-relaxed text-muted-foreground">
                    Enter your account email to continue with password reset.
                </p>
            </div>

            {statusMessage ? (
                <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">
                    {statusMessage}
                </p>
            ) : null}
            {errorMessage ? <p className="text-sm text-destructive">{errorMessage}</p> : null}

            <form className="grid gap-5" method="POST" action={requestPasswordResetAction} onSubmit={handleSubmit}>
                <FieldGroup className="gap-3.5">
                    <Field data-invalid={!!fieldErrors.email}>
                        <FieldLabel htmlFor="forgot-password-email">{localization.auth.email}</FieldLabel>
                        <Input
                            id="forgot-password-email"
                            name="email"
                            type="email"
                            autoComplete="email"
                            placeholder={localization.auth.emailPlaceholder}
                            required
                            disabled={busy}
                            className={cn(authFormInputClassName, fieldErrors.email && authFormInputInvalidClassName)}
                            onChange={() => setFieldErrors((prev) => ({ ...prev, email: undefined }))}
                            onInvalid={(event) => {
                                event.preventDefault();
                                const element = event.target as HTMLInputElement;
                                setFieldErrors((prev) => ({
                                    ...prev,
                                    email: element.validity.valueMissing
                                        ? localization.auth.fieldRequired
                                        : localization.auth.invalidEmail
                                }));
                            }}
                            aria-invalid={fieldErrors.email ? true : undefined}
                        />
                        <FieldError>{fieldErrors.email}</FieldError>
                    </Field>

                    {Captcha ? <div className="flex justify-center">{Captcha}</div> : null}
                </FieldGroup>

                <div className="space-y-5">
                    <Button type="submit" disabled={busy} className={authFormPrimaryButtonClassName}>
                        {busy ? <Spinner /> : null}
                        Continue
                    </Button>

                    <p className="text-center text-sm text-muted-foreground">
                        {localization.auth.rememberYourPassword}{" "}
                        <Link
                            href={`${basePaths.auth}/${viewPaths.auth.signIn}`}
                            className="font-medium text-foreground underline underline-offset-4"
                        >
                            {localization.auth.signIn}
                        </Link>
                    </p>
                </div>
            </form>
        </div>
    );
}
